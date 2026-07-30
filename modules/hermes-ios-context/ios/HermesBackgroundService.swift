import BackgroundTasks
import Foundation
import UIKit

final class HermesBackgroundService {
  static let shared = HermesBackgroundService()
  static let relayWakeNotification = Notification.Name("app.hermes.context.relay-wake")

  static let appRefreshIdentifier = "app.sunstone1029.fig1171.hermes.context-refresh"
  static let processingIdentifier = "app.sunstone1029.fig1171.hermes.context-processing"

  private let stateLock = NSLock()
  private var registered = false
  private var readyToken: HermesCollectorGenerationToken?
  private var runningOperations: [UUID: HermesRunningBackgroundOperation] = [:]
  private let wakeLock = NSLock()
  private var pendingWakeCompletions: [String: (Bool) -> Void] = [:]
  private let retryStateKey = "app.hermes.background.retry-state-v1"

  func register() {
    stateLock.lock()
    guard !registered else {
      stateLock.unlock()
      return
    }
    registered = true
    stateLock.unlock()

    BGTaskScheduler.shared.register(
      forTaskWithIdentifier: Self.appRefreshIdentifier,
      using: nil
    ) { [weak self] task in
      self?.handle(task: task)
    }
    BGTaskScheduler.shared.register(
      forTaskWithIdentifier: Self.processingIdentifier,
      using: nil
    ) { [weak self] task in
      self?.handle(task: task)
    }
    schedule()
  }

  func schedule(earliestRetryAt: Date? = nil) {
    let retryAt = earliestRetryAt ?? persistedRetryDate()
    let hasRunnableOwner = !HermesContextEventQueue.shared.isCollectionSuspended
      && HermesContextEventQueue.shared.hasCurrentOwner
    guard hasRunnableOwner || retryAt != nil else { return }
    let refresh = BGAppRefreshTaskRequest(identifier: Self.appRefreshIdentifier)
    refresh.earliestBeginDate = maxDate(
      Date(timeIntervalSinceNow: 20 * 60),
      retryAt
    )
    try? BGTaskScheduler.shared.submit(refresh)

    let processing = BGProcessingTaskRequest(identifier: Self.processingIdentifier)
    processing.requiresNetworkConnectivity = true
    processing.requiresExternalPower = false
    processing.earliestBeginDate = maxDate(
      Date(timeIntervalSinceNow: 60 * 60),
      retryAt
    )
    try? BGTaskScheduler.shared.submit(processing)
  }

