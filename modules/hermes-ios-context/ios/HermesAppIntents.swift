import AppIntents
import Foundation
import UIKit

final class HermesAgentTriggerStore {
  static let shared = HermesAgentTriggerStore()
  static let appGroup = "group.app.sunstone1029.fig1171.hermes"
  private let key = "agent-trigger-inbox-v1"
  private let lock = NSLock()

  private init() {}

  @discardableResult
  func enqueue(kind: String, content: String) -> String? {
    let normalizedKind = kind.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let normalizedContent = content.trimmingCharacters(in: .whitespacesAndNewlines)
    let allowed = ["summarize-meeting", "clipboard-to-email", "daily-report", "analyze-text", "voice-capture"]
    guard allowed.contains(normalizedKind), !normalizedContent.isEmpty, normalizedContent.count <= 12_000 else {
      return nil
    }
    let requestID = UUID().uuidString.lowercased()
    lock.lock()
    defer { lock.unlock() }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    var entries = defaults.array(forKey: key) as? [[String: Any]] ?? []
    entries.append([
      "content": normalizedContent,
      "createdAt": Date().timeIntervalSince1970 * 1000,
      "kind": normalizedKind,
      "requestID": requestID,
    ])
    defaults.set(Array(entries.suffix(50)), forKey: key)
    return requestID
  }

  func pending() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    return defaults.array(forKey: key) as? [[String: Any]] ?? []
  }

  @discardableResult
  func consume(requestID: String) -> Bool {
    let normalized = requestID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return false }
    lock.lock()
    defer { lock.unlock() }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    let entries = defaults.array(forKey: key) as? [[String: Any]] ?? []
    let remaining = entries.filter { ($0["requestID"] as? String) != normalized }
    guard remaining.count != entries.count else { return false }
    defaults.set(remaining, forKey: key)
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
  private let key = "app.hermes.pending-task-controls"
  private let allowedActions: Set<String> = ["pause", "resume", "cancel", "retry"]

  private init() {}

  @discardableResult
  func enqueue(taskID: String, action: String) -> String? {
    let normalizedID = taskID.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedAction = action.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !normalizedID.isEmpty, normalizedID.count <= 256,
          !normalizedID.contains("/"), !normalizedID.contains("\\"),
          allowedActions.contains(normalizedAction) else { return nil }
    let requestID = UUID().uuidString.lowercased()
    lock.lock()
    defer { lock.unlock() }
    var requests = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
    requests.removeAll {
      ($0["taskID"] as? String) == normalizedID
        && ($0["action"] as? String) == normalizedAction
    }
    requests.append([
      "action": normalizedAction,
      "createdAt": Date().timeIntervalSince1970 * 1000,
      "requestID": requestID,
      "taskID": normalizedID,
    ])
    UserDefaults.standard.set(Array(requests.suffix(50)), forKey: key)
    UserDefaults.standard.synchronize()
    return requestID
  }

  func pending() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
  }

  @discardableResult
  func consume(requestID: String) -> Bool {
    let normalized = requestID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return false }
    lock.lock()
    defer { lock.unlock() }
    let requests = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
    let remaining = requests.filter { ($0["requestID"] as? String) != normalized }
    guard remaining.count != requests.count else { return false }
    UserDefaults.standard.set(remaining, forKey: key)
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

struct HermesTaskShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    [
      AppShortcut(
        intent: HermesResumeTaskIntent(),
        phrases: ["Resume a Hermes task in \(.applicationName)"],
        shortTitle: "Resume Hermes task",
        systemImageName: "play.fill"
      ),
      AppShortcut(
        intent: HermesPauseTaskIntent(),
        phrases: ["Pause a Hermes task in \(.applicationName)"],
        shortTitle: "Pause Hermes task",
        systemImageName: "pause.fill"
      ),
      AppShortcut(
        intent: HermesCancelTaskIntent(),
        phrases: ["Cancel a Hermes task in \(.applicationName)"],
        shortTitle: "Cancel Hermes task",
        systemImageName: "xmark"
      ),
      AppShortcut(
        intent: HermesRetryTaskIntent(),
        phrases: ["Retry a Hermes task in \(.applicationName)"],
        shortTitle: "Retry Hermes task",
        systemImageName: "arrow.clockwise"
      ),
      AppShortcut(
        intent: HermesSummarizeMeetingIntent(),
        phrases: ["Summarize today's meetings with \(.applicationName)"],
        shortTitle: "Summarize meetings",
        systemImageName: "calendar"
      ),
      AppShortcut(
        intent: HermesClipboardToEmailIntent(),
        phrases: ["Turn my clipboard into an email with \(.applicationName)"],
        shortTitle: "Clipboard to email",
        systemImageName: "doc.on.clipboard"
      ),
      AppShortcut(
        intent: HermesDailyReportIntent(),
        phrases: ["Run my daily report with \(.applicationName)"],
        shortTitle: "Daily report",
        systemImageName: "doc.text"
      ),
      AppShortcut(
        intent: HermesVoiceCaptureIntent(),
        phrases: ["Record a voice note with \(.applicationName)"],
        shortTitle: "Voice note",
        systemImageName: "mic"
      ),
    ]
  }
}

private enum HermesTaskControlError: LocalizedError {
  case invalidTaskID

  var errorDescription: String? {
    "A valid Hermes task id is required."
  }
}

struct HermesContextShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    [
      AppShortcut(
        intent: HermesRefreshContextIntent(),
        phrases: ["Refresh Hermes context", "刷新 Hermes 上下文"],
        shortTitle: "Refresh Hermes",
        systemImageName: "arrow.clockwise"
      ),
      AppShortcut(
        intent: HermesCurrentLocationIntent(),
        phrases: ["Get my Hermes location", "获取 Hermes 位置"],
        shortTitle: "Hermes location",
        systemImageName: "location.fill"
      ),
    ]
  }
}
