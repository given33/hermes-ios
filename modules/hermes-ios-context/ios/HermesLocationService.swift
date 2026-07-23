import CoreLocation
import Foundation

enum HermesLocationMode: String {
  case automotive
  case cycling
  case predictedDeparture
  case running
  case stationary
  case walking
}

final class HermesLocationService: NSObject, CLLocationManagerDelegate {
  static let shared = HermesLocationService()

  private struct LocationManagerConfiguration {
    let activityType: CLActivityType
    let desiredAccuracy: CLLocationAccuracy
    let distanceFilter: CLLocationDistance
    let pausesLocationUpdatesAutomatically: Bool
  }

  private enum PendingLocationDisposition {
    case ignore
    case resolve(UUID)
    case retry(UUID)
  }

  private let manager = CLLocationManager()
  private let stateLock = NSLock()
  private var authorizationGate: HermesLocationAuthorizationGate?
  private var authorizationWaiters: [HermesLocationAuthorizationGate] = []
  private var locationContinuation: CheckedContinuation<[String: Any]?, Never>?
  private var locationRequestForceFresh = false
  private var locationRequestBestPayload: [String: Any]?
  private var locationRequestBestAccuracy = CLLocationAccuracy.greatestFiniteMagnitude
  private var locationRequestStartedAt: Date?
  private var locationRequestToken: UUID?
  private var locationRetry: DispatchWorkItem?
  private var locationTimeout: DispatchWorkItem?
  private var requestLocationConfiguration: LocationManagerConfiguration?
  private var lastLocation: CLLocation?
  private var stableSamples: [CLLocation] = []
  private var stableRegion: CLCircularRegion?
  private var requestedAlwaysUpgrade = false
  private var predictedDepartureAt: Date?
  private var predictedDepartureActivation: DispatchWorkItem?
  private var predictedDepartureReset: DispatchWorkItem?
  private(set) var mode: HermesLocationMode = .stationary
  var onLocation: (([String: Any]) -> Void)?
  var onVisit: (([String: Any]) -> Void)?

  private override init() {
    super.init()
    manager.delegate = self
    manager.activityType = .other
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    manager.distanceFilter = 15
    manager.pausesLocationUpdatesAutomatically = true
    manager.allowsBackgroundLocationUpdates = true
    manager.showsBackgroundLocationIndicator = false
  }

  func requestAlwaysAuthorization() async -> String {
    let status = manager.authorizationStatus
    if status == .authorizedAlways {
      await requestTemporaryFullAccuracyIfNeeded()
      return HermesAuthorization.location(status)
    }
    if status == .denied || status == .restricted {
      return HermesAuthorization.location(status)
    }
    return await withCheckedContinuation { continuation in
      let gate = HermesLocationAuthorizationGate(continuation)
      stateLock.lock()
      let shouldStartRequest = authorizationGate == nil
      if shouldStartRequest {
        authorizationGate = gate
      } else {
        authorizationWaiters.append(gate)
      }
      stateLock.unlock()
      guard shouldStartRequest else { return }
      DispatchQueue.main.async { [weak self] in
        guard let self else {
          gate.resolve(HermesAuthorization.location(status))
          return
        }
        if status == .notDetermined {
          self.manager.requestWhenInUseAuthorization()
        } else {
          self.requestedAlwaysUpgrade = true
          self.manager.requestAlwaysAuthorization()
          self.scheduleAlwaysUpgradeFallback(gate)
        }
      }
    }
  }

  func requestPreciseAuthorization() async -> Bool {
    guard manager.authorizationStatus == .authorizedAlways
      || manager.authorizationStatus == .authorizedWhenInUse else { return false }
    await requestTemporaryFullAccuracyIfNeeded()
    return manager.accuracyAuthorization == .fullAccuracy
  }

