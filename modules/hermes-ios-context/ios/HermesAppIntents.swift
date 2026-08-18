import AppIntents
import CryptoKit
import Foundation
import Security
import UIKit

/// App Intents can run in an extension process.  Their durable payload is
/// therefore encrypted with a device-only Keychain key before it reaches the
/// shared UserDefaults container.
private enum HermesIntentQueueCipher {
  private static let service = "app.hermes.intent-queue"
  private static let account = "payload-key-v1"

  static func seal(_ entries: [[String: Any]]) -> Data? {
    guard JSONSerialization.isValidJSONObject(entries),
          let clear = try? JSONSerialization.data(withJSONObject: entries),
          let encrypted = try? AES.GCM.seal(clear, using: key()),
          let combined = encrypted.combined else { return nil }
    return combined
  }

  static func open(_ envelope: Data) -> [[String: Any]] {
    guard let clear = try? AES.GCM.open(
      AES.GCM.SealedBox(combined: envelope),
      using: key()
    ),
    let value = try? JSONSerialization.jsonObject(with: clear),
    let entries = value as? [[String: Any]] else { return [] }
    return entries
  }

  private static func key() throws -> SymmetricKey {
    if let existing = readKey(), existing.count == 32 {
      return SymmetricKey(data: existing)
    }
    var bytes = Data(count: 32)
    let randomStatus = bytes.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, 32, buffer.baseAddress!)
    }
    guard randomStatus == errSecSuccess else { throw HermesIntentQueueError.keyUnavailable }
    var insert = keySelector()
    insert[kSecValueData as String] = bytes
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(insert as CFDictionary, nil)
    if status == errSecDuplicateItem, let existing = readKey(), existing.count == 32 {
      return SymmetricKey(data: existing)
    }
    guard status == errSecSuccess else { throw HermesIntentQueueError.keyUnavailable }
    return SymmetricKey(data: bytes)
  }

  private static func readKey() -> Data? {
    var query = keySelector()
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    query[kSecReturnData as String] = true
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
    return result as? Data
  }

  private static func keySelector() -> [String: Any] {
    var selector: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    if let accessGroup = Bundle.main.object(forInfoDictionaryKey: "HermesSharedKeychainAccessGroup") as? String,
       !accessGroup.isEmpty,
       !accessGroup.contains("$(") {
      selector[kSecAttrAccessGroup as String] = accessGroup
    }
    return selector
  }
}

private enum HermesIntentQueueError: Error {
  case keyUnavailable
}

final class HermesAgentTriggerStore {
  static let shared = HermesAgentTriggerStore()
  static let appGroup = "group.app.sunstone1029.fig1171.hermes"
  private let key = "agent-trigger-inbox-v2"
  private let legacyKey = "agent-trigger-inbox-v1"
  private let lock = NSLock()

  private init() {}

