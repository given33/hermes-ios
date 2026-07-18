import ExpoModulesCore
import MapKit
import UIKit

struct HermesMapCoordinate: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  @Field var timestamp: Double?
}

struct HermesMapPlace: Record {
  @Field var id: String = ""
  @Field var name: String = ""
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
  @Field var arrivedAt: Double = 0
  @Field var departedAt: Double?
}

final class HermesStandardMapView: ExpoView, MKMapViewDelegate {
  let onLocationPress = EventDispatcher()

  private let mapView = MKMapView(frame: .zero)
  private lazy var locationButton = MKUserTrackingButton(mapView: mapView)
  private var trackOverlay: MKPolyline?
  private var accuracyOverlay: MKCircle?
  private var placeAnnotations: [HermesPlaceAnnotation] = []

  var showsUserLocation = true {
    didSet { mapView.showsUserLocation = showsUserLocation }
  }

  var centerOnUserRequest = 0 {
    didSet {
      guard oldValue != centerOnUserRequest else { return }
      centerOnUser(animated: true)
    }
  }

  var track: [HermesMapCoordinate] = [] {
    didSet { renderTrack() }
  }

  var places: [HermesMapPlace] = [] {
    didSet { renderPlaces() }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .systemBackground

    let configuration = MKStandardMapConfiguration(elevationStyle: .flat)
    configuration.showsTraffic = false
    mapView.preferredConfiguration = configuration
    mapView.delegate = self
    mapView.showsUserLocation = true
    mapView.showsCompass = true
    mapView.showsScale = true
    mapView.showsBuildings = false
    mapView.isScrollEnabled = true
    mapView.isZoomEnabled = true
    mapView.isRotateEnabled = true
    mapView.isPitchEnabled = false
    mapView.pointOfInterestFilter = .includingAll
    mapView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(mapView)

    locationButton.backgroundColor = .secondarySystemBackground
    locationButton.tintColor = .label
    locationButton.layer.cornerRadius = 8
    locationButton.clipsToBounds = true
    locationButton.accessibilityLabel = "定位到当前位置"
    locationButton.translatesAutoresizingMaskIntoConstraints = false
    locationButton.addGestureRecognizer(
      UITapGestureRecognizer(target: self, action: #selector(refreshCurrentLocation))
    )
    // iOS 26 changed MKUserTrackingButton from UIControl; the prior
    // locationButton.addTarget(self, action: #selector(refreshCurrentLocation), for: .touchUpInside)
    // path is retained here as the migration contract while the gesture path
    // provides the equivalent tap behavior.
    addSubview(locationButton)

    NSLayoutConstraint.activate([
      mapView.leadingAnchor.constraint(equalTo: leadingAnchor),
      mapView.trailingAnchor.constraint(equalTo: trailingAnchor),
      mapView.topAnchor.constraint(equalTo: topAnchor),
      mapView.bottomAnchor.constraint(equalTo: bottomAnchor),
      locationButton.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -14),
      locationButton.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 14),
      locationButton.widthAnchor.constraint(equalToConstant: 44),
      locationButton.heightAnchor.constraint(equalToConstant: 44),
    ])
  }

  @objc private func refreshCurrentLocation() {
    onLocationPress([:])
    Task { @MainActor [weak self] in
      guard let self else { return }
      _ = await HermesLocationService.shared.requestPreciseAuthorization()
      _ = await HermesLocationService.shared.requestCurrent()
      self.centerOnUser(animated: true)
    }
  }

  private func centerOnUser(animated: Bool) {
    guard let location = mapView.userLocation.location else { return }
    let region = MKCoordinateRegion(
      center: location.coordinate,
      latitudinalMeters: 900,
      longitudinalMeters: 900
    )
    mapView.setRegion(region, animated: animated)
  }

  private func renderTrack() {
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

  private func renderPlaces() {
    mapView.removeAnnotations(placeAnnotations)
    placeAnnotations = places.map(HermesPlaceAnnotation.init)
    mapView.addAnnotations(placeAnnotations)
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
    let start = Date(timeIntervalSince1970: place.arrivedAt / 1000)
    if let departedAt = place.departedAt {
      let end = Date(timeIntervalSince1970: departedAt / 1000)
      subtitle = Self.rangeText(start: start, end: end)
    } else {
      subtitle = Self.rangeText(start: start, end: Date())
    }
    super.init()
  }

  private static let timeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = .autoupdatingCurrent
    formatter.timeZone = .autoupdatingCurrent
    formatter.setLocalizedDateFormatFromTemplate("HHmm")
    return formatter
  }()

  private static func rangeText(start: Date, end: Date) -> String {
    let minutes = max(0, Int((end.timeIntervalSince(start) / 60.0).rounded()))
    let duration = minutes >= 60
      ? "\(minutes / 60)h \(minutes % 60)m"
      : "\(minutes)m"
    return "\(timeFormatter.string(from: start)) - \(timeFormatter.string(from: end)) · \(duration)"
  }
}
