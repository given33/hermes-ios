import ExpoModulesCore
import UIKit

public final class HermesPressFeedbackModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesPressFeedback")
    View(HermesPressFeedbackView.self) {
      Events("onNativePress", "onPressState")
      Prop("disabled") { (view, value: Bool) in view.disabled = value }
      Prop("haptic") { (view, value: String) in view.haptic = value }
      Prop("opacityTo") { (view, value: Double) in view.opacityTo = CGFloat(value) }
      Prop("scaleTo") { (view, value: Double) in view.scaleTo = CGFloat(value) }
    }
  }
}

final class HermesPressFeedbackView: ExpoView, UIGestureRecognizerDelegate {
  let onNativePress = EventDispatcher()
  let onPressState = EventDispatcher()
  var disabled = false {
    didSet { pressGesture.isEnabled = !disabled }
  }
  var haptic = "none"
  var opacityTo: CGFloat = 0.92
  var scaleTo: CGFloat = 0.982

  private lazy var pressGesture = UILongPressGestureRecognizer(
    target: self,
    action: #selector(handlePress(_:))
  )
  private var animator: UIViewPropertyAnimator?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    pressGesture.minimumPressDuration = 0
    pressGesture.allowableMovement = 10
    pressGesture.cancelsTouchesInView = true
    pressGesture.delegate = self
    addGestureRecognizer(pressGesture)
    isAccessibilityElement = true
    accessibilityTraits.insert(.button)
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    otherGestureRecognizer.view is UIScrollView
  }

  override func accessibilityActivate() -> Bool {
    guard !disabled else { return false }
    emitHaptic()
    onNativePress([:])
    return true
  }

  @objc private func handlePress(_ recognizer: UILongPressGestureRecognizer) {
    switch recognizer.state {
    case .began:
      onPressState(["pressed": true])
      animate(pressed: true)
    case .ended:
      onPressState(["pressed": false])
      animate(pressed: false)
      let point = recognizer.location(in: self)
      if bounds.insetBy(dx: -8, dy: -8).contains(point) {
        emitHaptic()
        onNativePress([:])
      }
    case .cancelled, .failed:
      onPressState(["pressed": false])
      animate(pressed: false)
    default:
      break
    }
  }

  private func animate(pressed: Bool) {
    animator?.stopAnimation(true)
    let changes = {
      self.alpha = pressed ? self.opacityTo : 1
      self.transform = pressed
        ? CGAffineTransform(scaleX: self.scaleTo, y: self.scaleTo)
        : .identity
    }
    let animator = UIViewPropertyAnimator(duration: 0.3, dampingRatio: 0.8, animations: changes)
    self.animator = animator
    animator.startAnimation()
  }

  private func emitHaptic() {
    switch haptic {
    case "selection":
      UISelectionFeedbackGenerator().selectionChanged()
    case "medium":
      UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    case "light":
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
    default:
      break
    }
  }
}