  @discardableResult
  func start() -> Bool {
    guard HermesPermissionCollectionGate.shared.isReadyForCurrentOwner else { return false }
    guard CLLocationManager.locationServicesEnabled() else { return false }
    let status = manager.authorizationStatus
    guard status == .authorizedAlways else { return false }
    manager.startMonitoringSignificantLocationChanges()
    manager.startMonitoringVisits()
    apply(mode: currentAdaptiveMode(), force: true)
    return true
  }

  func stop() {
    manager.stopUpdatingLocation()
    manager.stopMonitoringSignificantLocationChanges()
    manager.stopMonitoringVisits()
    if let stableRegion { manager.stopMonitoring(for: stableRegion) }
    stableRegion = nil
  }

  func resetAccountState() {
    predictedDepartureActivation?.cancel()
    predictedDepartureActivation = nil
    predictedDepartureReset?.cancel()
    predictedDepartureReset = nil
    predictedDepartureAt = nil
    resolveLocationRequest(with: nil, restoreConfiguration: false)
    stop()
    lastLocation = nil
    stableSamples.removeAll()
    mode = .stationary
    manager.activityType = .other
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    manager.distanceFilter = 15
    manager.pausesLocationUpdatesAutomatically = true
  }

  func setPredictedDeparture(at date: Date?) {
    predictedDepartureActivation?.cancel()
    predictedDepartureActivation = nil
    predictedDepartureReset?.cancel()
    predictedDepartureReset = nil
    predictedDepartureAt = date
    guard let date else {
      if mode == .predictedDeparture { apply(mode: .stationary, force: true) }
      return
    }
    let activation = DispatchWorkItem { [weak self] in
      guard let self, self.predictedDepartureAt == date else { return }
      self.predictedDepartureActivation = nil
      if self.mode == .stationary || self.mode == .predictedDeparture {
        self.apply(mode: .predictedDeparture, force: true)
      }
    }
    predictedDepartureActivation = activation
    let activationDelay = date.timeIntervalSinceNow - 30 * 60
    if activationDelay <= 0 {
      activation.perform()
    } else {
      DispatchQueue.main.asyncAfter(
        deadline: .now() + activationDelay,
        execute: activation
      )
    }
    let reset = DispatchWorkItem { [weak self] in
      guard let self, self.predictedDepartureAt == date else { return }
      self.predictedDepartureAt = nil
      self.predictedDepartureReset = nil
      if self.mode == .predictedDeparture {
        self.apply(mode: .stationary, force: true)
      }
    }
    predictedDepartureReset = reset
    DispatchQueue.main.asyncAfter(
      deadline: .now() + max(0, date.timeIntervalSinceNow + 10 * 60),
      execute: reset
    )
  }

  func applyMotionActivity(_ activity: String) {
    let next: HermesLocationMode
    switch activity {
    case "automotive": next = .automotive
    case "cycling": next = .cycling
    case "running": next = .running
    case "walking": next = .walking
    case "stationary": next = currentAdaptiveMode(now: Date()) == .predictedDeparture ? .predictedDeparture : .stationary
    default: return
    }
    apply(mode: next)
  }

