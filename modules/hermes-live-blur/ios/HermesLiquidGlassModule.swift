import ExpoModulesCore
import UIKit

public final class HermesLiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesLiquidGlass")

    View(HermesLiquidGlassView.self) {
      Prop("blurRadius") { (view, radius: Double) in
        view.blurRadius = CGFloat(max(0, radius))
      }

      Prop("glassCornerRadius") { (view, radius: Double) in
        view.glassCornerRadius = CGFloat(max(0, radius))
      }

      Prop("interactive") { (view, interactive: Bool) in
        view.isGlassInteractive = interactive
      }

      Prop("tintColor") { (view, color: UIColor?) in
        view.glassTintColor = color ?? UIColor.white.withAlphaComponent(0.06)
      }
    }
  }
}
