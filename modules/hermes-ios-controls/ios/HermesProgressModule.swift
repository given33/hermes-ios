import ExpoModulesCore
import UIKit

public final class HermesProgressModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesProgress")
    View(HermesProgressView.self) {
      Prop("progress") { (view, value: Double) in view.progress = Float(value) }
      Prop("progressTintColor") { (view, color: String) in
        view.control.progressTintColor = .hermes(color)
      }
      Prop("trackTintColor") { (view, color: String) in
        view.control.trackTintColor = .hermes(color)
      }
      Prop("trackHeight") { (view, height: Double) in view.trackHeight = CGFloat(height) }
    }
  }
}

final class HermesProgressView: ExpoView {
  let control = UIProgressView(progressViewStyle: .bar)
  var progress: Float = 0 {
    didSet {
      control.setProgress(min(1, max(0, progress)), animated: window != nil)
    }
  }
  var trackHeight: CGFloat = 4 { didSet { setNeedsLayout() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    control.clipsToBounds = true
    addSubview(control)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    control.frame = CGRect(x: 0, y: bounds.midY - 1, width: bounds.width, height: 2)
    control.transform = CGAffineTransform(scaleX: 1, y: max(1, trackHeight / 2))
    control.layer.cornerRadius = 1
  }
}
