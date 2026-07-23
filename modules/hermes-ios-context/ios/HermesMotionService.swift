import CoreMotion
import Foundation

final class HermesMotionService {
  static let shared = HermesMotionService()

  private let manager = CMMotionActivityManager()
  private let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "app.hermes.motion"
    queue.qualityOfService = .utility
    queue.maxConcurrentOperationCount = 1
    return queue
  }()

  private(set) var snapshot: [String: Any]?
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
    manager.startActivityUpdates(to: queue) { [weak self] activity in
      guard let self, let activity else { return }
      let payload: [String: Any] = [
        "activity": Self.activityName(activity),
        "confidence": Self.confidenceName(activity.confidence),
        "timestamp": activity.startDate.timeIntervalSince1970 * 1000,
      ]
      self.snapshot = payload
      DispatchQueue.main.async {
        HermesLocationService.shared.applyMotionActivity(Self.activityName(activity))
      }
      HermesContextEventQueue.shared.enqueue(
        type: "motion",
        payload: payload,
        occurredAt: activity.startDate
      ) { [weak self] in
        self?.onMotion?(payload)
      }
    }
    return true
  }

  func stop() {
    manager.stopActivityUpdates()
  }

  func resetAccountState() {
    stop()
    snapshot = nil
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
