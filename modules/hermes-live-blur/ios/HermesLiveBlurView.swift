import ExpoModulesCore
import UIKit

final class HermesLiveBlurView: ExpoView {
  private let effectView = UIVisualEffectView(effect: UIBlurEffect(style: .regular))

  var blurRadius: CGFloat = 8 {
    didSet {
      installGaussianFilter()
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    effectView.isUserInteractionEnabled = false
    effectView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(effectView)
    NSLayoutConstraint.activate([
      effectView.topAnchor.constraint(equalTo: topAnchor),
      effectView.bottomAnchor.constraint(equalTo: bottomAnchor),
      effectView.leadingAnchor.constraint(equalTo: leadingAnchor),
      effectView.trailingAnchor.constraint(equalTo: trailingAnchor)
    ])
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    installGaussianFilter()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    installGaussianFilter()
  }

  override func traitCollectionDidChange(
    _ previousTraitCollection: UITraitCollection?
  ) {
    installGaussianFilter()
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

    for tintView in effectView.subviews.dropFirst() {
      tintView.alpha = 0
    }
  }
}
