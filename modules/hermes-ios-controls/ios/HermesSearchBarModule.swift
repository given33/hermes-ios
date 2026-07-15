import ExpoModulesCore
import UIKit

public final class HermesSearchBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSearchBar")
    View(HermesSearchBarView.self) {
      Events("onChangeText", "onSubmit")
      Prop("value") { (view, value: String) in view.value = value }
      Prop("placeholder") { (view, value: String) in view.placeholder = value }
      Prop("tintColor") { (view, color: String) in view.searchBar.tintColor = .hermes(color) }
      Prop("backgroundColorValue") { (view, color: String) in
        view.searchBar.searchTextField.backgroundColor = .hermes(color)
      }
      Prop("textColor") { (view, color: String) in
        view.searchBar.searchTextField.textColor = .hermes(color)
      }
      Prop("placeholderColor") { (view, color: String) in view.placeholderColor = color }
      Prop("fontName") { (view, name: String?) in view.fontName = name }
      Prop("fontSize") { (view, size: Double) in view.fontSize = CGFloat(size) }
    }
  }
}

final class HermesSearchBarView: ExpoView, UISearchBarDelegate {
  let onChangeText = EventDispatcher()
  let onSubmit = EventDispatcher()
  let searchBar = UISearchBar(frame: .zero)
  var value = "" {
    didSet { if searchBar.text != value { searchBar.text = value } }
  }
  var placeholder = "" { didSet { updateTextAppearance() } }
  var placeholderColor = "#8e8e93" { didSet { updateTextAppearance() } }
  var fontName: String? { didSet { updateTextAppearance() } }
  var fontSize: CGFloat = 14 { didSet { updateTextAppearance() } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    searchBar.delegate = self
    searchBar.searchBarStyle = .minimal
    searchBar.backgroundImage = UIImage()
    searchBar.searchTextField.clearButtonMode = .whileEditing
    searchBar.searchTextField.returnKeyType = .search
    addSubview(searchBar)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    searchBar.frame = bounds
  }

  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    value = searchText
    onChangeText(["value": searchText])
  }

  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
    onSubmit(["value": searchBar.text ?? ""])
    searchBar.resignFirstResponder()
  }

  private func updateTextAppearance() {
    let field = searchBar.searchTextField
    field.font = fontName.flatMap { UIFont(name: $0, size: fontSize) }
      ?? UIFont.systemFont(ofSize: fontSize)
    field.attributedPlaceholder = NSAttributedString(
      string: placeholder,
      attributes: [.foregroundColor: UIColor.hermes(placeholderColor)]
    )
  }
}
