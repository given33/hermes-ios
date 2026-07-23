import MapKit
import UIKit

final class HermesMapKitSurface: UIView, HermesMapRendering, MKMapViewDelegate {
  var onLocationPress: (() -> Void)?

  private let mapView = MKMapView(frame: .zero)
  private lazy var compassButton = MKCompassButton(mapView: mapView)
  private let locationButton = UIButton(type: .system)
  private var trackOverlay: MKPolyline?
  private var accuracyOverlay: MKCircle?
  private var placeAnnotations: [HermesPlaceAnnotation] = []
  private var hasCenteredOnUser = false
  private var hasActivatedLocation = false
  private var centerOnNextUserLocation = true
  private var pendingCenterRequestedAt: Date?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground

    let configuration = MKStandardMapConfiguration(
      elevationStyle: .flat,
      emphasisStyle: .default
    )
    configuration.showsTraffic = true
    mapView.preferredConfiguration = configuration
    mapView.delegate = self
    mapView.showsUserLocation = false
    mapView.showsCompass = false
    mapView.showsScale = true
    mapView.showsBuildings = false
    mapView.isScrollEnabled = true
    mapView.isZoomEnabled = true
    mapView.isRotateEnabled = true
    mapView.isPitchEnabled = false
    mapView.pointOfInterestFilter = .includingAll
    mapView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(mapView)

    compassButton.compassVisibility = .visible
    compassButton.translatesAutoresizingMaskIntoConstraints = false
    addSubview(compassButton)

    var locationConfiguration = UIButton.Configuration.filled()
    locationConfiguration.baseBackgroundColor = .secondarySystemBackground
    locationConfiguration.baseForegroundColor = .label
    locationConfiguration.cornerStyle = .medium
    locationConfiguration.image = UIImage(systemName: "location.fill")
    locationButton.configuration = locationConfiguration
    locationButton.accessibilityLabel = "Center on current location"
    locationButton.translatesAutoresizingMaskIntoConstraints = false
    // MKUserTrackingButton also changes the camera from its cached user
    // location. Keep one authoritative update: fetch a fresh precise location,
    // then center the map once.
    locationButton.addTarget(self, action: #selector(refreshCurrentLocation), for: .touchUpInside)
    addSubview(locationButton)

    NSLayoutConstraint.activate([
      mapView.leadingAnchor.constraint(equalTo: leadingAnchor),
      mapView.trailingAnchor.constraint(equalTo: trailingAnchor),
      mapView.topAnchor.constraint(equalTo: topAnchor),
      mapView.bottomAnchor.constraint(equalTo: bottomAnchor),
      compassButton.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -14),
      compassButton.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 14),
      compassButton.widthAnchor.constraint(equalToConstant: 44),
      compassButton.heightAnchor.constraint(equalToConstant: 44),
      locationButton.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -14),
      locationButton.topAnchor.constraint(equalTo: compassButton.bottomAnchor, constant: 8),
      locationButton.widthAnchor.constraint(equalToConstant: 44),
      locationButton.heightAnchor.constraint(equalToConstant: 44),
    ])
  }

  required init?(coder: NSCoder) {
    nil
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
    if let trackOverlay { mapView.removeOverlay(trackOverlay) }
    guard track.count > 1 else {
      trackOverlay = nil
      return
    }
    let coordinates = track.map {
      CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
    }
    let overlay = MKPolyline(coordinates: coordinates, count: coordinates.count)
    trackOverlay = overlay
    mapView.addOverlay(overlay, level: .aboveRoads)
  }

  func setPlaces(_ places: [HermesMapPlace]) {
    mapView.removeAnnotations(placeAnnotations)
    placeAnnotations = places.map(HermesPlaceAnnotation.init)
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
      guard let location = await Self.currentLocation() else { return }
      self.centerOnUser(animated: self.hasCenteredOnUser, location: location)
    }
  }

  @objc private func refreshCurrentLocation() {
    requestFreshCenter()
  }

  private static func currentLocation() async -> CLLocation? {
    guard let payload = await HermesLocationService.shared.requestCurrent(forceFresh: true),
          let latitude = payload["latitude"] as? Double,
          let longitude = payload["longitude"] as? Double,
          let timestamp = payload["timestamp"] as? Double else { return nil }
    return CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
      altitude: payload["altitude"] as? Double ?? 0,
      horizontalAccuracy: max(0, payload["accuracy"] as? Double ?? 0),
      verticalAccuracy: payload["verticalAccuracy"] as? Double ?? -1,
      course: payload["course"] as? Double ?? -1,
      speed: payload["speed"] as? Double ?? -1,
      timestamp: Date(timeIntervalSince1970: timestamp / 1_000)
    )
  }

  private func centerOnUser(animated: Bool, location: CLLocation? = nil) {
    guard let location = location ?? mapView.userLocation.location,
          location.horizontalAccuracy >= 0 else {
      centerOnNextUserLocation = true
      return
    }
    if let requestedAt = pendingCenterRequestedAt,
       location.timestamp < requestedAt.addingTimeInterval(-1) {
      centerOnNextUserLocation = true
      return
    }
    let region = MKCoordinateRegion(
      center: location.coordinate,
      latitudinalMeters: 900,
      longitudinalMeters: 900
    )
    mapView.setRegion(region, animated: animated)
    hasCenteredOnUser = true
    centerOnNextUserLocation = false
    pendingCenterRequestedAt = nil
  }

  func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
    if let circle = overlay as? MKCircle {
      let renderer = MKCircleRenderer(circle: circle)
      renderer.fillColor = UIColor.systemBlue.withAlphaComponent(0.12)
      renderer.strokeColor = UIColor.systemBlue.withAlphaComponent(0.4)
      renderer.lineWidth = 1
      return renderer
    }
    guard let polyline = overlay as? MKPolyline else { return MKOverlayRenderer(overlay: overlay) }
    let renderer = MKPolylineRenderer(polyline: polyline)
    renderer.strokeColor = .systemBlue
    renderer.lineWidth = 4
    renderer.lineCap = .round
    renderer.lineJoin = .round
    return renderer
  }

  func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
    guard let location = userLocation.location, location.horizontalAccuracy >= 0 else { return }
    if let accuracyOverlay { mapView.removeOverlay(accuracyOverlay) }
    let circle = MKCircle(center: location.coordinate, radius: location.horizontalAccuracy)
    accuracyOverlay = circle
    mapView.addOverlay(circle, level: .aboveRoads)
    if !hasCenteredOnUser || centerOnNextUserLocation {
      centerOnUser(animated: hasCenteredOnUser, location: location)
    }
  }

  func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
    guard annotation is HermesPlaceAnnotation else { return nil }
    let identifier = "HermesTodayPlace"
    let marker = mapView.dequeueReusableAnnotationView(withIdentifier: identifier) as? MKMarkerAnnotationView
      ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: identifier)
    marker.annotation = annotation
    marker.canShowCallout = true
    marker.markerTintColor = .systemBlue
    marker.glyphImage = UIImage(systemName: "mappin.and.ellipse")
    return marker
  }
}

private final class HermesPlaceAnnotation: NSObject, MKAnnotation {
  let coordinate: CLLocationCoordinate2D
  let title: String?
  let subtitle: String?

  init(_ place: HermesMapPlace) {
    coordinate = CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
    title = place.name
    subtitle = HermesMapPlaceText.subtitle(for: place)
    super.init()
  }
}
