import ExpoModulesCore
import SwiftUI

public final class HermesLiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesLiquidGlass")
    View(HermesLiquidGlassView.self)
  }
}

final class HermesLiquidGlassProps: ExpoSwiftUI.ViewProps {
  @Field var blurRadius = 24.0
  @Field var glassCornerRadius = 15.0
  @Field var interactive = true
  @Field var tintColor = "#0f172a0f"
}
