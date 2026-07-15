import ExpoModulesCore
import SwiftUI

public final class HermesPressFeedbackModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesPressFeedback")
    View(HermesPressFeedbackView.self)
  }
}

final class HermesPressFeedbackProps: ExpoSwiftUI.ViewProps {
  @Field var disabled = false
  @Field var haptic = "none"
  @Field var opacityTo = 0.92
  @Field var scaleTo = 0.982

  var onNativePress = EventDispatcher()
  var onPressState = EventDispatcher()
}

struct HermesPressFeedbackView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HermesPressFeedbackProps
  @State private var hapticTrigger = 0

  var body: some View {
    sensoryFeedback(
      for: SwiftUI.Button(action: commitPress) {
        Children()
      }
      .buttonStyle(HermesPressButtonStyle(
        opacityTo: props.opacityTo,
        scaleTo: props.scaleTo,
        onPressState: { pressed in
          props.onPressState(["pressed": pressed])
        }
      ))
      .disabled(props.disabled)
    )
  }

  private func commitPress() {
    hapticTrigger += 1
    props.onNativePress()
  }

  @ViewBuilder
  private func sensoryFeedback<Content: View>(for content: Content) -> some View {
    if #available(iOS 17.0, *) {
      switch props.haptic {
      case "selection":
        content.sensoryFeedback(.selection, trigger: hapticTrigger)
      case "medium":
        content.sensoryFeedback(.impact(weight: .medium), trigger: hapticTrigger)
      case "light":
        content.sensoryFeedback(.impact(weight: .light), trigger: hapticTrigger)
      default:
        content
      }
    } else {
      content
    }
  }
}

private struct HermesPressButtonStyle: ButtonStyle {
  let opacityTo: Double
  let scaleTo: Double
  let onPressState: (Bool) -> Void

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .opacity(configuration.isPressed ? opacityTo : 1)
      .scaleEffect(configuration.isPressed ? scaleTo : 1)
      .animation(
        .spring(response: 0.3, dampingFraction: 0.8),
        value: configuration.isPressed
      )
      .onChange(of: configuration.isPressed) { _, pressed in
        onPressState(pressed)
      }
  }
}
