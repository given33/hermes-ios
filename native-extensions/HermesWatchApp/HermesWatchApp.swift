import CoreLocation
import CoreMotion
import HealthKit
import OSLog
import SwiftUI
import WatchConnectivity

private struct HermesWatchAccountFence: Equatable {
  let accountUUID: String
  let serverGeneration: String
  let lifecycleEpoch: Int
  let resetAt: Double

  func envelope(_ payload: [String: Any]) -> [String: Any] {
    var result = payload
    result["accountUUID"] = accountUUID
    result["accountEpoch"] = lifecycleEpoch
    result["accountGeneration"] = lifecycleEpoch
    result["account_generation"] = serverGeneration
    result["accountResetAt"] = resetAt
    return result
  }

  func matches(_ payload: [String: Any]) -> Bool {
    let epoch = (payload["accountEpoch"] as? NSNumber)?.intValue
      ?? payload["accountEpoch"] as? Int
    let legacyEpoch = (payload["accountGeneration"] as? NSNumber)?.intValue
      ?? payload["accountGeneration"] as? Int
    let payloadResetAt = (payload["accountResetAt"] as? NSNumber)?.doubleValue
      ?? payload["accountResetAt"] as? Double
    return payload["accountUUID"] as? String == accountUUID
      && payload["account_generation"] as? String == serverGeneration
      && epoch == lifecycleEpoch
      && legacyEpoch == lifecycleEpoch
      && payloadResetAt == resetAt
  }
}