  func cancelScheduledTasks() {
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.appRefreshIdentifier)
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingIdentifier)
    stateLock.lock()
    let operations = Array(runningOperations.values)
    runningOperations.removeAll()
    readyToken = nil
    stateLock.unlock()
    for operation in operations {
      operation.cancel(reason: "account-deleted")
      if let wakeID = operation.wakeID {
        completeRelayWake(id: wakeID, success: false)
      }
      operation.finish(success: true)
    }
    clearRetryState()
  }

  @discardableResult
  func setRelayReady(
    ownerScope: String,
    accountGeneration: String,
    ready: Bool
  ) -> Bool {
    guard let token = HermesContextEventQueue.shared.currentCollectorGenerationToken(),
          token.ownerScope == ownerScope,
          token.serverAccountGeneration == accountGeneration else { return false }
    stateLock.lock()
    defer { stateLock.unlock() }
    if ready {
      readyToken = token
      return true
    }
    if readyToken == token { readyToken = nil }
    return true
  }

  @discardableResult
  func notifyRelayWake(reason: String, completion: ((Bool) -> Void)? = nil) -> String {
    guard !HermesContextEventQueue.shared.isCollectionSuspended,
          HermesContextEventQueue.shared.hasCurrentOwner else {
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
      if HermesContextEventQueue.shared.pendingRelayWakes().isEmpty {
        clearRetryState()
      }
    }
    if let completion {
      DispatchQueue.main.async { completion(success) }
    }
  }

  func pendingRelayWakes() -> [[String: String]] {
    HermesContextEventQueue.shared.pendingRelayWakes()
  }

  private func handle(task: BGTask) {
    schedule()
    let operation = HermesRunningBackgroundOperation(
      task: task,
      taskIdentifier: String(describing: type(of: task))
    )
    stateLock.lock()
    runningOperations[operation.id] = operation
    stateLock.unlock()

    task.expirationHandler = { [weak self] in
      self?.expireOperation(id: operation.id)
    }
    let worker = Task { [weak self] in
      await self?.performNativeWork(operationID: operation.id)
    }
    operation.install(worker: worker)
  }

  private func performNativeWork(operationID: UUID) async {
    guard let operation = operation(id: operationID) else { return }
    let protectedDataAvailable = await MainActor.run {
      UIApplication.shared.isProtectedDataAvailable
    }
    guard protectedDataAvailable else {
      completeOperation(
        id: operationID,
        success: false,
        retryReason: "protected-data-unavailable"
      )
      return
    }
    guard !HermesContextEventQueue.shared.isCollectionSuspended,
          let token = HermesContextEventQueue.shared.currentCollectorGenerationToken() else {
      completeOperation(id: operationID, success: true)
      return
    }
    operation.set(token: token)
    guard !Task.isCancelled else { return }

    HermesScreenTimeService.shared.consumeExtensionEvents()
    _ = HermesHealthService.shared.resumeBackgroundCollection()
    _ = await MainActor.run { HermesDeviceService.shared.recordSnapshot() }
    guard !Task.isCancelled,
          HermesContextEventQueue.shared.isCurrentCollectorGenerationToken(token) else {
      completeOperation(id: operationID, success: true)
      return
    }

    let pendingCount = HermesContextEventQueue.shared.read(
      limit: 1_000,
      scope: token.ownerScope
    ).count
    let persisted = HermesContextEventQueue.shared.enqueue(
      type: "background-refresh",
      payload: [
        "nativeMaintenanceCompleted": true,
        "pendingEventCount": pendingCount,
        "task": operation.taskIdentifier,
        "timestamp": Date().timeIntervalSince1970 * 1000,
      ],
      accountGeneration: token.lifecycleEpoch
    )
    guard persisted else {
      completeOperation(id: operationID, success: false, retryReason: "native-persistence-failed")
      return
    }
    schedule()

    guard await waitForRelayReady(token, timeout: 5) else {
      _ = notifyRelayWake(reason: "background-task-js-not-ready")
      completeOperation(id: operationID, success: false, retryReason: "javascript-not-ready")
      return
    }
    let wakeID = notifyRelayWake(reason: "background-task") { [weak self] success in
      guard let self, let operation = self.operation(id: operationID) else { return }
      let reason = success ? nil : operation.failureReason ?? "relay-failed"
      self.completeOperation(id: operationID, success: success, retryReason: reason)
    }
    guard !wakeID.isEmpty else {
      completeOperation(id: operationID, success: false, retryReason: "relay-unavailable")
      return
    }
    operation.set(wakeID: wakeID)
  }

  private func expireOperation(id: UUID) {
    guard let operation = operation(id: id) else { return }
    operation.cancel(reason: "expired")
    if let wakeID = operation.wakeID {
      wakeLock.lock()
      pendingWakeCompletions.removeValue(forKey: wakeID)
      wakeLock.unlock()
    }
    completeOperation(id: id, success: false, retryReason: "expired")
  }

  private func completeOperation(
    id: UUID,
    success: Bool,
    retryReason: String? = nil
  ) {
    stateLock.lock()
    let operation = runningOperations.removeValue(forKey: id)
    stateLock.unlock()
    guard let operation else { return }

    var retryAt: Date?
    if success {
      clearRetryState(matching: operation.token)
    } else if let retryReason {
      retryAt = persistRetryState(
        reason: retryReason,
        taskIdentifier: operation.taskIdentifier,
        token: operation.token
      )
    }
    schedule(earliestRetryAt: retryAt)
    operation.finish(success: success)
  }

  private func relayIsReady(for token: HermesCollectorGenerationToken) -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return readyToken == token
  }

  private func waitForRelayReady(
    _ token: HermesCollectorGenerationToken,
    timeout: TimeInterval
  ) async -> Bool {
    let deadline = Date(timeIntervalSinceNow: timeout)
    while !Task.isCancelled {
      if relayIsReady(for: token) { return true }
      if Date() >= deadline { return false }
      try? await Task.sleep(nanoseconds: 200_000_000)
    }
    return false
  }

  private func operation(id: UUID) -> HermesRunningBackgroundOperation? {
    stateLock.lock()
    defer { stateLock.unlock() }
    return runningOperations[id]
  }

  private func persistRetryState(
    reason: String,
    taskIdentifier: String,
    token: HermesCollectorGenerationToken?
  ) -> Date {
    stateLock.lock()
    defer { stateLock.unlock() }
    let defaults = UserDefaults.standard
    let previous = defaults.dictionary(forKey: retryStateKey) ?? [:]
    let previousGeneration = previous["accountGeneration"] as? String
    let attempts = previousGeneration == token?.serverAccountGeneration
      ? min((previous["attempts"] as? Int ?? 0) + 1, 8)
      : 1
    let delay = min(15 * 60 * pow(2, Double(attempts - 1)), 6 * 60 * 60)
    let now = Date().timeIntervalSince1970 * 1000
    let nextAttemptAt = now + delay * 1000
    defaults.set([
      "accountGeneration": token?.serverAccountGeneration ?? "",
      "accountUUID": token?.accountUUID ?? "",
      "attempts": attempts,
      "lifecycleEpoch": token?.lifecycleEpoch ?? 0,
      "nextAttemptAt": nextAttemptAt,
      "reason": String(reason.prefix(128)),
      "task": String(taskIdentifier.prefix(128)),
      "updatedAt": now,
    ], forKey: retryStateKey)
    defaults.synchronize()
    return Date(timeIntervalSince1970: nextAttemptAt / 1000)
  }

  private func clearRetryState(matching token: HermesCollectorGenerationToken? = nil) {
    stateLock.lock()
    defer { stateLock.unlock() }
    let defaults = UserDefaults.standard
    if let token,
       let state = defaults.dictionary(forKey: retryStateKey),
       state["accountGeneration"] as? String != token.serverAccountGeneration {
      return
    }
    defaults.removeObject(forKey: retryStateKey)
    defaults.synchronize()
  }

  private func persistedRetryDate() -> Date? {
    stateLock.lock()
    defer { stateLock.unlock() }
    let value = UserDefaults.standard.dictionary(forKey: retryStateKey)?["nextAttemptAt"]
    let milliseconds = (value as? NSNumber)?.doubleValue ?? value as? Double
    guard let milliseconds,
      milliseconds.isFinite,
      milliseconds > 0 else { return nil }
    return Date(timeIntervalSince1970: milliseconds / 1000)
  }

  private func maxDate(_ baseline: Date, _ candidate: Date?) -> Date {
    guard let candidate else { return baseline }
    return candidate > baseline ? candidate : baseline
  }
}

