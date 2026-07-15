import ExpoModulesCore
import UIKit

public final class HermesSegmentedControlModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSegmentedControl")
    View(HermesSegmentedControlView.self) {
      Events("onValueChange")
      Prop("values") { (view, values: [String]) in view.values = values }
      Prop("selectedIndex") { (view, index: Int) in view.selectedIndex = index }
      Prop("tintColor") { (view, color: String) in view.tintColorValue = color }
      Prop("backgroundColorValue") { (view, color: String) in view.backgroundColorValue = color }
      Prop("textColor") { (view, color: String) in view.textColorValue = color }
      Prop("selectedTextColor") { (view, color: String) in view.selectedTextColorValue = color }
      Prop("fontName") { (view, name: String?) in view.fontName = name }
      Prop("fontSize") { (view, size: Double) in view.fontSize = CGFloat(size) }
    }
  }
}

final class HermesSegmentedControlView: ExpoView {
  let onValueChange = EventDispatcher()
  private let control = UISegmentedControl()
  var values: [String] = [] { didSet { rebuildSegments() } }
  var selectedIndex = 0 { didSet { control.selectedSegmentIndex = selectedIndex } }
  var tintColorValue = "#007aff" { didSet { updateAppearance() } }
  var backgroundColorValue = "#00000000" { didSet { updateAppearance() } }
  var textColorValue = "#ffffff" { didSet { updateAppearance() } }
  var selectedTextColorValue = "#000000" { didSet { updateAppearance() } }
  var fontName: String? { didSet { updateAppearance() } }
  var fontSize: CGFloat = 13 { didSet { updateAppearance() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    control.addTarget(self, action: #selector(valueChanged), for: .valueChanged)
    addSubview(control)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    control.frame = bounds
  }

  private func rebuildSegments() {
    control.removeAllSegments()
    for (index, title) in values.enumerated() {
      control.insertSegment(withTitle: title, at: index, animated: false)
    }
    control.selectedSegmentIndex = min(max(0, selectedIndex), max(0, values.count - 1))
    updateAppearance()
  }

  private func updateAppearance() {
    control.backgroundColor = .hermes(backgroundColorValue)
    control.selectedSegmentTintColor = .hermes(tintColorValue)
    let font = fontName.flatMap { UIFont(name: $0, size: fontSize) }
      ?? UIFont.systemFont(ofSize: fontSize, weight: .medium)
    control.setTitleTextAttributes([
      .foregroundColor: UIColor.hermes(textColorValue),
      .font: font,
    ], for: .normal)
    control.setTitleTextAttributes([
      .foregroundColor: UIColor.hermes(selectedTextColorValue),
      .font: font,
    ], for: .selected)
  }

  @objc private func valueChanged() {
    UISelectionFeedbackGenerator().selectionChanged()
    onValueChange(["index": control.selectedSegmentIndex])
  }
}
