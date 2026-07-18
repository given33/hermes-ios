import BackgroundTasks
import Foundation

final class HermesBackgroundService {
  static let shared = HermesBackgroundService()
  static let relayWakeNotification = Notification.Name("app.hermes.context.relay-wake")

  static let appRefreshIdentifier = "app.sunstone1029.fig1171.hermes.context-refresh"
  static let processingIdentifier = "app.sunstone1029.fig1171.hermes.context-processing"

  private var registered = false
  private let wakeLock = NSLock()
  private var pendingWakeCompletions: [String: (Bool) -> Void] = [:]

  func register() {
    guard !registered else { return }
    registered = true
    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.appRefreshIdentifier, using: nil) { task in
      self.handle(task: task)
    }
    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.processingIdentifier, using: nil) { task in
      self.handle(task: task)
    }
    schedule()
  }

  func schedule() {
    guard !HermesContextEventQueue.shared.isCollectionSuspended else { return }
    let refresh = BGAppRefreshTaskRequest(identifier: Self.appRefreshIdentifier)
    refresh.earliestBeginDate = Date(timeIntervalSinceNow: 20 * 60)
    try? BGTaskScheduler.shared.submit(refresh)

    let processing = BGProcessingTaskRequest(identifier: Self.processingIdentifier)
    processing.requiresNetworkConnectivity = true
    processing.requiresExternalPower = false
    processing.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
    try? BGTaskScheduler.shared.submit(processing)
  }

  func cancelScheduledTasks() {
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.appRefreshIdentifier)
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingIdentifier)
  }

  @discardableResult
  func notifyRelayWake(reason: String, completion: ((Bool) -> Void)? = nil) -> String {
    guard !HermesContextEventQueue.shared.isCollectionSuspended else {
      completion?(false)
      return ""
    }
    let wakeID = UUID().uuidString.lowercased()
    if let completion {
      wakeLock.lock()
      pendingWakeCompletions[wakeID] = completion
      wakeLock.unlock()
      DispatchQueue.main.asyncAfter(deadline: .now() + 25.0) { [weak self] in
        self?.completeRelayWake(id: wakeID, success: false)
      }
    }
    HermesContextEventQueue.shared.recordRelayWake(id: wakeID, reason: reason)
    NotificationCenter.default.post(
      name: Self.relayWakeNotification,
      object: nil,
      userInfo: ["reason": reason, "wakeId": wakeID]
    )
    return wakeID
  }

  func completeRelayWake(id: String, success: Bool) {
    wakeLock.lock()
    let completion = pendingWakeCompletions.removeValue(forKey: id)
    wakeLock.unlock()
    if success {
      HermesContextEventQueue.shared.completeRelayWake(id: id)
    }
    if let completion {
      DispatchQueue.main.async { completion(success) }
    }
  }

  func pendingRelayWakes() -> [[String: String]] {
    HermesContextEventQueue.shared.pendingRelayWakes()
  }

  private func handle(task: BGTask) {
    guard !HermesContextEventQueue.shared.isCollectionSuspended else {
      task.setTaskCompleted(success: true)
      return
    }
    HermesContextEventQueue.shared.enqueue(type: "background-refresh", payload: [
      "task": String(describing: type(of: task)),
      "timestamp": Date().timeIntervalSince1970 * 1000,
    ])
    schedule()
    let gate = HermesBackgroundTaskGate(task: task)
    let wakeID = notifyRelayWake(reason: "background-task") { success in
      gate.finish(success: success)
    }
    task.expirationHandler = { [weak self] in
      self?.completeRelayWake(id: wakeID, success: false)
    }
  }
}

private final class HermesBackgroundTaskGate {
  private let task: BGTask
  private let lock = NSLock()
  private var finished = false

  init(task: BGTask) { self.task = task }

  func finish(success: Bool) {
    lock.lock()
    guard !finished else {
      lock.unlock()
      return
    }
    finished = true
    lock.unlock()
    task.setTaskCompleted(success: success)
  }
}
