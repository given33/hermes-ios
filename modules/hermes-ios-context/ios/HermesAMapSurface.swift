#if canImport(MAMapKit)
import AMapFoundationKit
import CoreLocation
import MAMapKit
import UIKit

final class HermesAMapSurface: UIView, HermesMapRendering, MAMapViewDelegate {
  var onLocationPress: (() -> Void)?

  private let mapView: MAMapView
  private let compassButton = UIButton(type: .system)
  private let locationButton = UIButton(type: .system)
  private var trackOverlay: MAPolyline?
  private var placeAnnotations: [MAPointAnnotation] = []
  private var hasCenteredOnUser = false
  private var hasActivatedLocation = false
  private var centerOnNextUserLocation = true
  private var pendingCenterRequestedAt: Date?

  init(apiKey: String) {
    MAMapView.updatePrivacyShow(.didShow, privacyInfo: .didContain)
    MAMapView.updatePrivacyAgree(.didAgree)
    AMapServices.shared().apiKey = apiKey
    AMapServices.shared().regionLanguageType = .zhHans
    mapView = MAMapView(frame: .zero)
    super.init(frame: .zero)

    backgroundColor = .systemBackground
    mapView.delegate = self
    mapView.mapType = .standard
    mapView.showTraffic = true
    mapView.showsLabels = true
    mapView.showsBuildings = false
    mapView.showsIndoorMap = false
    mapView.showsIndoorMapControl = false
    mapView.touchPOIEnabled = true
    mapView.zoomEnabled = true
    mapView.scrollEnabled = true
    mapView.rotateEnabled = true
    mapView.rotateCameraEnabled = false
    mapView.cameraDegree = 0
    // AMap's built-in compass hides itself while the map points north. Keep a
    // dedicated native control visible so the map affordance never disappears.
    mapView.showsCompass = false
    mapView.showsScale = true
    mapView.showsUserLocation = false
    mapView.maxRenderFrame = 60
    addSubview(mapView)

    var compassConfiguration = UIButton.Configuration.filled()
    compassConfiguration.baseBackgroundColor = .secondarySystemBackground
    compassConfiguration.baseForegroundColor = .label
    compassConfiguration.cornerStyle = .medium
    compassConfiguration.image = UIImage(systemName: "location.north.circle.fill")
    compassButton.configuration = compassConfiguration
    compassButton.accessibilityLabel = "Reset map to north"
    compassButton.addTarget(self, action: #selector(resetMapNorth), for: .touchUpInside)
    addSubview(compassButton)

    var configuration = UIButton.Configuration.filled()
    configuration.baseBackgroundColor = .secondarySystemBackground
    configuration.baseForegroundColor = .label
    configuration.cornerStyle = .medium
    configuration.image = UIImage(systemName: "location.fill")
    locationButton.configuration = configuration
    locationButton.accessibilityLabel = "Center on current location"
    locationButton.addTarget(self, action: #selector(refreshCurrentLocation), for: .touchUpInside)
    addSubview(locationButton)
  }

  required init?(coder: NSCoder) {
    nil
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    mapView.frame = bounds
    let top = safeAreaInsets.top + 14
    let right = bounds.width - 14
    mapView.scaleOrigin = CGPoint(x: 14, y: top)
    compassButton.frame = CGRect(x: right - 44, y: top, width: 44, height: 44)
    locationButton.frame = CGRect(x: right - 44, y: top + 52, width: 44, height: 44)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil, !hasActivatedLocation else { return }
    requestFreshCenter()
  }

  func setShowsUserLocation(_ shows: Bool) {
    mapView.showsUserLocation = shows
  }

  func setTrack(_ track: [HermesMapCoordinate]) {
    if let trackOverlay { mapView.remove(trackOverlay) }
    guard track.count > 1 else {
      trackOverlay = nil
      return
    }
    var coordinates = track.map {
      Self.amapCoordinate(latitude: $0.latitude, longitude: $0.longitude)
    }
    let overlay = MAPolyline(coordinates: &coordinates, count: UInt(coordinates.count))
    trackOverlay = overlay
    mapView.add(overlay)
  }

  func setPlaces(_ places: [HermesMapPlace]) {
    mapView.removeAnnotations(placeAnnotations)
    placeAnnotations = places.map { place in
      let annotation = MAPointAnnotation()
      annotation.coordinate = Self.amapCoordinate(
        latitude: place.latitude,
        longitude: place.longitude
      )
      annotation.title = place.name
      annotation.subtitle = HermesMapPlaceText.subtitle(for: place)
      return annotation
    }
    mapView.addAnnotations(placeAnnotations)
  }

  func requestFreshCenter() {
    hasActivatedLocation = true
    centerOnNextUserLocation = true
    pendingCenterRequestedAt = Date()
    onLocationPress?()
    Task { @MainActor [weak self] in
      guard let self else { return }
      let authorization = await HermesLocationService.shared.requestAlwaysAuthorization()
      guard authorization == "authorized" || authorization == "limited" else { return }
      self.mapView.showsUserLocation = true
      _ = await HermesLocationService.shared.requestPreciseAuthorization()
      guard let payload = await HermesLocationService.shared.requestCurrent(forceFresh: true),
            let latitude = payload["latitude"] as? Double,
            let longitude = payload["longitude"] as? Double,
            let timestamp = payload["timestamp"] as? Double else { return }
      let location = CLLocation(
        coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
        altitude: payload["altitude"] as? Double ?? 0,
        horizontalAccuracy: max(0, payload["accuracy"] as? Double ?? 0),
        verticalAccuracy: payload["verticalAccuracy"] as? Double ?? -1,
        course: payload["course"] as? Double ?? -1,
        speed: payload["speed"] as? Double ?? -1,
        timestamp: Date(timeIntervalSince1970: timestamp / 1_000)
      )
      self.centerOnUser(animated: self.hasCenteredOnUser, location: location)
    }
  }

  @objc private func refreshCurrentLocation() {
    requestFreshCenter()
  }

  @objc private func resetMapNorth() {
    mapView.rotationDegree = 0
  }

  private func centerOnUser(animated: Bool, location: CLLocation) {
    guard location.horizontalAccuracy >= 0 else {
      centerOnNextUserLocation = true
      return
    }
    if let requestedAt = pendingCenterRequestedAt,
       location.timestamp < requestedAt.addingTimeInterval(-1) {
      centerOnNextUserLocation = true
      return
    }
    mapView.setCenter(Self.amapCoordinate(location.coordinate), animated: animated)
    mapView.setZoomLevel(17, animated: animated)
    hasCenteredOnUser = true
    centerOnNextUserLocation = false
    pendingCenterRequestedAt = nil
  }

  private static func amapCoordinate(latitude: Double, longitude: Double) -> CLLocationCoordinate2D {
    amapCoordinate(CLLocationCoordinate2D(latitude: latitude, longitude: longitude))
  }

  private static func amapCoordinate(_ coordinate: CLLocationCoordinate2D) -> CLLocationCoordinate2D {
    AMapCoordinateConvert(coordinate, .GPS)
  }

  func mapView(
    _ mapView: MAMapView!,
    didUpdate userLocation: MAUserLocation!,
    updatingLocation: Bool
  ) {
    guard updatingLocation,
          let location = userLocation.location,
          location.horizontalAccuracy >= 0 else { return }
    if !hasCenteredOnUser || centerOnNextUserLocation {
      // MAMapView reports its user location in the coordinate system expected
      // by its own renderer; do not convert that value a second time.
      let displayedLocation = CLLocation(
        coordinate: userLocation.coordinate,
        altitude: location.altitude,
        horizontalAccuracy: location.horizontalAccuracy,
        verticalAccuracy: location.verticalAccuracy,
        course: location.course,
        speed: location.speed,
        timestamp: location.timestamp
      )
      centerOnDisplayedUser(animated: hasCenteredOnUser, location: displayedLocation)
    }
  }

  private func centerOnDisplayedUser(animated: Bool, location: CLLocation) {
    if let requestedAt = pendingCenterRequestedAt,
       location.timestamp < requestedAt.addingTimeInterval(-1) {
      centerOnNextUserLocation = true
      return
    }
    mapView.setCenter(location.coordinate, animated: animated)
    mapView.setZoomLevel(17, animated: animated)
    hasCenteredOnUser = true
    centerOnNextUserLocation = false
    pendingCenterRequestedAt = nil
  }

  func mapView(_ mapView: MAMapView!, rendererFor overlay: MAOverlay!) -> MAOverlayRenderer! {
    guard let polyline = overlay as? MAPolyline else { return nil }
    let renderer = MAPolylineRenderer(polyline: polyline)
    renderer?.strokeColor = .systemBlue
    renderer?.lineWidth = 4
    return renderer
  }

  func mapView(_ mapView: MAMapView!, viewFor annotation: MAAnnotation!) -> MAAnnotationView! {
    guard annotation is MAPointAnnotation else { return nil }
    let identifier = "HermesTodayPlace"
    let annotationView = mapView.dequeueReusableAnnotationView(withIdentifier: identifier)
      ?? MAAnnotationView(annotation: annotation, reuseIdentifier: identifier)
    annotationView?.annotation = annotation
    annotationView?.canShowCallout = true
    annotationView?.image = UIImage(systemName: "mappin.circle.fill")?.withTintColor(
      .systemBlue,
      renderingMode: .alwaysOriginal
    )
    annotationView?.centerOffset = CGPoint(x: 0, y: -12)
    return annotationView
  }
}
#endif