private final class HermesRunningBackgroundOperation {
  let id = UUID()
  let taskIdentifier: String
  private let completionGate: HermesBackgroundTaskGate
  private let lock = NSLock()
  private var worker: Task<Void, Never>?
  private var storedWakeID: String?
  private var storedToken: HermesCollectorGenerationToken?
  private var storedFailureReason: String?
  private var cancelled = false

  init(task: BGTask, taskIdentifier: String) {
    completionGate = HermesBackgroundTaskGate(task: task)
    self.taskIdentifier = taskIdentifier
  }

  var wakeID: String? {
    lock.lock()
    defer { lock.unlock() }
    return storedWakeID
  }

  var token: HermesCollectorGenerationToken? {
    lock.lock()
    defer { lock.unlock() }
    return storedToken
  }

  var failureReason: String? {
    lock.lock()
    defer { lock.unlock() }
    return storedFailureReason
  }

  func install(worker: Task<Void, Never>) {
    lock.lock()
    self.worker = worker
    let shouldCancel = cancelled
    lock.unlock()
    if shouldCancel { worker.cancel() }
  }

  func set(wakeID: String) {
    lock.lock()
    storedWakeID = wakeID
    lock.unlock()
  }

  func set(token: HermesCollectorGenerationToken) {
    lock.lock()
    storedToken = token
    lock.unlock()
  }

  func cancel(reason: String) {
    lock.lock()
    cancelled = true
    storedFailureReason = reason
    let worker = worker
    lock.unlock()
    worker?.cancel()
  }

  func finish(success: Bool) {
    completionGate.finish(success: success)
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