  static var shareAttachmentRoot: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent("agent-share-attachments-v1", isDirectory: true)
  }

  @discardableResult
  func enqueue(kind: String, content: String) -> String? {
    enqueueRequest(kind: kind, content: content, sessionID: nil, model: nil, attachments: [])
  }

  @discardableResult
  func enqueueRequest(kind: String, content: String, sessionID: String?, model: String?, attachments: [[String: Any]]) -> String? {
    let normalizedKind = kind.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let normalizedContent = content.trimmingCharacters(in: .whitespacesAndNewlines)
    let allowed = ["summarize-meeting", "clipboard-to-email", "daily-report", "analyze-text", "voice-capture", "voice-start", "camera-task", "send-prompt", "ask", "quick-task", "follow-up", "get-session-status", "list-sessions", "open-session", "retry-run"]
    guard allowed.contains(normalizedKind), (!normalizedContent.isEmpty || !attachments.isEmpty), normalizedContent.count <= 20_000 else {
      return nil
    }
    let identity = HermesContextEventQueue.shared.currentOwnerIdentity
    guard identity.isBound else { return nil }
    let requestID = UUID().uuidString.lowercased()
    lock.lock()
    defer { lock.unlock() }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    var entries = readEntries(defaults)
    var entry: [String: Any] = [
      "content": normalizedContent,
      "createdAt": Date().timeIntervalSince1970 * 1000,
      "kind": normalizedKind,
      "requestID": requestID,
      "ownerScope": identity.ownerScope,
      "accountGeneration": identity.accountGeneration,
    ]
    if let sessionID, !sessionID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { entry["sessionID"] = String(sessionID.prefix(256)) }
    if let model, !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { entry["model"] = String(model.prefix(128)) }
    if !attachments.isEmpty { entry["attachments"] = Array(attachments.prefix(10)) }
    entries.append(entry)
    guard writeEntries(Array(entries.suffix(50)), defaults: defaults) else { return nil }
    return requestID
  }

  func pending() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    return readEntries(defaults)
  }

  @discardableResult
  func consume(requestID: String) -> Bool {
    let normalized = requestID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return false }
    lock.lock()
    defer { lock.unlock() }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    let entries = readEntries(defaults)
    let remaining = entries.filter { ($0["requestID"] as? String) != normalized }
    guard remaining.count != entries.count else { return false }
    return writeEntries(remaining, defaults: defaults)
  }

  func discardMismatched(ownerScope: String, accountGeneration: String) {
    lock.lock()
    defer { lock.unlock() }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    let entries = readEntries(defaults)
    let matching = entries.filter {
      ($0["ownerScope"] as? String) == ownerScope
        && ($0["accountGeneration"] as? String) == accountGeneration
    }
    if matching.count != entries.count { _ = writeEntries(matching, defaults: defaults) }
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    defaults.removeObject(forKey: key)
    defaults.removeObject(forKey: legacyKey)
  }

  private func readEntries(_ defaults: UserDefaults) -> [[String: Any]] {
    // Plaintext v1 payloads are intentionally discarded during migration.
    defaults.removeObject(forKey: legacyKey)
    guard let envelope = defaults.data(forKey: key) else { return [] }
    return HermesIntentQueueCipher.open(envelope)
  }

  @discardableResult
  private func writeEntries(_ entries: [[String: Any]], defaults: UserDefaults) -> Bool {
    guard let envelope = HermesIntentQueueCipher.seal(entries) else { return false }
    defaults.set(envelope, forKey: key)
    defaults.synchronize()
    return true
  }
}

/// App Intents are invoked outside the JavaScript lifecycle (for example by
/// Siri or a Live Activity deep link). Persisting the request lets the next
/// foreground/relay pass apply it to the server-backed task and provides a
/// durable audit point instead of attempting network I/O from Siri.
final class HermesTaskControlStore {
  static let shared = HermesTaskControlStore()
  private let lock = NSLock()
  private let key = "app.hermes.pending-task-controls-v2"
  private let legacyKey = "app.hermes.pending-task-controls"
  private let allowedActions: Set<String> = ["pause", "resume", "cancel", "retry"]

  private init() {}

  @discardableResult
  func enqueue(taskID: String, action: String) -> String? {
    let normalizedID = taskID.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedAction = action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !normalizedID.isEmpty, normalizedID.count <= 256,
          !normalizedID.contains("/"), !normalizedID.contains("\\"),
          allowedActions.contains(normalizedAction) else { return nil }
    let identity = HermesContextEventQueue.shared.currentOwnerIdentity
    guard identity.isBound else { return nil }
    let requestID = UUID().uuidString.lowercased()
    lock.lock()
    defer { lock.unlock() }
    var requests = readEntries()
    requests.removeAll {
      ($0["taskID"] as? String) == normalizedID
        && ($0["action"] as? String) == normalizedAction
    }
    requests.append([
      "action": normalizedAction,
      "createdAt": Date().timeIntervalSince1970 * 1000,
      "requestID": requestID,
      "taskID": normalizedID,
      "ownerScope": identity.ownerScope,
      "accountGeneration": identity.accountGeneration,
    ])
    guard writeEntries(Array(requests.suffix(50))) else { return nil }
    return requestID
  }

