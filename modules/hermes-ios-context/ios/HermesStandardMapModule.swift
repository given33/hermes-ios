import ExpoModulesCore

public final class HermesStandardMapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesStandardMap")

    Function("getRegistrationContract") { () -> [String: Any] in
      ["version": 1, "view": "default"]
    }

    View(HermesStandardMapView.self) {
      Events("onLocationPress")

      Prop("showsUserLocation") { (view, value: Bool) in
        view.showsUserLocation = value
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
