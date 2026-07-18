import CoreLocation
import CoreMotion
import HealthKit
import SwiftUI
import WatchConnectivity

@main
struct HermesWatchApp: App {
  @StateObject private var relay = HermesWatchRelay()

  var body: some Scene {
    WindowGroup {
      VStack(spacing: 8) {
        Image(systemName: relay.reachable ? "iphone.radiowaves.left.and.right" : "iphone.slash")
          .font(.title2)
          .foregroundStyle(relay.reachable ? .green : .secondary)
        Text(relay.reachable ? "Hermes connected" : "Queued for iPhone")
          .font(.caption)
          .multilineTextAlignment(.center)
        HStack(spacing: 8) {
          Button {
            relay.captureContext()
          } label: {
            Image(systemName: "arrow.clockwise")
          }
          .buttonStyle(.bordered)
          .accessibilityLabel("Refresh context")

          Button {
            relay.toggleActiveRelay()
          } label: {
            Image(systemName: relay.activeRelay ? "stop.fill" : "figure.walk.motion")
          }
          .buttonStyle(.borderedProminent)
          .tint(relay.activeRelay ? .red : .accentColor)
          .accessibilityLabel(relay.activeRelay ? "Stop active relay" : "Start active relay")
        }
      }
      .padding()
      .onAppear { relay.start() }
    }
  }
}