  func pending() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return readEntries()
  }

  @discardableResult
  func consume(requestID: String) -> Bool {
    let normalized = requestID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return false }
    lock.lock()
    defer { lock.unlock() }
    let requests = readEntries()
    let remaining = requests.filter { ($0["requestID"] as? String) != normalized }
    guard remaining.count != requests.count else { return false }
    return writeEntries(remaining)
  }

  func discardMismatched(ownerScope: String, accountGeneration: String) {
    lock.lock()
    defer { lock.unlock() }
    let requests = readEntries()
    let matching = requests.filter {
      ($0["ownerScope"] as? String) == ownerScope
        && ($0["accountGeneration"] as? String) == accountGeneration
    }
    if matching.count != requests.count { _ = writeEntries(matching) }
  }

  func clear() {
    lock.lock()
    defer { lock.unlock() }
    UserDefaults.standard.removeObject(forKey: key)
    UserDefaults.standard.removeObject(forKey: legacyKey)
  }

  private func readEntries() -> [[String: Any]] {
    UserDefaults.standard.removeObject(forKey: legacyKey)
    guard let envelope = UserDefaults.standard.data(forKey: key) else { return [] }
    return HermesIntentQueueCipher.open(envelope)
  }

  @discardableResult
  private func writeEntries(_ entries: [[String: Any]]) -> Bool {
    guard let envelope = HermesIntentQueueCipher.seal(entries) else { return false }
    UserDefaults.standard.set(envelope, forKey: key)
    UserDefaults.standard.synchronize()
    return true
  }
}

struct HermesRefreshContextIntent: AppIntent {
  static var title: LocalizedStringResource = "Refresh Hermes context"
  static var description = IntentDescription("Collect a current location and device context snapshot.")
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    guard HermesPermissionCollectionGate.shared.isReadyForCurrentOwner else { return .result() }
    _ = await HermesLocationService.shared.requestCurrent()
    _ = HermesDeviceService.shared.recordSnapshot()
    return .result()
  }
}

struct HermesCurrentLocationIntent: AppIntent {
  static var title: LocalizedStringResource = "Get Hermes location"
  static var description = IntentDescription("Refresh the current iPhone location for Hermes.")
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    guard HermesPermissionCollectionGate.shared.isReadyForCurrentOwner else { return .result() }
    _ = await HermesLocationService.shared.requestCurrent()
    return .result()
  }
}

struct HermesResumeTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Resume Hermes task"
  static var description = IntentDescription("Continue a paused Hermes task on the next relay pass.")
  static var openAppWhenRun = true

  @Parameter(title: "Task ID") var taskID: String

  func perform() async throws -> some IntentResult {
    guard HermesTaskControlStore.shared.enqueue(taskID: taskID, action: "resume") != nil else {
      throw HermesTaskControlError.invalidTaskID
    }
    return .result()
  }
}

struct HermesPauseTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Pause Hermes task"
  static var description = IntentDescription("Pause a running Hermes task on the next relay pass.")
  static var openAppWhenRun = true

  @Parameter(title: "Task ID") var taskID: String

  func perform() async throws -> some IntentResult {
    guard HermesTaskControlStore.shared.enqueue(taskID: taskID, action: "pause") != nil else {
      throw HermesTaskControlError.invalidTaskID
    }
    return .result()
  }
}

struct HermesCancelTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Cancel Hermes task"
  static var description = IntentDescription("Cancel a Hermes task on the next relay pass.")
  static var openAppWhenRun = true

  @Parameter(title: "Task ID") var taskID: String

  func perform() async throws -> some IntentResult {
    guard HermesTaskControlStore.shared.enqueue(taskID: taskID, action: "cancel") != nil else {
      throw HermesTaskControlError.invalidTaskID
    }
    return .result()
  }
}

struct HermesRetryTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Retry Hermes task"
  static var description = IntentDescription("Retry the failed step of a Hermes task on the next relay pass.")
  static var openAppWhenRun = true

  @Parameter(title: "Task ID") var taskID: String

  func perform() async throws -> some IntentResult {
    guard HermesTaskControlStore.shared.enqueue(taskID: taskID, action: "retry") != nil else {
      throw HermesTaskControlError.invalidTaskID
    }
    return .result()
  }
}

