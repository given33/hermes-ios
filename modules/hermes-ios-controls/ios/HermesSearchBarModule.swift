import ExpoModulesCore
import SwiftUI

public final class HermesSearchBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSearchBar")
    View(HermesSearchBarView.self)
  }
}

final class HermesSearchBarProps: ExpoSwiftUI.ViewProps {
  @Field var value = ""
  @Field var placeholder = ""
  @Field var tintColor = "#007aff"
  @Field var backgroundColorValue = "#1c1c1e"
  @Field var textColor = "#ffffff"
  @Field var placeholderColor = "#8e8e93"
  @Field var fontName: String?
  @Field var fontSize = 14.0

  var onChangeText = EventDispatcher()
  var onSubmit = EventDispatcher()
}

struct HermesSearchBarView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesSearchBarProps
  @State private var text = ""

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(Color.hermes(props.placeholderColor))

      TextField(
        "",
        text: $text,
        prompt: Text(props.placeholder)
          .foregroundColor(Color.hermes(props.placeholderColor))
      )
      .font(resolvedFont)
      .foregroundStyle(Color.hermes(props.textColor))
      .tint(Color.hermes(props.tintColor))
      .submitLabel(.search)
      .onSubmit {
        props.onSubmit(["value": text])
      }

      if !text.isEmpty {
        SwiftUI.Button {
          text = ""
        } label: {
          Image(systemName: "xmark.circle.fill")
            .foregroundStyle(Color.hermes(props.placeholderColor))
        }
        .buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 9)
    .background(Color.hermes(props.backgroundColorValue))
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    .onChange(of: text) { _, next in
      guard next != props.value else { return }
      props.onChangeText(["value": next])
    }
    .onReceive(props.objectWillChange) {
      if text != props.value { text = props.value }
    }
    .onAppear {
      text = props.value
    }
  }

  private var resolvedFont: Font {
    guard let fontName = props.fontName else {
      return .system(size: props.fontSize, design: .monospaced)
    }
    return .custom(fontName, size: props.fontSize)
  }
}
