import ExpoModulesCore
import UIKit

public final class HermesSwitchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSwitch")
    View(HermesSwitchView.self) {
      Events("onValueChange")
      Prop("value") { (view, value: Bool) in view.value = value }
      Prop("disabled") { (view, disabled: Bool) in view.control.isEnabled = !disabled }
      Prop("onTintColor") { (view, color: String) in view.control.onTintColor = .hermes(color) }
      Prop("offTintColor") { (view, color: String) in view.control.tintColor = .hermes(color) }
      Prop("thumbTintColor") { (view, color: String?) in
        view.control.thumbTintColor = color.map(UIColor.hermes)
      }
    }
  }
}

final class HermesSwitchView: ExpoView {
  let onValueChange = EventDispatcher()
  let control = UISwitch()
  var value = false {
    didSet {
      guard control.isOn != value else { return }
      control.setOn(value, animated: window != nil)
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    control.addTarget(self, action: #selector(valueChanged), for: .valueChanged)
    addSubview(control)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    control.center = CGPoint(x: bounds.midX, y: bounds.midY)
  }

  @objc private func valueChanged() {
    value = control.isOn
    UISelectionFeedbackGenerator().selectionChanged()
    onValueChange(["value": value])
  }
}