struct HermesSummarizeMeetingIntent: AppIntent {
  static var title: LocalizedStringResource = "Summarize today's meetings with Hermes"
  static var description = IntentDescription("Queue a Hermes task to summarize today's calendar meetings.")
  static var openAppWhenRun = true

  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueue(
      kind: "summarize-meeting",
      content: "总结今天的会议，提取每场会议的结论、待办事项和负责人。"
    ) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesClipboardToEmailIntent: AppIntent {
  static var title: LocalizedStringResource = "Turn clipboard into an email with Hermes"
  static var description = IntentDescription("Queue the current clipboard text for Hermes to organize as an email draft.")
  static var openAppWhenRun = true

  func perform() async throws -> some IntentResult {
    guard let text = UIPasteboard.general.string,
          HermesAgentTriggerStore.shared.enqueue(kind: "clipboard-to-email", content: text) != nil else {
      throw HermesTaskControlError.invalidTaskID
    }
    return .result()
  }
}

struct HermesDailyReportIntent: AppIntent {
  static var title: LocalizedStringResource = "Run Hermes daily work report"
  static var description = IntentDescription("Queue the daily work report task for Hermes.")
  static var openAppWhenRun = true

  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueue(
      kind: "daily-report",
      content: "生成今天的工作报告，汇总会议、提醒、任务进度和需要关注的风险。"
    ) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesAnalyzeTextIntent: AppIntent {
  static var title: LocalizedStringResource = "Analyze text with Hermes"
  static var description = IntentDescription("Queue selected text for Hermes analysis.")
  static var openAppWhenRun = true

  @Parameter(title: "Text") var text: String

  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueue(kind: "analyze-text", content: text) != nil else {
      throw HermesTaskControlError.invalidTaskID
    }
    return .result()
  }
}

struct HermesVoiceCaptureIntent: AppIntent {
  static var title: LocalizedStringResource = "Record a voice note with Hermes"
  static var description = IntentDescription("Start Hermes voice capture and send the transcript to the agent.")
  static var openAppWhenRun = true

