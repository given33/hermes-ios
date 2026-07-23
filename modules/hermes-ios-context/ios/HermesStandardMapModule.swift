import ExpoModulesCore

public final class HermesStandardMapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesStandardMap")

    Function("getRegistrationContract") { () -> [String: Any] in
      ["version": 1, "view": "default"]
    }

    Function("getProviderStatus") { () -> [String: Any] in
      let consent = HermesNativeMapConfiguration.persistedPrivacyConsent
      let configured = HermesNativeMapConfiguration.amapConfigured
      return [
        "activeProvider": configured && consent ? "amap" : "mapkit",
        "amapConfigured": configured,
        "privacyConsent": consent,
      ]
    }

    AsyncFunction("setAmapPrivacyConsent") { (granted: Bool) -> [String: Any] in
      HermesNativeMapConfiguration.persistedPrivacyConsent = granted
      return [
        "activeProvider": HermesNativeMapConfiguration.amapConfigured && granted ? "amap" : "mapkit",
        "amapConfigured": HermesNativeMapConfiguration.amapConfigured,
        "privacyConsent": granted,
      ]
    }

    View(HermesStandardMapView.self) {
      Events("onLocationPress")

      Prop("showsUserLocation") { (view, value: Bool) in
        view.showsUserLocation = value
      }
      Prop("amapPrivacyConsentGranted") { (view, value: Bool) in
        view.amapPrivacyConsentGranted = value
      }
      Prop("centerOnUserRequest") { (view, value: Int) in
        view.centerOnUserRequest = value
      }
      Prop("track") { (view, value: [HermesMapCoordinate]) in
        view.track = value
      }
      Prop("places") { (view, value: [HermesMapPlace]) in
        view.places = value
      }
    }
  }
}