  func requestCurrent(forceFresh: Bool = false) async -> [String: Any]? {
    guard CLLocationManager.locationServicesEnabled() else { return nil }
    let status = manager.authorizationStatus
    guard status == .authorizedAlways || status == .authorizedWhenInUse else { return nil }
    if !forceFresh, let lastLocation, abs(lastLocation.timestamp.timeIntervalSinceNow) < 20 {
      return Self.payload(
        lastLocation,
        authorization: status,
        accuracyAuthorization: manager.accuracyAuthorization,
        mode: mode
      )
    }
    await requestTemporaryFullAccuracyIfNeeded()
    return await withCheckedContinuation { continuation in
      // A second foreground refresh supersedes the first one. Resolve the old
      // continuation before installing the new token so a late callback or
      // timeout from the old request cannot finish the replacement request.
      resolveLocationRequest(with: nil)
      let token = UUID()
      let requestedAt = Date()
      stateLock.lock()
      locationContinuation = continuation
      locationRequestForceFresh = forceFresh
      locationRequestBestPayload = nil
      locationRequestBestAccuracy = .greatestFiniteMagnitude
      locationRequestStartedAt = requestedAt
      locationRequestToken = token
      let timeout = DispatchWorkItem { [weak self] in
        guard let self else { return }
        self.resolveLocationRequest(
          with: self.bestLocationPayload(matching: token),
          matching: token
        )
      }
      locationTimeout = timeout
      stateLock.unlock()
      DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
      DispatchQueue.main.async { [weak self] in
        guard let self, self.isCurrentLocationRequest(token) else { return }
        if forceFresh {
          self.stateLock.lock()
          if self.locationRequestToken == token {
            self.requestLocationConfiguration = LocationManagerConfiguration(
              activityType: self.manager.activityType,
              desiredAccuracy: self.manager.desiredAccuracy,
              distanceFilter: self.manager.distanceFilter,
              pausesLocationUpdatesAutomatically: self.manager.pausesLocationUpdatesAutomatically
            )
            self.manager.activityType = .otherNavigation
            self.manager.desiredAccuracy = kCLLocationAccuracyBest
            self.manager.distanceFilter = kCLDistanceFilterNone
            self.manager.pausesLocationUpdatesAutomatically = false
          }
          self.stateLock.unlock()
        }
        self.issueLocationRequest(token)
      }
    }
  }

  func authorizationSnapshot() -> [String: Any] {
    [
      "accuracy": manager.accuracyAuthorization == .fullAccuracy ? "full" : "reduced",
      "always": manager.authorizationStatus == .authorizedAlways,
      "background": manager.authorizationStatus == .authorizedAlways,
      "mode": mode.rawValue,
      "status": HermesAuthorization.location(manager.authorizationStatus),
    ]
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    guard status != .notDetermined else { return }
    if status == .authorizedWhenInUse && !requestedAlwaysUpgrade {
      requestedAlwaysUpgrade = true
      Task { await requestTemporaryFullAccuracyIfNeeded() }
      DispatchQueue.main.async { [weak self] in
        self?.manager.requestAlwaysAuthorization()
      }
      stateLock.lock()
      let gate = authorizationGate
      stateLock.unlock()
      if let gate { scheduleAlwaysUpgradeFallback(gate) }
      return
    }
    // A user may keep the While-In-Use grant when the Always upgrade prompt
    // is shown. Resolve the pending request in that case too; leaving the
    // continuation suspended prevents the entire sync provider from starting.
    if status == .authorizedAlways || status == .authorizedWhenInUse
      || status == .denied || status == .restricted {
      stateLock.lock()
      let gate = authorizationGate
      let waiters = authorizationWaiters
      authorizationGate = nil
      authorizationWaiters.removeAll()
      stateLock.unlock()
      gate?.resolve(HermesAuthorization.location(status))
      waiters.forEach { $0.resolve(HermesAuthorization.location(status)) }
      requestedAlwaysUpgrade = false
    }
    // The durable collector requires Always authorization. While-In-Use still
    // supports explicit foreground map refreshes, but must not silently start
    // visits/significant-change monitoring in the background.
    if status == .authorizedAlways,
       HermesPermissionCollectionGate.shared.isReadyForCurrentOwner { _ = start() }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    let usable = locations.filter {
      $0.horizontalAccuracy >= 0
        && abs($0.timestamp.timeIntervalSinceNow) < 5 * 60
        && CLLocationCoordinate2DIsValid($0.coordinate)
    }
    guard let location = usable.last else { return }
    lastLocation = location
    updateStableCenter(with: location)
    let payload = Self.payload(
      location,
      authorization: manager.authorizationStatus,
      accuracyAuthorization: manager.accuracyAuthorization,
      mode: mode
    )
    let disposition = pendingLocationDisposition(for: location, payload: payload)
    if case .retry(let token) = disposition {
      scheduleLocationRetry(token)
    }
    HermesContextEventQueue.shared.enqueue(
      type: "location",
      payload: payload,
      occurredAt: location.timestamp
    ) { [weak self] in
      self?.onLocation?(payload)
      guard let self else { return }
      if case .resolve(let token) = disposition {
        self.resolveLocationRequest(with: payload, matching: token)
      }
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    stateLock.lock()
    let token = locationRequestToken
    let bestPayload = locationRequestBestPayload
    stateLock.unlock()
    guard let token else { return }
    if (error as? CLError)?.code == .locationUnknown {
      scheduleLocationRetry(token)
      return
    }
    resolveLocationRequest(with: bestPayload, matching: token)
  }

  func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
    let arrivedAt = visit.arrivalDate == .distantPast
      ? nil
      : visit.arrivalDate.timeIntervalSince1970 * 1000
    let departedAt = visit.departureDate == .distantFuture
      ? nil
      : visit.departureDate.timeIntervalSince1970 * 1000
    let indoorConfidence = visit.horizontalAccuracy >= 35 ? 0.75 : 0.35
    let payload: [String: Any] = [
      "accuracy": visit.horizontalAccuracy,
      "arrivedAt": hermesNullable(arrivedAt),
      "departedAt": hermesNullable(departedAt),
      "latitude": visit.coordinate.latitude,
      "longitude": visit.coordinate.longitude,
      "indoor": indoorConfidence >= 0.6,
      "indoorConfidence": indoorConfidence,
      "timestamp": (departedAt ?? arrivedAt) ?? Date().timeIntervalSince1970 * 1000,
    ]
    let eventDate = (departedAt ?? arrivedAt)
      .map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
    HermesContextEventQueue.shared.enqueue(
      type: "place-visit",
      payload: payload,
      occurredAt: eventDate
    ) { [weak self] in self?.onVisit?(payload) }
    if departedAt == nil {
      apply(mode: .stationary)
      installStableRegion(center: visit.coordinate, accuracy: visit.horizontalAccuracy)
      manager.stopUpdatingLocation()
    }
  }

