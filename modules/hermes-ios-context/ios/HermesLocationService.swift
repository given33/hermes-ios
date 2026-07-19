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

  private let manager = CLLocationManager()
  private var authorizationGate: HermesLocationAuthorizationGate?
  private var locationContinuation: CheckedContinuation<[String: Any]?, Never>?
  private var lastLocation: CLLocation?
  private var stableSamples: [CLLocation] = []
  private var stableRegion: CLCircularRegion?
  private var requestedAlwaysUpgrade = false
  private var predictedDepartureAt: Date?
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
      authorizationGate?.resolve(HermesAuthorization.location(status))
      let gate = HermesLocationAuthorizationGate(continuation)
      authorizationGate = gate
      if status == .notDetermined {
        manager.requestWhenInUseAuthorization()
      } else {
        requestedAlwaysUpgrade = true
        manager.requestAlwaysAuthorization()
        scheduleAlwaysUpgradeFallback(gate)
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
    predictedDepartureReset?.cancel()
    predictedDepartureReset = nil
    predictedDepartureAt = nil
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
    predictedDepartureReset?.cancel()
    predictedDepartureReset = nil
    predictedDepartureAt = date
    apply(mode: currentAdaptiveMode(), force: true)
    guard let date else {
      if mode == .predictedDeparture { apply(mode: .stationary, force: true) }
      return
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

  func requestCurrent() async -> [String: Any]? {
    guard CLLocationManager.locationServicesEnabled() else { return nil }
    let status = manager.authorizationStatus
    guard status == .authorizedAlways || status == .authorizedWhenInUse else { return nil }
    if let lastLocation, abs(lastLocation.timestamp.timeIntervalSinceNow) < 20 {
      return Self.payload(
        lastLocation,
        authorization: status,
        accuracyAuthorization: manager.accuracyAuthorization,
        mode: mode
      )
    }
    await requestTemporaryFullAccuracyIfNeeded()
    return await withCheckedContinuation { continuation in
      locationContinuation?.resume(returning: nil)
      locationContinuation = continuation
      manager.requestLocation()
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
      manager.requestAlwaysAuthorization()
      if let authorizationGate { scheduleAlwaysUpgradeFallback(authorizationGate) }
      return
    }
    // A user may keep the While-In-Use grant when the Always upgrade prompt
    // is shown. Resolve the pending request in that case too; leaving the
    // continuation suspended prevents the entire sync provider from starting.
    if status == .authorizedAlways || status == .authorizedWhenInUse
      || status == .denied || status == .restricted {
      authorizationGate?.resolve(HermesAuthorization.location(status))
      authorizationGate = nil
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
    HermesContextEventQueue.shared.enqueue(
      type: "location",
      payload: payload,
      occurredAt: location.timestamp
    ) { [weak self] in
      self?.onLocation?(payload)
      self?.locationContinuation?.resume(returning: payload)
      self?.locationContinuation = nil
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    if (error as? CLError)?.code != .locationUnknown {
      locationContinuation?.resume(returning: nil)
      locationContinuation = nil
    }
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
      guard let self, let gate, self.authorizationGate === gate,
            self.manager.authorizationStatus == .authorizedWhenInUse else { return }
      self.authorizationGate = nil
      // iOS may defer the Always sheet without another authorization callback.
      // Keep the permission run paused so other system sheets are not stacked.
      gate.resolve("notDetermined")
    }
  }

  private func currentAdaptiveMode(now: Date = Date()) -> HermesLocationMode {
    if let predictedDepartureAt,
       predictedDepartureAt.timeIntervalSince(now) <= 30 * 60,
       predictedDepartureAt.timeIntervalSince(now) >= -10 * 60 {
      return .predictedDeparture
    }
    if mode == .predictedDeparture { return .stationary }
    return mode == .stationary ? .stationary : mode
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
