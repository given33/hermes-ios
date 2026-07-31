import AppIntents
import Foundation

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

private enum HermesTaskControlError: LocalizedError {
  case invalidTaskID

  var errorDescription: String? {
    "A valid Hermes task id is required."
  }
}