@MainActor
final class HermesWatchRelay: NSObject, ObservableObject, CLLocationManagerDelegate,
  WCSessionDelegate, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
  @Published private(set) var activeRelay = false
  @Published private(set) var reachable = false

  private let activityManager = CMMotionActivityManager()
  private let healthStore = HKHealthStore()
  private let locationManager = CLLocationManager()
  private let motionQueue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "app.hermes.watch.motion"
    queue.qualityOfService = .utility
    queue.maxConcurrentOperationCount = 1
    return queue
  }()
  private let session = WCSession.default
  private let accountGenerationKey = "app.hermes.watch.accountGeneration"
  private var healthReady = false
  private var latestMotion = "unknown"
  private var workoutBuilder: HKLiveWorkoutBuilder?
  private var workoutSession: HKWorkoutSession?
  private lazy var sourceDeviceID: String = {
    let key = "app.hermes.watch.installation-id"
    if let existing = UserDefaults.standard.string(forKey: key), !existing.isEmpty {
      return existing
    }
    let value = "watch-\(UUID().uuidString.lowercased())"
    UserDefaults.standard.set(value, forKey: key)
    return value
  }()

  override init() {
    super.init()
    locationManager.delegate = self
    locationManager.activityType = .fitness
    locationManager.allowsBackgroundLocationUpdates = true
    locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    locationManager.distanceFilter = 50
  }

  func start() {
    if WCSession.isSupported() {
      session.delegate = self
      session.activate()
    }
    locationManager.requestWhenInUseAuthorization()
    startMotionUpdates()
    Task {
      await requestHealthAuthorization()
      if session.activationState == .activated { captureContext() }
    }
  }

  func toggleActiveRelay() {
    if activeRelay {
      stopActiveRelay(reason: "watch-control")
    } else {
      Task { await startActiveRelay(activity: "walking", reason: "watch-control") }
    }
  }

  func captureContext() {
    let locationStatus = locationManager.authorizationStatus
    if locationStatus == .authorizedWhenInUse || locationStatus == .authorizedAlways {
      locationManager.requestLocation()
    }
    var payload: [String: Any] = [
      "activeRelay": activeRelay,
      "kind": "watch-context",
      "motion": latestMotion,
      "observedAt": Date().timeIntervalSince1970 * 1000,
    ]
    if let location = locationManager.location {
      payload["location"] = locationPayload(location)
    }
    guard healthReady,
          let steps = HKObjectType.quantityType(forIdentifier: .stepCount) else {
      send(payload)
      return
    }
    let start = Calendar.current.startOfDay(for: Date())
    let predicate = HKQuery.predicateForSamples(withStart: start, end: Date())
    let query = HKStatisticsQuery(
      quantityType: steps,
      quantitySamplePredicate: predicate,
      options: .cumulativeSum
    ) { [weak self] _, result, _ in
      var next = payload
      next["steps"] = result?.sumQuantity()?.doubleValue(for: .count()) ?? 0
      Task { @MainActor in self?.send(next) }
    }
    healthStore.execute(query)
  }

  private func requestHealthAuthorization() async {
    guard !healthReady, HKHealthStore.isHealthDataAvailable() else { return }
    var read = Set<HKObjectType>([HKObjectType.workoutType()])
    for type in [
      HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
      HKObjectType.quantityType(forIdentifier: .heartRate),
      HKObjectType.quantityType(forIdentifier: .stepCount),
    ].compactMap({ $0 }) {
      read.insert(type)
    }
    let share: Set<HKSampleType> = [HKObjectType.workoutType()]
    try? await healthStore.requestAuthorization(toShare: share, read: read)
    healthReady = true
  }

  private func startMotionUpdates() {
    guard CMMotionActivityManager.isActivityAvailable() else { return }
    activityManager.startActivityUpdates(to: motionQueue) { [weak self] activity in
      guard let activity else { return }
      let motion = Self.motionName(activity)
      Task { @MainActor in
        guard let self else { return }
        self.latestMotion = motion
        self.send([
          "confidence": Self.confidenceName(activity.confidence),
          "kind": "watch-motion",
          "motion": motion,
          "observedAt": activity.startDate.timeIntervalSince1970 * 1000,
        ])
      }
    }
  }

  private func startActiveRelay(activity: String, reason: String) async {
    guard workoutSession == nil else { return }
    await requestHealthAuthorization()
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = Self.workoutType(activity)
    configuration.locationType = .outdoor
    do {
      let nextSession = try HKWorkoutSession(
        healthStore: healthStore,
        configuration: configuration
      )
      let builder = nextSession.associatedWorkoutBuilder()
      builder.dataSource = HKLiveWorkoutDataSource(
        healthStore: healthStore,
        workoutConfiguration: configuration
      )
      builder.delegate = self
      nextSession.delegate = self
      workoutSession = nextSession
      workoutBuilder = builder
      activeRelay = true
      locationManager.desiredAccuracy = kCLLocationAccuracyBest
      locationManager.distanceFilter = 5
      locationManager.startUpdatingLocation()
      let startedAt = Date()
      nextSession.startActivity(with: startedAt)
      builder.beginCollection(withStart: startedAt) { [weak self] succeeded, error in
        Task { @MainActor in
          self?.send([
            "activity": activity,
            "error": error?.localizedDescription ?? "",
            "kind": "watch-workout",
            "observedAt": startedAt.timeIntervalSince1970 * 1000,
            "reason": reason,
            "state": succeeded ? "started" : "failed",
          ])
        }
      }
    } catch {
      activeRelay = false
      send([
        "error": error.localizedDescription,
        "kind": "watch-workout",
        "observedAt": Date().timeIntervalSince1970 * 1000,
        "reason": reason,
        "state": "failed",
      ])
    }
  }

  private func stopActiveRelay(reason: String) {
    guard let workoutSession else { return }
    workoutSession.end()
    activeRelay = false
    locationManager.stopUpdatingLocation()
    locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    locationManager.distanceFilter = 50
    send([
      "kind": "watch-workout",
      "observedAt": Date().timeIntervalSince1970 * 1000,
      "reason": reason,
      "state": "stopping",
    ])
  }

  private func handle(_ message: [String: Any]) {
    switch message["action"] as? String {
    case "set-account-generation":
      if let generation = (message["accountGeneration"] as? NSNumber)?.intValue {
        UserDefaults.standard.set(generation, forKey: accountGenerationKey)
      }
    case "refresh-context", "start-active-relay", "start-navigation", "stop-active-relay", "stop-navigation":
      let generation = (message["accountGeneration"] as? NSNumber)?.intValue
      guard generation == UserDefaults.standard.integer(forKey: accountGenerationKey) else { return }
      handleAccountCommand(message)
    default:
      break
    }
  }

  private func handleAccountCommand(_ message: [String: Any]) {
    switch message["action"] as? String {
    case "refresh-context":
      captureContext()
    case "start-active-relay", "start-navigation":
      let activity = message["activity"] as? String ?? "walking"
      let reason = message["action"] as? String ?? "iphone-command"
      Task { await startActiveRelay(activity: activity, reason: reason) }
    case "stop-active-relay", "stop-navigation":
      stopActiveRelay(reason: message["action"] as? String ?? "iphone-command")
    default:
      break
    }
  }

  private func send(_ payload: [String: Any]) {
    var envelope = payload
    envelope["accountGeneration"] = UserDefaults.standard.integer(forKey: accountGenerationKey)
    envelope["sourceDeviceId"] = sourceDeviceID
    if session.isReachable {
      session.sendMessage(envelope, replyHandler: nil) { [weak self] _ in
        self?.session.transferUserInfo(envelope)
      }
    } else {
      session.transferUserInfo(envelope)
    }
  }

  private func locationPayload(_ location: CLLocation) -> [String: Any] {
    [
      "accuracy": location.horizontalAccuracy,
      "altitude": location.altitude,
      "course": location.course,
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "motion": latestMotion,
      "speed": max(0, location.speed),
      "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
    ]
  }

  nonisolated func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    Task { @MainActor in
      self.reachable = error == nil && session.isReachable
      if error == nil && self.healthReady { self.captureContext() }
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    Task { @MainActor in self.reachable = session.isReachable }
  }

  nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    Task { @MainActor in self.handle(message) }
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    // The iPhone relay awaits this ACK before completing its durable command.
    // Acknowledge receipt immediately; native command execution stays on the
    // main actor and emits its own context events.
    replyHandler(["accepted": true])
    Task { @MainActor in self.handle(message) }
  }

  nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    Task { @MainActor in self.handle(userInfo) }
  }

  nonisolated func locationManager(
    _ manager: CLLocationManager,
    didUpdateLocations locations: [CLLocation]
  ) {
    guard let location = locations.last,
          location.horizontalAccuracy >= 0,
          CLLocationCoordinate2DIsValid(location.coordinate) else { return }
    Task { @MainActor in
      var payload = self.locationPayload(location)
      payload["kind"] = "watch-location"
      payload["observedAt"] = location.timestamp.timeIntervalSince1970 * 1000
      self.send(payload)
    }
  }

  nonisolated func workoutSession(
    _ workoutSession: HKWorkoutSession,
    didChangeTo toState: HKWorkoutSessionState,
    from fromState: HKWorkoutSessionState,
    date: Date
  ) {
    guard toState == .ended else { return }
    Task { @MainActor in
      let builder = self.workoutBuilder
      builder?.endCollection(withEnd: date) { _, _ in builder?.discardWorkout() }
      self.workoutBuilder = nil
      self.workoutSession = nil
      self.activeRelay = false
      self.locationManager.stopUpdatingLocation()
      self.locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      self.locationManager.distanceFilter = 50
      self.send([
        "kind": "watch-workout",
        "observedAt": date.timeIntervalSince1970 * 1000,
        "state": "ended",
      ])
    }
  }

  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    Task { @MainActor in
      self.workoutBuilder?.discardWorkout()
      self.workoutBuilder = nil
      self.workoutSession = nil
      self.activeRelay = false
      self.locationManager.stopUpdatingLocation()
      self.locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      self.locationManager.distanceFilter = 50
      self.send([
        "error": error.localizedDescription,
        "kind": "watch-workout",
        "observedAt": Date().timeIntervalSince1970 * 1000,
        "state": "failed",
      ])
    }
  }

  nonisolated func workoutBuilder(
    _ workoutBuilder: HKLiveWorkoutBuilder,
    didCollectDataOf collectedTypes: Set<HKSampleType>
  ) {
    var metrics: [String: Any] = [:]
    for type in collectedTypes {
      guard let quantityType = type as? HKQuantityType,
            let statistics = workoutBuilder.statistics(for: quantityType) else { continue }
      switch quantityType.identifier {
      case HKQuantityTypeIdentifier.heartRate.rawValue:
        let unit = HKUnit.count().unitDivided(by: .minute())
        metrics["heartRateBpm"] = statistics.mostRecentQuantity()?.doubleValue(for: unit)
      case HKQuantityTypeIdentifier.activeEnergyBurned.rawValue:
        metrics["activeEnergyKcal"] = statistics.sumQuantity()?.doubleValue(for: HKUnit.kilocalorie())
      case HKQuantityTypeIdentifier.stepCount.rawValue:
        metrics["steps"] = statistics.sumQuantity()?.doubleValue(for: HKUnit.count())
      default:
        continue
      }
    }
    guard !metrics.isEmpty else { return }
    Task { @MainActor in
      self.send([
        "kind": "watch-workout-sample",
        "metrics": metrics,
        "motion": self.latestMotion,
        "observedAt": Date().timeIntervalSince1970 * 1000,
      ])
    }
  }

  nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

  private static func workoutType(_ value: String) -> HKWorkoutActivityType {
    switch value.lowercased() {
    case "cycling", "bike", "bicycling": return .cycling
    case "running", "run": return .running
    case "hiking": return .hiking
    default: return .walking
    }
  }

  private static func motionName(_ activity: CMMotionActivity) -> String {
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
