import ExpoModulesCore

public final class HermesLiveBlurModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesLiveBlur")
    View(HermesLiveBlurView.self)
  }
}
