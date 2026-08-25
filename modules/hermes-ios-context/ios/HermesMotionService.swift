import CoreMotion
import Foundation
import OSLog

// CMMotionActivityManager callbacks fire on the operation queue passed at
// start time; HermesMotionService immediately rebroadcasts to the bridge
// and the location service, both of which require main-thread execution.
// Marking the class @MainActor makes that boundary part of the type system
// and prevents future contributors from invoking a CoreMotion API off
// main (a class of Apple-documented undefined behavior).
@MainActor
final class HermesMotionService {
  static let shared = HermesMotionService()
  private static let logger = Logger(subsystem: "app.hermes", category: "motion-collector")

  private let manager = CMMotionActivityManager()
  private let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "app.hermes.motion"
    queue.qualityOfService = .utility
    queue.maxConcurrentOperationCount = 1
    return queue
  }()
  private let stateLock = NSLock()
  private var activeCollectorToken: HermesCollectorGenerationToken?
  private var storedSnapshot: [String: Any]?

  var snapshot: [String: Any]? {
    stateLock.lock()
    defer { stateLock.unlock() }
    return storedSnapshot
  }
  var onMotion: (([String: Any]) -> Void)?

  func requestAuthorization() async -> String {
    guard CMMotionActivityManager.isActivityAvailable() else { return "unavailable" }
    let current = CMMotionActivityManager.authorizationStatus()
    guard current == .notDetermined else { return HermesAuthorization.motion(current) }

    return await withCheckedContinuation { continuation in
      let gate = HermesMotionAuthorizationGate(continuation)
      manager.queryActivityStarting(
        from: Date().addingTimeInterval(-60),
        to: Date(),
        to: queue
      ) { _, _ in
        gate.resolve(HermesAuthorization.motion(CMMotionActivityManager.authorizationStatus()))
      }
      DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 60) {
        gate.resolve(HermesAuthorization.motion(CMMotionActivityManager.authorizationStatus()))
      }
    }
  }

  @discardableResult
  func start() -> Bool {
    guard HermesPermissionCollectionGate.shared.isReadyForCurrentOwner else { return false }
    guard CMMotionActivityManager.isActivityAvailable() else { return false }
    guard CMMotionActivityManager.authorizationStatus() == .authorized else { return false }
    guard let token = HermesAccountLifecycle.captureCollectorGeneration() else {
      Self.logger.error("Motion collector start rejected: no active generation")
      return false
    }
    var started = false
    let current = HermesAccountLifecycle.performIfCurrentCollectorGeneration(token) {
      activateAccountGeneration(token)
      manager.stopActivityUpdates()
      manager.startActivityUpdates(to: queue) { [weak self] activity in
        guard let self, let activity else { return }
        self.handle(activity, token: token)
      }
      started = true
    }
    if !current { Self.logger.error("Motion collector start rejected: stale generation") }
    return current && started
  }

  func stop() {
    manager.stopActivityUpdates()
  }

  func resetAccountState() {
    stop()
    stateLock.lock()
    activeCollectorToken = nil
    storedSnapshot = nil
    stateLock.unlock()
  }

  func activateAccountGeneration(_ token: HermesCollectorGenerationToken) {
    stateLock.lock()
    let changed = activeCollectorToken != token
    if changed {
      activeCollectorToken = token
      storedSnapshot = nil
    }
    stateLock.unlock()
    if changed { manager.stopActivityUpdates() }
  }

  private func handle(
    _ activity: CMMotionActivity,
    token: HermesCollectorGenerationToken
  ) {
    let accepted = HermesAccountLifecycle.performIfCurrentCollectorGeneration(token) {
      stateLock.lock()
      let isActive = activeCollectorToken == token
      stateLock.unlock()
      guard isActive else {
        Self.logger.error("Motion callback rejected: inactive generation")
        return
      }
      guard token.accepts(activity.startDate) else {
        Self.logger.error("Motion callback rejected: invalid or out-of-generation timestamp")
        return
      }
      let activityName = Self.activityName(activity)
      let payload: [String: Any] = [
        "activity": activityName,
        "confidence": Self.confidenceName(activity.confidence),
        "timestamp": activity.startDate.timeIntervalSince1970 * 1000,
      ]
      stateLock.lock()
      storedSnapshot = payload
      stateLock.unlock()
      HermesContextEventQueue.shared.enqueue(
        type: "motion",
        payload: payload,
        occurredAt: activity.startDate,
        accountGeneration: token.lifecycleEpoch
      ) { [weak self] in
        self?.onMotion?(payload)
      }
      DispatchQueue.main.async {
        HermesLocationService.shared.applyMotionActivity(
          activityName,
          collectorToken: token
        )
      }
    }
    if !accepted { Self.logger.error("Motion callback rejected: stale generation") }
  }

  private static func activityName(_ activity: CMMotionActivity) -> String {
    if activity.automotive { return "automotive" }
    if activity.cycling { return "cycling" }
    if activity.running { return "running" }
    if activity.walking { return "walking" }
    if activity.stationary { return "stationary" }
    return "unknown"
  }

  private static func confidenceName(_ confidence: CMMotionActivityConfidence) -> String {
    switch confidence {
    case .high: return "high"
    case .medium: return "medium"
    case .low: return "low"
    @unknown default: return "unknown"
    }
  }
}

private final class HermesMotionAuthorizationGate: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<String, Never>?

  init(_ continuation: CheckedContinuation<String, Never>) {
    self.continuation = continuation
  }

  func resolve(_ status: String) {
    lock.lock()
    let pending = continuation
    continuation = nil
    lock.unlock()
    pending?.resume(returning: status)
  }
}