  func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
    recordRegionEvent("entered", region: region)
    apply(mode: .stationary)
    manager.stopUpdatingLocation()
  }

  func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    recordRegionEvent("exited", region: region)
    stableSamples.removeAll(keepingCapacity: true)
    apply(mode: .walking, force: true)
  }

  func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
    HermesContextEventQueue.shared.enqueue(type: "location-monitoring", payload: [
      "error": error.localizedDescription,
      "region": region?.identifier ?? "",
      "status": "failed",
    ])
  }

  private func requestTemporaryFullAccuracyIfNeeded() async {
    guard manager.accuracyAuthorization == .reducedAccuracy else { return }
    do {
      try await manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "HermesTripContext")
    } catch {
      // Reduced precision remains a valid mode and is reported to the behavior model.
    }
  }

  private func scheduleAlwaysUpgradeFallback(_ gate: HermesLocationAuthorizationGate) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self, weak gate] in
      guard let self, let gate else { return }
      self.stateLock.lock()
      let isCurrent = self.authorizationGate === gate
      let waiters = isCurrent ? self.authorizationWaiters : []
      if isCurrent {
        self.authorizationGate = nil
        self.authorizationWaiters.removeAll()
      }
      let status = self.manager.authorizationStatus
      self.stateLock.unlock()
      guard isCurrent, status == .authorizedWhenInUse else { return }
      // iOS may defer the Always sheet without another authorization callback.
      // Resolve as limited While-In-Use (never invent "notDetermined") so the
      // permission coordinator can continue the remaining chain and surface a
      // limited-location state instead of freezing until a foreground cycle.
      gate.resolve(HermesAuthorization.location(.authorizedWhenInUse))
      waiters.forEach { $0.resolve(HermesAuthorization.location(.authorizedWhenInUse)) }
    }
  }

  private func currentAdaptiveMode(now: Date = Date()) -> HermesLocationMode {
    if let predictedDepartureAt,
       predictedDepartureAt.timeIntervalSince(now) <= 30 * 60,
       predictedDepartureAt.timeIntervalSince(now) >= -10 * 60,
       mode == .stationary || mode == .predictedDeparture {
      return .predictedDeparture
    }
    if mode == .predictedDeparture { return .stationary }
    return mode == .stationary ? .stationary : mode
  }

  private func isCurrentLocationRequest(_ token: UUID) -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return locationRequestToken == token
  }

  private func pendingLocationDisposition(
    for location: CLLocation,
    payload: [String: Any]
  ) -> PendingLocationDisposition {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard let token = locationRequestToken else { return .ignore }
    guard locationRequestForceFresh else { return .resolve(token) }
    guard let requestedAt = locationRequestStartedAt,
          location.timestamp >= requestedAt.addingTimeInterval(-1) else { return .retry(token) }
    if location.horizontalAccuracy < locationRequestBestAccuracy {
      locationRequestBestAccuracy = location.horizontalAccuracy
      locationRequestBestPayload = payload
    }
    return location.horizontalAccuracy <= 50 ? .resolve(token) : .retry(token)
  }

  private func bestLocationPayload(matching token: UUID) -> [String: Any]? {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard locationRequestToken == token else { return nil }
    return locationRequestBestPayload
  }

  private func issueLocationRequest(_ token: UUID) {
    guard isCurrentLocationRequest(token) else { return }
    manager.requestLocation()
  }

  private func scheduleLocationRetry(_ token: UUID) {
    let retry = DispatchWorkItem { [weak self] in
      guard let self, self.isCurrentLocationRequest(token) else { return }
      self.issueLocationRequest(token)
    }
    stateLock.lock()
    guard locationRequestToken == token else {
      stateLock.unlock()
      return
    }
    locationRetry?.cancel()
    locationRetry = retry
    stateLock.unlock()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: retry)
  }

  private func resolveLocationRequest(
    with payload: [String: Any]?,
    matching expectedToken: UUID? = nil,
    restoreConfiguration: Bool = true
  ) {
    stateLock.lock()
    if let expectedToken, locationRequestToken != expectedToken {
      stateLock.unlock()
      return
    }
    locationTimeout?.cancel()
    locationTimeout = nil
    locationRetry?.cancel()
    locationRetry = nil
    let continuation = locationContinuation
    locationContinuation = nil
    locationRequestForceFresh = false
    locationRequestBestPayload = nil
    locationRequestBestAccuracy = .greatestFiniteMagnitude
    locationRequestStartedAt = nil
    locationRequestToken = nil
    let configuration = requestLocationConfiguration
    requestLocationConfiguration = nil
    stateLock.unlock()
    if restoreConfiguration, let configuration {
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        self.manager.activityType = configuration.activityType
        self.manager.desiredAccuracy = configuration.desiredAccuracy
        self.manager.distanceFilter = configuration.distanceFilter
        self.manager.pausesLocationUpdatesAutomatically = configuration.pausesLocationUpdatesAutomatically
      }
    }
    continuation?.resume(returning: payload)
  }

  private func apply(mode next: HermesLocationMode, force: Bool = false) {
    guard force || next != mode else { return }
    mode = next
    switch next {
    case .automotive:
      manager.activityType = .automotiveNavigation
      manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
      manager.distanceFilter = 10
      manager.pausesLocationUpdatesAutomatically = false
    case .cycling:
      manager.activityType = .fitness
      manager.desiredAccuracy = kCLLocationAccuracyBest
      manager.distanceFilter = 10
      manager.pausesLocationUpdatesAutomatically = false
    case .running:
      manager.activityType = .fitness
      manager.desiredAccuracy = kCLLocationAccuracyBest
      manager.distanceFilter = 5
      manager.pausesLocationUpdatesAutomatically = false
    case .walking, .predictedDeparture:
      manager.activityType = .fitness
      manager.desiredAccuracy = kCLLocationAccuracyBest
      manager.distanceFilter = next == .walking ? 10 : 5
      manager.pausesLocationUpdatesAutomatically = false
    case .stationary:
      manager.activityType = .other
      manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
      manager.distanceFilter = 15
      manager.pausesLocationUpdatesAutomatically = true
    }
    manager.startUpdatingLocation()
    HermesContextEventQueue.shared.enqueue(type: "location-mode", payload: [
      "mode": next.rawValue,
      "predictedDepartureAt": hermesNullable(predictedDepartureAt?.timeIntervalSince1970.times(1_000)),
    ])
  }

  private func updateStableCenter(with location: CLLocation) {
    guard mode == .stationary, location.horizontalAccuracy <= 100 else {
      if mode != .stationary { stableSamples.removeAll(keepingCapacity: true) }
      return
    }
    stableSamples.append(location)
    stableSamples = Array(stableSamples.suffix(8))
    guard stableSamples.count >= 3,
          let first = stableSamples.first,
          location.timestamp.timeIntervalSince(first.timestamp) >= 90,
          stableSamples.allSatisfy({ $0.distance(from: first) <= max(60, first.horizontalAccuracy * 2) }) else {
      return
    }
    let latitude = stableSamples.map(\.coordinate.latitude).reduce(0, +) / Double(stableSamples.count)
    let longitude = stableSamples.map(\.coordinate.longitude).reduce(0, +) / Double(stableSamples.count)
    installStableRegion(
      center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
      accuracy: stableSamples.map(\.horizontalAccuracy).max() ?? 100
    )
  }

  private func installStableRegion(center: CLLocationCoordinate2D, accuracy: CLLocationAccuracy) {
    guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
    if let stableRegion,
       CLLocation(latitude: stableRegion.center.latitude, longitude: stableRegion.center.longitude)
        .distance(from: CLLocation(latitude: center.latitude, longitude: center.longitude)) < 50 {
      return
    }
    if let stableRegion { manager.stopMonitoring(for: stableRegion) }
    let radius = min(max(accuracy * 2, 100), min(CLLocationManager().maximumRegionMonitoringDistance, 250))
    let region = CLCircularRegion(
      center: center,
      radius: radius,
      identifier: "hermes.stable-place"
    )
    region.notifyOnEntry = true
    region.notifyOnExit = true
    stableRegion = region
    manager.startMonitoring(for: region)
    manager.stopUpdatingLocation()
  }

  private func recordRegionEvent(_ state: String, region: CLRegion) {
    var payload: [String: Any] = ["identifier": region.identifier, "state": state]
    if let circular = region as? CLCircularRegion {
      payload["latitude"] = circular.center.latitude
      payload["longitude"] = circular.center.longitude
      payload["radius"] = circular.radius
    }
    HermesContextEventQueue.shared.enqueue(type: "geofence", payload: payload)
  }

  private static func payload(
    _ location: CLLocation,
    authorization: CLAuthorizationStatus,
    accuracyAuthorization: CLAccuracyAuthorization,
    mode: HermesLocationMode
  ) -> [String: Any] {
    var payload: [String: Any] = [
      "accuracy": location.horizontalAccuracy,
      "altitude": location.altitude,
      "authorization": HermesAuthorization.location(authorization),
      "course": location.course,
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "mode": mode.rawValue,
      "precision": accuracyAuthorization == .fullAccuracy ? "full" : "reduced",
      "speed": location.speed,
      "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
      "verticalAccuracy": location.verticalAccuracy,
    ]
    if let floor = location.floor { payload["floor"] = floor.level }
    if #available(iOS 15.0, *) {
      payload["isProducedByAccessory"] = location.sourceInformation?.isProducedByAccessory ?? false
      payload["isSimulatedBySoftware"] = location.sourceInformation?.isSimulatedBySoftware ?? false
    }
    return payload
  }
}

private final class HermesLocationAuthorizationGate: @unchecked Sendable {
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

private extension TimeInterval {
  func times(_ multiplier: Double) -> Double { self * multiplier }
}