private enum HermesWatchRelayMode: Equatable {
  case navigation
  case workout
}

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
  private static let logger = Logger(subsystem: "app.sunstone1029.fig1171", category: "watch-relay")
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
  private let accountCollectionEnabledKey = "app.hermes.watch.accountCollectionEnabled"
  private let accountControlIssuedAtKey = "app.hermes.watch.accountControlIssuedAt"
  private let accountGenerationKey = "app.hermes.watch.accountGeneration"
  private let serverAccountGenerationKey = "app.hermes.watch.serverAccountGeneration"
  private let accountUUIDKey = "app.hermes.watch.accountUUID"
  private let accountResetAtKey = "app.hermes.watch.accountResetAt"
  private let lastAcknowledgedEventAtKey = "app.hermes.watch.lastAcknowledgedEventAt"
  private var healthReady = false
  private var latestMotion = "unknown"
  private var permissionSequenceGeneration: Int?
  private var activeOperationFence: HermesWatchAccountFence?
  private var activeRelayMode: HermesWatchRelayMode?
  private var pendingLocationFence: HermesWatchAccountFence?
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
    beginAccountPermissionSequence()
  }

  func toggleActiveRelay() {
    if activeRelay {
      stopContinuousRelay(reason: "watch-control")
    } else {
      Task { await startActiveRelay(activity: "walking", reason: "watch-control") }
    }
  }

  func captureContext() {
    guard let fence = captureAccountFence() else { return }
    let locationStatus = locationManager.authorizationStatus
    if locationStatus == .authorizedWhenInUse || locationStatus == .authorizedAlways {
      pendingLocationFence = fence
      locationManager.requestLocation()
    }
    var payload: [String: Any] = [
      "activeRelay": activeRelay,
      "kind": "watch-context",
      "motion": latestMotion,
      "observedAt": Date().timeIntervalSince1970 * 1000,
    ]
    if let location = locationManager.location,
       accepts(location.timestamp, for: fence) {
      payload["location"] = locationPayload(location)
    }
    guard healthReady,
          let steps = HKObjectType.quantityType(forIdentifier: .stepCount) else {
      send(payload, fence: fence)
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
      Task { @MainActor in self?.send(next, fence: fence) }
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
    do {
      try await healthStore.requestAuthorization(toShare: share, read: read)
      healthReady = true
    } catch {
      healthReady = false
    }
  }

  private func beginAccountPermissionSequence() {
    guard let fence = captureAccountFence(),
          permissionSequenceGeneration != fence.lifecycleEpoch else { return }
    permissionSequenceGeneration = fence.lifecycleEpoch
    let status = locationManager.authorizationStatus
    if status == .notDetermined {
      locationManager.requestWhenInUseAuthorization()
      return
    }
    requestMotionAuthorization(for: fence)
  }

  private func requestMotionAuthorization(for fence: HermesWatchAccountFence) {
    guard isCurrent(fence) else { return }
    guard CMMotionActivityManager.isActivityAvailable() else {
      finishAccountPermissionSequence(fence: fence)
      return
    }
    if CMMotionActivityManager.authorizationStatus() == .notDetermined {
      activityManager.queryActivityStarting(
        from: Date().addingTimeInterval(-60),
        to: Date(),
        to: motionQueue
      ) { [weak self] _, _ in
        Task { @MainActor in self?.finishAccountPermissionSequence(fence: fence) }
      }
      return
    }
    finishAccountPermissionSequence(fence: fence)
  }

  private func finishAccountPermissionSequence(fence: HermesWatchAccountFence) {
    guard isCurrent(fence) else { return }
    if CMMotionActivityManager.authorizationStatus() == .authorized {
      startMotionUpdates(fence: fence)
    }
    Task {
      await requestHealthAuthorization()
      guard isCurrent(fence) else { return }
      if session.activationState == .activated { captureContext() }
    }
  }

  private func startMotionUpdates(fence: HermesWatchAccountFence) {
    guard CMMotionActivityManager.authorizationStatus() == .authorized else { return }
    activityManager.stopActivityUpdates()
    activityManager.startActivityUpdates(to: motionQueue) { [weak self] activity in
      guard let activity else { return }
      Task { @MainActor in
        guard let self, self.isCurrent(fence) else { return }
        let motion = Self.motionName(activity)
        self.latestMotion = motion
        self.send([
          "confidence": Self.confidenceName(activity.confidence),
          "kind": "watch-motion",
          "motion": motion,
          "observedAt": activity.startDate.timeIntervalSince1970 * 1000,
        ], fence: fence)
      }
    }
  }

  private func startActiveRelay(activity: String, reason: String) async {
    let status = locationManager.authorizationStatus
    guard let fence = captureAccountFence(),
          healthReady,
          status == .authorizedWhenInUse || status == .authorizedAlways,
          workoutSession == nil,
          activeRelayMode == nil else { return }
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
      activeOperationFence = fence
      activeRelayMode = .workout
      activeRelay = true
      locationManager.desiredAccuracy = kCLLocationAccuracyBest
      locationManager.distanceFilter = 5
      locationManager.startUpdatingLocation()
      let startedAt = Date()
      nextSession.startActivity(with: startedAt)
      builder.beginCollection(withStart: startedAt) { [weak self] succeeded, error in
        Task { @MainActor in
          guard let self, self.workoutBuilder === builder else { return }
          if !self.isCurrent(fence) {
            // Stale fence: clean up the workout/location resources but do
            // NOT send the callback (the phone has moved to a new account
            // generation). Leaving the workout session and Best-accuracy
            // location running drains the watch battery until reconnect.
            self.workoutSession?.end()
            self.workoutBuilder?.discardWorkout()
            self.workoutBuilder = nil
            self.workoutSession = nil
            self.activeOperationFence = nil
            self.activeRelayMode = nil
            self.activeRelay = false
            self.locationManager.stopUpdatingLocation()
            return
          }
          self.send([
            "activity": activity,
            "error": error?.localizedDescription ?? "",
            "kind": "watch-workout",
            "observedAt": startedAt.timeIntervalSince1970 * 1000,
            "reason": reason,
            "state": succeeded ? "started" : "failed",
          ], fence: fence)
          guard !succeeded else { return }
          self.workoutSession?.end()
          self.workoutBuilder?.discardWorkout()
          self.workoutBuilder = nil
          self.workoutSession = nil
          self.activeOperationFence = nil
          self.activeRelayMode = nil
          self.activeRelay = false
          self.locationManager.stopUpdatingLocation()
        }
      }
    } catch {
      activeOperationFence = nil
      activeRelayMode = nil
      activeRelay = false
      send([
        "error": error.localizedDescription,
        "kind": "watch-workout",
        "observedAt": Date().timeIntervalSince1970 * 1000,
        "reason": reason,
        "state": "failed",
      ], fence: fence)
    }
  }

  private func startNavigationRelay(reason: String) {
    let status = locationManager.authorizationStatus
    guard let fence = captureAccountFence(),
          status == .authorizedWhenInUse || status == .authorizedAlways,
          activeRelayMode == nil,
          workoutSession == nil else { return }
    activeOperationFence = fence
    activeRelayMode = .navigation
    activeRelay = true
    locationManager.desiredAccuracy = kCLLocationAccuracyBest
    locationManager.distanceFilter = 5
    locationManager.startUpdatingLocation()
    send([
      "kind": "watch-navigation",
      "observedAt": Date().timeIntervalSince1970 * 1000,
      "reason": reason,
      "state": "started",
    ], fence: fence)
  }

  private func stopContinuousRelay(reason: String) {
    guard let mode = activeRelayMode, let fence = activeOperationFence else { return }
    if mode == .workout {
      workoutSession?.end()
    }
    locationManager.stopUpdatingLocation()
    locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    locationManager.distanceFilter = 50
    activeRelay = false
    send([
      "kind": mode == .workout ? "watch-workout" : "watch-navigation",
      "observedAt": Date().timeIntervalSince1970 * 1000,
      "reason": reason,
      "state": "stopping",
    ], fence: fence)
    if mode == .navigation {
      activeOperationFence = nil
      activeRelayMode = nil
    }
  }

  @discardableResult
  private func handle(_ message: [String: Any]) -> Bool {
    switch message["action"] as? String {
    case "set-account-generation":
      guard let fence = accountFence(from: message), acceptAccountControl(message) else {
        return false
      }
      let collectionWasEnabled = UserDefaults.standard.bool(forKey: accountCollectionEnabledKey)
      let generationChanged = storedAccountFence() != fence || !collectionWasEnabled
      if generationChanged, storedAccountFence() != nil {
        stopAccountCollection(reason: "account-switch")
      }
      persist(fence)
      UserDefaults.standard.set(true, forKey: accountCollectionEnabledKey)
      if generationChanged {
        permissionSequenceGeneration = nil
        beginAccountPermissionSequence()
      }
      return true
    case "reset-account-generation":
      guard let fence = accountFence(from: message), acceptAccountControl(message) else {
        return false
      }
      UserDefaults.standard.set(false, forKey: accountCollectionEnabledKey)
      stopAccountCollection(reason: "account-reset")
      persist(fence)
      permissionSequenceGeneration = nil
      return true
    case "watch-event-ack":
      guard message["accepted"] as? Bool == true,
            let fence = captureAccountFence(),
            fence.matches(message),
            message["eventID"] is String,
            let observedAt = observedDate(message["observedAt"]),
            accepts(observedAt, for: fence) else { return false }
      UserDefaults.standard.set(
        observedAt.timeIntervalSince1970 * 1000,
        forKey: lastAcknowledgedEventAtKey
      )
      return true
    case "refresh-context", "start-active-relay", "start-navigation", "stop-active-relay", "stop-navigation":
      guard let fence = captureAccountFence(),
            fence.matches(message),
            acceptAccountControl(message) else { return false }
      handleAccountCommand(message)
      return true
    default:
      return false
    }
  }

  private func acceptAccountControl(_ message: [String: Any]) -> Bool {
    guard let issuedAt = message["controlIssuedAt"] as? NSNumber,
          issuedAt.doubleValue.isFinite,
          issuedAt.doubleValue <= Date().timeIntervalSince1970 * 1000 + 60_000,
          issuedAt.doubleValue > UserDefaults.standard.double(forKey: accountControlIssuedAtKey) else {
      return false
    }
    UserDefaults.standard.set(issuedAt.doubleValue, forKey: accountControlIssuedAtKey)
    return true
  }

  private func stopAccountCollection(reason: String) {
    activityManager.stopActivityUpdates()
    if activeRelayMode != nil {
      stopContinuousRelay(reason: reason)
    } else {
      locationManager.stopUpdatingLocation()
    }
    pendingLocationFence = nil
    latestMotion = "unknown"
    healthReady = false
  }

  private func handleAccountCommand(_ message: [String: Any]) {
    switch message["action"] as? String {
    case "refresh-context":
      captureContext()
    case "start-active-relay":
      let activity = message["activity"] as? String ?? "walking"
      let reason = message["action"] as? String ?? "iphone-command"
      Task { await startActiveRelay(activity: activity, reason: reason) }
    case "start-navigation":
      startNavigationRelay(reason: "start-navigation")
    case "stop-active-relay":
      guard activeRelayMode == .workout else { return }
      stopContinuousRelay(reason: message["action"] as? String ?? "iphone-command")
    case "stop-navigation":
      guard activeRelayMode == .navigation else { return }
      stopContinuousRelay(reason: message["action"] as? String ?? "iphone-command")
    default:
      break
    }
  }

  private func send(_ payload: [String: Any], fence: HermesWatchAccountFence) {
    guard isCurrent(fence),
          let observedAt = observedDate(payload["observedAt"]),
          accepts(observedAt, for: fence) else { return }
    var event = payload
    event["eventID"] = event["eventID"] ?? UUID().uuidString.lowercased()
    var envelope = fence.envelope(event)
    envelope["sourceDeviceId"] = sourceDeviceID
    if payload["kind"] as? String == "watch-context" {
      try? session.updateApplicationContext(envelope)
    }
    if session.isReachable {
      session.sendMessage(envelope, replyHandler: { [weak self] reply in
        // Rejected events are NOT re-delivered: the phone rejected the
        // envelope for a reason (stale fence, collection suspended) and
        // re-sending the same envelope via transferUserInfo would just be
        // rejected again while adding a duplicate disk write + parse cycle.
        // Only the errorHandler path (message genuinely failed to send)
        // falls back to store-and-forward delivery.
        guard reply["accepted"] as? Bool != true else { return }
        Task { @MainActor in
          guard let self else { return }
          Self.logger.info("watch event rejected by phone; dropping (not re-delivering)")
        }
      }) { [weak self] _ in
        Task { @MainActor in
          guard let self, self.isCurrent(fence) else { return }
          self.session.transferUserInfo(envelope)
        }
      }
    } else {
      session.transferUserInfo(envelope)
    }
  }

  private func requestAccountHandshake() {
    let request: [String: Any] = [
      "action": "request-account-handshake",
      "controlIssuedAt": Date().timeIntervalSince1970 * 1000,
    ]
    if session.isReachable {
      session.sendMessage(request, replyHandler: { [weak self] reply in
        Task { @MainActor in _ = self?.handle(reply) }
      }, errorHandler: { [weak self] _ in
        Task { @MainActor in self?.session.transferUserInfo(request) }
      })
    } else {
      session.transferUserInfo(request)
    }
  }

  private func captureAccountFence() -> HermesWatchAccountFence? {
    guard UserDefaults.standard.bool(forKey: accountCollectionEnabledKey) else { return nil }
    return storedAccountFence()
  }

  private func storedAccountFence() -> HermesWatchAccountFence? {
    let defaults = UserDefaults.standard
    let accountUUID = defaults.string(forKey: accountUUIDKey) ?? ""
    let serverGeneration = defaults.string(forKey: serverAccountGenerationKey) ?? ""
    let lifecycleEpoch = defaults.integer(forKey: accountGenerationKey)
    let resetAt = defaults.double(forKey: accountResetAtKey)
    guard !accountUUID.isEmpty, !serverGeneration.isEmpty, lifecycleEpoch > 0,
          resetAt.isFinite, resetAt > 0 else { return nil }
    return HermesWatchAccountFence(
      accountUUID: accountUUID,
      serverGeneration: serverGeneration,
      lifecycleEpoch: lifecycleEpoch,
      resetAt: resetAt
    )
  }

  private func accountFence(from payload: [String: Any]) -> HermesWatchAccountFence? {
    guard let accountUUID = payload["accountUUID"] as? String, !accountUUID.isEmpty,
          let serverGeneration = payload["account_generation"] as? String,
          !serverGeneration.isEmpty,
          let lifecycleEpoch = (payload["accountEpoch"] as? NSNumber)?.intValue,
          lifecycleEpoch > 0,
          (payload["accountGeneration"] as? NSNumber)?.intValue == lifecycleEpoch,
          let resetAt = (payload["accountResetAt"] as? NSNumber)?.doubleValue,
          resetAt.isFinite, resetAt > 0,
          resetAt <= Date().timeIntervalSince1970 * 1000 + 60_000 else { return nil }
    return HermesWatchAccountFence(
      accountUUID: accountUUID,
      serverGeneration: serverGeneration,
      lifecycleEpoch: lifecycleEpoch,
      resetAt: resetAt
    )
  }

  private func persist(_ fence: HermesWatchAccountFence) {
    let defaults = UserDefaults.standard
    defaults.set(fence.accountUUID, forKey: accountUUIDKey)
    defaults.set(fence.serverGeneration, forKey: serverAccountGenerationKey)
    defaults.set(fence.lifecycleEpoch, forKey: accountGenerationKey)
    defaults.set(fence.resetAt, forKey: accountResetAtKey)
  }

  private func isCurrent(_ fence: HermesWatchAccountFence) -> Bool {
    captureAccountFence() == fence
  }

  private func accepts(_ date: Date, for fence: HermesWatchAccountFence) -> Bool {
    let timestamp = date.timeIntervalSince1970 * 1000
    return timestamp.isFinite
      && timestamp > fence.resetAt
      && date.timeIntervalSinceNow <= 60
  }

  private func observedDate(_ value: Any?) -> Date? {
    guard let number = value as? NSNumber, number.doubleValue.isFinite,
          number.doubleValue > 0 else { return nil }
    return Date(
      timeIntervalSince1970: number.doubleValue > 10_000_000_000
        ? number.doubleValue / 1000
        : number.doubleValue
    )
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
      if error == nil {
        self.requestAccountHandshake()
        if self.healthReady { self.captureContext() }
      }
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    Task { @MainActor in
      self.reachable = session.isReachable
      if session.isReachable { self.requestAccountHandshake() }
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    Task { @MainActor in self.handle(message) }
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    Task { @MainActor in
      replyHandler(["accepted": self.handle(message)])
    }
  }

  nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    Task { @MainActor in self.handle(userInfo) }
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    Task { @MainActor in self.handle(applicationContext) }
  }

  nonisolated func locationManager(
    _ manager: CLLocationManager,
    didUpdateLocations locations: [CLLocation]
  ) {
    guard let location = locations.last,
          location.horizontalAccuracy >= 0,
          CLLocationCoordinate2DIsValid(location.coordinate) else { return }
    Task { @MainActor in
      guard let fence = self.activeOperationFence ?? self.pendingLocationFence,
            self.accepts(location.timestamp, for: fence),
            self.isCurrent(fence) else { return }
      if self.activeOperationFence == nil { self.pendingLocationFence = nil }
      var payload = self.locationPayload(location)
      payload["kind"] = "watch-location"
      payload["observedAt"] = location.timestamp.timeIntervalSince1970 * 1000
      self.send(payload, fence: fence)
    }
  }

  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    guard status != .notDetermined else { return }
    Task { @MainActor in
      guard let fence = self.captureAccountFence() else { return }
      self.requestMotionAuthorization(for: fence)
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
      guard self.workoutSession === workoutSession,
            let fence = self.activeOperationFence,
            self.activeRelayMode == .workout else { return }
      let builder = self.workoutBuilder
      builder?.endCollection(withEnd: date) { _, _ in builder?.discardWorkout() }
      self.workoutBuilder = nil
      self.workoutSession = nil
      self.activeOperationFence = nil
      self.activeRelayMode = nil
      self.activeRelay = false
      self.locationManager.stopUpdatingLocation()
      self.locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      self.locationManager.distanceFilter = 50
      self.send([
        "kind": "watch-workout",
        "observedAt": date.timeIntervalSince1970 * 1000,
        "state": "ended",
      ], fence: fence)
    }
  }

  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    Task { @MainActor in
      guard self.workoutSession === workoutSession,
            let fence = self.activeOperationFence,
            self.activeRelayMode == .workout else { return }
      self.workoutBuilder?.discardWorkout()
      self.workoutBuilder = nil
      self.workoutSession = nil
      self.activeOperationFence = nil
      self.activeRelayMode = nil
      self.activeRelay = false
      self.locationManager.stopUpdatingLocation()
      self.locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      self.locationManager.distanceFilter = 50
      self.send([
        "error": error.localizedDescription,
        "kind": "watch-workout",
        "observedAt": Date().timeIntervalSince1970 * 1000,
        "state": "failed",
      ], fence: fence)
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
      guard self.workoutBuilder === workoutBuilder,
            let fence = self.activeOperationFence,
            self.activeRelayMode == .workout else { return }
      self.send([
        "kind": "watch-workout-sample",
        "metrics": metrics,
        "motion": self.latestMotion,
        "observedAt": Date().timeIntervalSince1970 * 1000,
      ], fence: fence)
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
