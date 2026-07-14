import ExpoModulesCore
import SwiftUI

public final class HermesTextInputModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesTextInput")
    View(HermesTextInputView.self)
  }
}

final class HermesTextInputProps: ExpoSwiftUI.ViewProps {
  @Field var value = ""
  @Field var controlled = false
  @Field var placeholder = ""
  @Field var secure = false
  @Field var multiline = false
  @Field var editable = true
  @Field var autoCorrect = true
  @Field var autoCapitalize = "sentences"
  @Field var returnKeyType = "default"
  @Field var textColor = "#ffffff"
  @Field var placeholderColor = "#8e8e93"
  @Field var backgroundColorValue = "#00000000"
  @Field var borderColor = "#8e8e93"
  @Field var focusBorderColor = "#007aff"
  @Field var focusRingColor = "#007aff33"
  @Field var tintColor = "#007aff"
  @Field var fontName: String?
  @Field var fontSize = 15.0
  @Field var paddingHorizontal = 12.0
  @Field var paddingVertical = 8.0
  @Field var borderWidth = 1.0
  @Field var focusRingWidth = 2.0
  @Field var focusRequest = 0

  var onChangeText = EventDispatcher()
  var onNativeFocus = EventDispatcher()
  var onNativeBlur = EventDispatcher()
  var onNativeSubmit = EventDispatcher()
}

struct HermesTextInputView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesTextInputProps
  @State private var text = ""
  @FocusState private var focused: Bool

  var body: some View {
    Group {
      if props.secure {
        SecureField(
          "",
          text: $text,
          prompt: Text(props.placeholder)
            .foregroundColor(Color.hermes(props.placeholderColor))
        )
      } else if props.multiline {
        ZStack(alignment: .topLeading) {
          if text.isEmpty {
            Text(props.placeholder)
              .foregroundStyle(Color.hermes(props.placeholderColor))
              .allowsHitTesting(false)
          }
          TextEditor(text: $text)
            .scrollContentBackground(.hidden)
        }
      } else {
        TextField(
          "",
          text: $text,
          prompt: Text(props.placeholder)
            .foregroundColor(Color.hermes(props.placeholderColor))
        )
      }
    }
    .font(resolvedFont)
    .foregroundStyle(Color.hermes(props.textColor))
    .tint(Color.hermes(props.tintColor))
    .textInputAutocapitalization(capitalization)
    .autocorrectionDisabled(!props.autoCorrect)
    .submitLabel(submitLabel)
    .disabled(!props.editable)
    .focused($focused)
    .padding(.horizontal, props.paddingHorizontal)
    .padding(.vertical, props.paddingVertical)
    .background(Color.hermes(props.backgroundColorValue))
    .overlay {
      Rectangle()
        .stroke(
          Color.hermes(focused ? props.focusBorderColor : props.borderColor),
          lineWidth: props.borderWidth
        )
    }
    .overlay {
      Rectangle()
        .stroke(
          focused ? Color.hermes(props.focusRingColor) : .clear,
          lineWidth: props.focusRingWidth
        )
        .padding(-props.focusRingWidth)
    }
    .onSubmit {
      props.onNativeSubmit(["value": text])
    }
    .onChange(of: text) { next in
      guard next != props.value else { return }
      props.onChangeText(["value": next])
    }
    .onChange(of: focused) { next in
      if next {
        props.onNativeFocus()
      } else {
        props.onNativeBlur()
      }
    }
    .onChange(of: props.focusRequest) { next in
      if next > 0 { focused = true }
    }
    .onReceive(props.objectWillChange) {
      if props.controlled && text != props.value {
        text = props.value
      }
    }
    .onAppear {
      text = props.value
      if props.focusRequest > 0 { focused = true }
    }
  }

  private var resolvedFont: Font {
    guard let fontName = props.fontName else {
      return .system(size: props.fontSize, design: .monospaced)
    }
    return .custom(fontName, size: props.fontSize)
  }

  private var capitalization: TextInputAutocapitalization {
    switch props.autoCapitalize {
    case "none": return .never
    case "words": return .words
    case "characters": return .characters
    default: return .sentences
    }
  }

  private var submitLabel: SubmitLabel {
    switch props.returnKeyType {
    case "done": return .done
    case "go": return .go
    case "join": return .join
    case "next": return .next
    case "route": return .route
    case "search": return .search
    case "send": return .send
    case "continue": return .continue
    default: return .return
    }
  }
}
