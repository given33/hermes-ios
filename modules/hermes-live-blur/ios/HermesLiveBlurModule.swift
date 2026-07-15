import ExpoModulesCore

public final class HermesLiveBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesLiveBlur")

    View(HermesLiveBlurView.self) {
      Prop("blurRadius") { (view, radius: Double) in
        view.blurRadius = CGFloat(max(0, radius))
      }
    }
  }
}
