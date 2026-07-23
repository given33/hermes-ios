import ExpoModulesCore
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

protocol HermesMapRendering: AnyObject {
  var onLocationPress: (() -> Void)? { get set }
  func requestFreshCenter()
  func setPlaces(_ places: [HermesMapPlace])
  func setShowsUserLocation(_ shows: Bool)
  func setTrack(_ track: [HermesMapCoordinate])
}

enum HermesNativeMapConfiguration {
  static let privacyConsentKey = "app.hermes.amap.privacy-consent"

  static var amapAPIKey: String {
    (Bundle.main.object(forInfoDictionaryKey: "HermesAmapIOSAPIKey") as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  static var amapConfigured: Bool {
    #if canImport(MAMapKit)
    !amapAPIKey.isEmpty
    #else
    false
    #endif
  }

  static var persistedPrivacyConsent: Bool {
    get { UserDefaults.standard.bool(forKey: privacyConsentKey) }
    set { UserDefaults.standard.set(newValue, forKey: privacyConsentKey) }
  }
}

final class HermesStandardMapView: ExpoView {
  let onLocationPress = EventDispatcher()

  private var renderer: HermesMapRendering?
  private var rendererView: UIView?
  private var usingAMap = false

  var amapPrivacyConsentGranted = false {
    didSet {
      guard oldValue != amapPrivacyConsentGranted else { return }
      installRendererIfNeeded()
    }
  }

  var showsUserLocation = false {
    didSet { renderer?.setShowsUserLocation(showsUserLocation) }
  }

  var centerOnUserRequest = 0 {
    didSet {
      guard oldValue != centerOnUserRequest else { return }
      renderer?.requestFreshCenter()
    }
  }

  var track: [HermesMapCoordinate] = [] {
    didSet { renderer?.setTrack(track) }
  }

  var places: [HermesMapPlace] = [] {
    didSet { renderer?.setPlaces(places) }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .systemBackground
    installRendererIfNeeded()
  }

  private var shouldUseAMap: Bool {
    HermesNativeMapConfiguration.amapConfigured && amapPrivacyConsentGranted
  }

  private func installRendererIfNeeded() {
    let nextUsesAMap = shouldUseAMap
    guard renderer == nil || usingAMap != nextUsesAMap else { return }

    rendererView?.removeFromSuperview()
    renderer = nil
    rendererView = nil

    let nextRenderer: HermesMapRendering
    let nextView: UIView
    #if canImport(MAMapKit)
    if nextUsesAMap {
      let amap = HermesAMapSurface(apiKey: HermesNativeMapConfiguration.amapAPIKey)
      nextRenderer = amap
      nextView = amap
    } else {
      let mapKit = HermesMapKitSurface(frame: .zero)
      nextRenderer = mapKit
      nextView = mapKit
    }
    #else
    let mapKit = HermesMapKitSurface(frame: .zero)
    nextRenderer = mapKit
    nextView = mapKit
    #endif

    usingAMap = nextUsesAMap
    renderer = nextRenderer
    rendererView = nextView
    nextRenderer.onLocationPress = { [weak self] in self?.onLocationPress([:]) }
    nextRenderer.setShowsUserLocation(showsUserLocation)
    nextRenderer.setTrack(track)
    nextRenderer.setPlaces(places)
    nextView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(nextView)
    NSLayoutConstraint.activate([
      nextView.leadingAnchor.constraint(equalTo: leadingAnchor),
      nextView.trailingAnchor.constraint(equalTo: trailingAnchor),
      nextView.topAnchor.constraint(equalTo: topAnchor),
      nextView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }
}

enum HermesMapPlaceText {
  private static let timeFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = .autoupdatingCurrent
    formatter.timeZone = .autoupdatingCurrent
    formatter.setLocalizedDateFormatFromTemplate("HHmm")
    return formatter
  }()

  static func subtitle(for place: HermesMapPlace) -> String {
    let start = Date(timeIntervalSince1970: place.arrivedAt / 1000)
    let end = place.departedAt.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
    let minutes = max(0, Int((end.timeIntervalSince(start) / 60.0).rounded()))
    let duration = minutes >= 60 ? "\(minutes / 60)h \(minutes % 60)m" : "\(minutes)m"
    return "\(timeFormatter.string(from: start)) - \(timeFormatter.string(from: end)) | \(duration)"
  }
}