  func perform() async throws -> some IntentResult {
    try await HermesVoiceService.shared.startAgentCapture(localeIdentifier: nil)
    return .result()
  }
}

struct HermesSendPromptIntent: AppIntent {
  static var title: LocalizedStringResource = "Send a prompt to Hermes"
  static var description = IntentDescription("Start a Hermes task from Siri with an optional session and model.")
  static var openAppWhenRun = true
  @Parameter(title: "Prompt") var prompt: String
  @Parameter(title: "Session ID") var sessionID: String?
  @Parameter(title: "Model") var model: String?
  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueueRequest(kind: "send-prompt", content: prompt, sessionID: sessionID, model: model, attachments: []) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesAskIntent: AppIntent {
  static var title: LocalizedStringResource = "Ask Hermes"
  static var description = IntentDescription("Ask Hermes a question and continue the task from the iPhone.")
  static var openAppWhenRun = true
  @Parameter(title: "Question") var question: String
  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueueRequest(kind: "ask", content: question, sessionID: nil, model: nil, attachments: []) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesQuickTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Run a Hermes quick task"
  static var description = IntentDescription("Run a named Hermes task such as a daily report or meeting summary.")
  static var openAppWhenRun = true
  @Parameter(title: "Task") var task: String
  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueueRequest(kind: "quick-task", content: task, sessionID: nil, model: nil, attachments: []) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesFollowUpSessionIntent: AppIntent {
  static var title: LocalizedStringResource = "Follow up in Hermes session"
  static var description = IntentDescription("Continue a Hermes session with a new prompt.")
  static var openAppWhenRun = true
  @Parameter(title: "Session ID") var sessionID: String
  @Parameter(title: "Prompt") var prompt: String
  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueueRequest(kind: "follow-up", content: prompt, sessionID: sessionID, model: nil, attachments: []) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesGetSessionStatusIntent: AppIntent {
  static var title: LocalizedStringResource = "Get Hermes session status"
  static var description = IntentDescription("Request the current status of a Hermes session.")
  static var openAppWhenRun = true
  @Parameter(title: "Session ID") var sessionID: String
  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueueRequest(kind: "get-session-status", content: sessionID, sessionID: sessionID, model: nil, attachments: []) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesListSessionsIntent: AppIntent {
  static var title: LocalizedStringResource = "List Hermes sessions"
  static var description = IntentDescription("Request the latest Hermes sessions.")
  static var openAppWhenRun = true
  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueueRequest(kind: "list-sessions", content: "list", sessionID: nil, model: nil, attachments: []) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesOpenSessionIntent: AppIntent {
  static var title: LocalizedStringResource = "Open Hermes session"
  static var description = IntentDescription("Open a Hermes session on the iPhone.")
  static var openAppWhenRun = true
  @Parameter(title: "Session ID") var sessionID: String
  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueueRequest(kind: "open-session", content: sessionID, sessionID: sessionID, model: nil, attachments: []) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesRetryRunIntent: AppIntent {
  static var title: LocalizedStringResource = "Retry a Hermes run"
  static var description = IntentDescription("Retry a failed Hermes run in a session.")
  static var openAppWhenRun = true
  @Parameter(title: "Session ID") var sessionID: String
  @Parameter(title: "Message ID") var messageID: String
  func perform() async throws -> some IntentResult {
    guard HermesAgentTriggerStore.shared.enqueueRequest(kind: "retry-run", content: messageID, sessionID: sessionID, model: nil, attachments: []) != nil else { throw HermesTaskControlError.invalidTaskID }
    return .result()
  }
}

struct HermesTaskShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
      AppShortcut(
        intent: HermesResumeTaskIntent(),
        phrases: ["Resume a Hermes task in \(.applicationName)"],
        shortTitle: "Resume Hermes task",
        systemImageName: "play.fill"
      )
      AppShortcut(
        intent: HermesPauseTaskIntent(),
        phrases: ["Pause a Hermes task in \(.applicationName)"],
        shortTitle: "Pause Hermes task",
        systemImageName: "pause.fill"
      )
      AppShortcut(
        intent: HermesCancelTaskIntent(),
        phrases: ["Cancel a Hermes task in \(.applicationName)"],
        shortTitle: "Cancel Hermes task",
        systemImageName: "xmark"
      )
      AppShortcut(
        intent: HermesRetryTaskIntent(),
        phrases: ["Retry a Hermes task in \(.applicationName)"],
        shortTitle: "Retry Hermes task",
        systemImageName: "arrow.clockwise"
      )
      AppShortcut(
        intent: HermesSummarizeMeetingIntent(),
        phrases: ["Summarize today's meetings with \(.applicationName)"],
        shortTitle: "Summarize meetings",
        systemImageName: "calendar"
      )
      AppShortcut(
        intent: HermesClipboardToEmailIntent(),
        phrases: ["Turn my clipboard into an email with \(.applicationName)"],
        shortTitle: "Clipboard to email",
        systemImageName: "doc.on.clipboard"
      )
      AppShortcut(
        intent: HermesDailyReportIntent(),
        phrases: ["Run my daily report with \(.applicationName)"],
        shortTitle: "Daily report",
        systemImageName: "doc.text"
      )
      AppShortcut(
        intent: HermesVoiceCaptureIntent(),
        phrases: ["Record a voice note with \(.applicationName)"],
        shortTitle: "Voice note",
        systemImageName: "mic"
      )
      AppShortcut(intent: HermesSendPromptIntent(), phrases: ["Send a prompt to \(.applicationName)"], shortTitle: "Send prompt", systemImageName: "paperplane")
      AppShortcut(intent: HermesQuickTaskIntent(), phrases: ["Run a quick task in \(.applicationName)"], shortTitle: "Quick task", systemImageName: "bolt")
  }
}

private enum HermesTaskControlError: LocalizedError {
  case invalidTaskID

  var errorDescription: String? {
    "A valid Hermes task id is required."
  }
}
