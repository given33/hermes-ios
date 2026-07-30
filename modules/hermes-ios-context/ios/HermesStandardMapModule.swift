import ExpoModulesCore

public final class HermesStandardMapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesStandardMap")

    Function("getRegistrationContract") { () -> [String: Any] in
      ["version": 1, "view": "default"]
    }

    Function("getProviderStatus") { () -> [String: Any] in
      HermesNativeMapRuntimeState.shared.snapshot()
    }

    AsyncFunction("setAmapPrivacyConsent") { (granted: Bool) -> [String: Any] in
      HermesNativeMapConfiguration.persistedPrivacyConsent = granted
      HermesNativeMapRuntimeState.shared.update(
        phase: HermesNativeMapConfiguration.amapConfigured
          ? (granted ? "initializing" : "requestingPermission")
          : "unconfigured",
        activeProvider: HermesNativeMapConfiguration.amapConfigured && granted ? "amap" : "mapkit"
      )
      return HermesNativeMapRuntimeState.shared.snapshot()
    }

    View(HermesStandardMapView.self) {
      Events("onLocationPress", "onProviderStatus")

      Prop("showsUserLocation") { (view, value: Bool) in
        view.showsUserLocation = value
      }
      Prop("amapPrivacyConsentGranted") { (view, value: Bool) in
        view.amapPrivacyConsentGranted = value
      }
      Prop("centerOnUserRequest") { (view, value: Int) in
        view.centerOnUserRequest = value
      }
      Prop("providerResetRequest") { (view, value: Int) in
        view.providerResetRequest = value
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
