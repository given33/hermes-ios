import ExpoModulesCore
import UIKit

final class HermesLiquidGlassView: ExpoView, UIGestureRecognizerDelegate {
  private let effectView = UIVisualEffectView()
  private let tintView = UIView()
  private let highlightView = UIView()
  private let borderView = UIView()
  private let highlightLayer = CAGradientLayer()
  private let borderLayer = CAShapeLayer()
  private var interactionAnimator: UIViewPropertyAnimator?
  private var interactionActive = false
  private lazy var pressRecognizer = UILongPressGestureRecognizer(
    target: self,
    action: #selector(handlePress(_:))
  )

  var blurRadius: CGFloat = 24 {
    didSet { installGaussianFilter() }
  }

  var glassCornerRadius: CGFloat = 15 {
    didSet { updateGeometry() }
  }

  var isGlassInteractive = true {
    didSet { pressRecognizer.isEnabled = isGlassInteractive }
  }

  var glassTintColor = UIColor.white.withAlphaComponent(0.06) {
    didSet { updateAppearance() }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    let blur = UIBlurEffect(style: .systemUltraThinMaterial)
    effectView.effect = blur
    for view in [effectView, tintView, highlightView, borderView] {
      view.isUserInteractionEnabled = false
      addSubview(view)
    }

    highlightLayer.colors = [
      UIColor.white.withAlphaComponent(0.34).cgColor,
      UIColor.white.withAlphaComponent(0.08).cgColor,
      UIColor.white.withAlphaComponent(0.01).cgColor,
    ]
    highlightLayer.locations = [0, 0.38, 1]
    highlightLayer.startPoint = CGPoint(x: 0.05, y: 0)
    highlightLayer.endPoint = CGPoint(x: 0.9, y: 1)
    highlightView.layer.addSublayer(highlightLayer)

    borderLayer.fillColor = UIColor.clear.cgColor
    borderLayer.strokeColor = UIColor.white.withAlphaComponent(0.24).cgColor
    borderLayer.lineWidth = 0.75
    borderView.layer.addSublayer(borderLayer)

    pressRecognizer.minimumPressDuration = 0
    pressRecognizer.cancelsTouchesInView = false
    pressRecognizer.delegate = self
    addGestureRecognizer(pressRecognizer)

    updateAppearance()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    installGaussianFilter()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    for view in [effectView, tintView, highlightView, borderView] {
      view.frame = bounds
    }
    highlightLayer.frame = bounds
    borderLayer.frame = bounds
    updateGeometry()
    installGaussianFilter()
  }

  override func traitCollectionDidChange(
    _ previousTraitCollection: UITraitCollection?
  ) {
    super.traitCollectionDidChange(previousTraitCollection)
    updateAppearance()
    installGaussianFilter()
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    true
  }

  @objc private func handlePress(_ recognizer: UILongPressGestureRecognizer) {
    guard isGlassInteractive else { return }

    switch recognizer.state {
    case .began, .changed:
      let location = recognizer.location(in: self)
      let x = bounds.width > 0 ? location.x / bounds.width : 0.5
      let y = bounds.height > 0 ? location.y / bounds.height : 0.5
      highlightLayer.startPoint = CGPoint(
        x: min(1, max(0, x - 0.35)),
        y: min(1, max(0, y - 0.5))
      )
      highlightLayer.endPoint = CGPoint(
        x: min(1, max(0, x + 0.45)),
        y: min(1, max(0, y + 0.65))
      )
      if recognizer.state == .began {
        animateInteraction(active: true)
      }
    case .ended, .cancelled, .failed:
      animateInteraction(active: false)
    default:
      break
    }
  }

  private func animateInteraction(active: Bool) {
    guard interactionActive != active else { return }
    interactionActive = active
    interactionAnimator?.stopAnimation(true)

    let animations = {
      self.tintView.alpha = active ? 1.18 : 1
      self.highlightView.alpha = active ? 1 : 0.78
      self.transform = active
        ? CGAffineTransform(scaleX: 0.996, y: 0.996)
        : .identity
    }
    let animator = UIViewPropertyAnimator(
      duration: active ? 0.18 : 0.36,
      dampingRatio: active ? 1 : 0.86,
      animations: animations
    )
    interactionAnimator = animator
    animator.addCompletion { [weak self, weak animator] _ in
      guard self?.interactionAnimator === animator else { return }
      self?.interactionAnimator = nil
    }
    animator.startAnimation()
  }

  private func updateAppearance() {
    tintView.backgroundColor = glassTintColor
    highlightView.alpha = 0.78
    borderLayer.strokeColor = UIColor.white.withAlphaComponent(0.24).cgColor
  }

  private func updateGeometry() {
    layer.cornerRadius = glassCornerRadius
    layer.cornerCurve = .continuous
    layer.masksToBounds = true
    let inset = borderLayer.lineWidth / 2
    borderLayer.path = UIBezierPath(
      roundedRect: bounds.insetBy(dx: inset, dy: inset),
      cornerRadius: max(0, glassCornerRadius - inset)
    ).cgPath
  }

  private func installGaussianFilter() {
    let className = String("retliFAC".reversed())
    let selectorName = String(":epyThtiWretlif".reversed())
    let filterName = String("rulBnaissuag".reversed())

    guard
      let filterClass = NSClassFromString(className) as? NSObject.Type,
      let unmanagedFilter = filterClass.self.perform(
        NSSelectorFromString(selectorName),
        with: filterName
      ),
      let gaussianFilter = unmanagedFilter.takeUnretainedValue() as? NSObject,
      let backdropLayer = effectView.subviews.first?.layer
    else {
      return
    }

    gaussianFilter.setValue(blurRadius, forKey: "inputRadius")
    gaussianFilter.setValue(true, forKey: "inputNormalizeEdges")
    backdropLayer.filters = [gaussianFilter]
    if let displayScale = window?.traitCollection.displayScale {
      backdropLayer.setValue(displayScale, forKey: "scale")
    }
  }
}
