import ExpoModulesCore
import UIKit

public final class HermesSelectionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSelection")
    View(HermesSelectionView.self) {
      Prop("selected") { (view, value: Bool) in view.selected = value }
      Prop("selectedBackgroundColor") { (view, color: String) in view.selectedBackground = color }
      Prop("unselectedBackgroundColor") { (view, color: String) in view.unselectedBackground = color }
      Prop("selectedBorderColor") { (view, color: String) in view.selectedBorder = color }
      Prop("unselectedBorderColor") { (view, color: String) in view.unselectedBorder = color }
      Prop("checkmarkBackgroundColor") { (view, color: String) in
        view.checkmarkBackgroundColor = color
      }
      Prop("checkmarkTintColor") { (view, color: String) in view.checkmarkTintColor = color }
      Prop("borderWidth") { (view, width: Double) in view.layer.borderWidth = CGFloat(width) }
      Prop("cornerRadius") { (view, radius: Double) in view.layer.cornerRadius = CGFloat(radius) }
    }
  }
}

final class HermesSelectionView: ExpoView {
  private let checkmarkBackground = UIView()
  private let checkmark = UIImageView(image: UIImage(systemName: "checkmark"))
  private var animator: UIViewPropertyAnimator?
  var selected = false { didSet { updateSelection(animated: window != nil) } }
  var selectedBackground = "#00000000" { didSet { updateSelection(animated: false) } }
  var unselectedBackground = "#00000000" { didSet { updateSelection(animated: false) } }
  var selectedBorder = "#007aff" { didSet { updateSelection(animated: false) } }
  var unselectedBorder = "#8e8e93" { didSet { updateSelection(animated: false) } }
  var checkmarkBackgroundColor = "#007aff" { didSet { updateCheckmarkColors() } }
  var checkmarkTintColor = "#ffffff" { didSet { updateCheckmarkColors() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    checkmarkBackground.layer.cornerRadius = 10
    checkmarkBackground.addSubview(checkmark)
    checkmark.contentMode = .scaleAspectFit
    checkmark.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 10, weight: .bold)
    addSubview(checkmarkBackground)
    updateCheckmarkColors()
    updateSelection(animated: false)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    checkmarkBackground.frame = CGRect(
      x: max(0, bounds.width - 32),
      y: bounds.midY - 10,
      width: 20,
      height: 20
    )
    checkmark.frame = checkmarkBackground.bounds.insetBy(dx: 5, dy: 5)
    bringSubviewToFront(checkmarkBackground)
  }

  private func updateCheckmarkColors() {
    checkmarkBackground.backgroundColor = .hermes(checkmarkBackgroundColor)
    checkmark.tintColor = .hermes(checkmarkTintColor)
  }

  private func updateSelection(animated: Bool) {
    animator?.stopAnimation(true)
    // Compute the target values up front so the animations block does not
    // need to capture self. Storing self.animator while the closure
    // retains self would otherwise pin every HermesSelectionView in
    // memory for the lifetime of the host VC.
    let targetBackground: UIColor = .hermes(selected ? selectedBackground : unselectedBackground)
    let targetBorderCGColor: CGColor = UIColor.hermes(
      selected ? selectedBorder : unselectedBorder
    ).cgColor
    let targetCheckmarkAlpha: CGFloat = selected ? 1 : 0
    let targetCheckmarkTransform: CGAffineTransform = selected
      ? .identity
      : CGAffineTransform(scaleX: 0.72, y: 0.72)
    let apply = { [weak self] in
      guard let self else { return }
      self.backgroundColor = targetBackground
      self.layer.borderColor = targetBorderCGColor
      self.checkmarkBackground.alpha = targetCheckmarkAlpha
      self.checkmarkBackground.transform = targetCheckmarkTransform
    }
    guard animated else {
      apply()
      return
    }
    let animator = UIViewPropertyAnimator(duration: 0.34, dampingRatio: 0.82) {
      apply()
    }
    animator.addCompletion { [weak self] _ in
      guard self?.animator === animator else { return }
      self?.animator = nil
    }
    self.animator = animator
    animator.startAnimation()
  }
}
