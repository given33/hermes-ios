import ExpoModulesCore
import UIKit

public final class HermesInputFocusModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesInputFocus")
    View(HermesInputFocusView.self) {
      Prop("backgroundColorValue") { (view, value: String) in
        view.backgroundColorValue = UIColor.hermes(value)
      }
      Prop("borderColor") { (view, value: String) in
        view.borderColorValue = UIColor.hermes(value)
      }
      Prop("borderWidth") { (view, value: Double) in
        view.borderWidthValue = CGFloat(value)
      }
      Prop("focusBorderColor") { (view, value: String) in
        view.focusBorderColorValue = UIColor.hermes(value)
      }
      Prop("focused") { (view, value: Bool) in
        view.setFocused(value, animated: view.window != nil)
      }
      Prop("focusRingColor") { (view, value: String) in
        view.focusRingColorValue = UIColor.hermes(value)
      }
      Prop("focusRingWidth") { (view, value: Double) in
        view.focusRingWidthValue = CGFloat(value)
      }
    }
  }
}

final class HermesInputFocusView: ExpoView {
  var backgroundColorValue = UIColor.clear { didSet { updateAppearance() } }
  var borderColorValue = UIColor.clear { didSet { updateAppearance() } }
  var borderWidthValue: CGFloat = 0 { didSet { updateAppearance() } }
  var focusBorderColorValue = UIColor.clear { didSet { updateAppearance() } }
  var focusRingColorValue = UIColor.clear { didSet { updateAppearance() } }
  var focusRingWidthValue: CGFloat = 0 { didSet { setNeedsLayout() } }

  private let focusRingLayer = CAShapeLayer()
  private var focused = false
  private var animator: UIViewPropertyAnimator?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    layer.addSublayer(focusRingLayer)
    focusRingLayer.fillColor = UIColor.clear.cgColor
    focusRingLayer.opacity = 0
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    focusRingLayer.frame = bounds
    focusRingLayer.path = UIBezierPath(rect: focusRingLayer.bounds).cgPath
    focusRingLayer.lineWidth = focusRingWidthValue * 2
  }

  func setFocused(_ value: Bool, animated: Bool) {
    guard focused != value else {
      updateAppearance()
      return
    }
    focused = value
    animator?.stopAnimation(true)
    let changes = { self.updateAppearance() }
    guard animated else {
      changes()
      return
    }
    let animator = UIViewPropertyAnimator(
      duration: 0.22,
      curve: .easeInOut,
      animations: changes
    )
    self.animator = animator
    animator.startAnimation()
  }

  private func updateAppearance() {
    backgroundColor = backgroundColorValue
    layer.borderWidth = borderWidthValue
    layer.borderColor = (focused ? focusBorderColorValue : borderColorValue).cgColor
    focusRingLayer.strokeColor = focusRingColorValue.cgColor
    focusRingLayer.opacity = focused ? 1 : 0
  }
}
