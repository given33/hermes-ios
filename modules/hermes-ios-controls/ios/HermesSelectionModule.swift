import ExpoModulesCore
import SwiftUI

public final class HermesSelectionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSelection")
    View(HermesSelectionView.self)
  }
}

final class HermesSelectionProps: ExpoSwiftUI.ViewProps {
  @Field var selected = false
  @Field var selectedBackgroundColor = "#00000000"
  @Field var unselectedBackgroundColor = "#00000000"
  @Field var selectedBorderColor = "#007aff"
  @Field var unselectedBorderColor = "#8e8e93"
  @Field var checkmarkBackgroundColor = "#007aff"
  @Field var checkmarkTintColor = "#ffffff"
  @Field var borderWidth = 1.0
  @Field var cornerRadius = 0.0
}

struct HermesSelectionView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HermesSelectionProps

  var body: some View {
    ZStack(alignment: .trailing) {
      RoundedRectangle(cornerRadius: props.cornerRadius, style: .continuous)
        .fill(Color.hermes(
          props.selected
            ? props.selectedBackgroundColor
            : props.unselectedBackgroundColor
        ))
        .overlay {
          RoundedRectangle(cornerRadius: props.cornerRadius, style: .continuous)
            .stroke(
              Color.hermes(
                props.selected
                  ? props.selectedBorderColor
                  : props.unselectedBorderColor
              ),
              lineWidth: props.borderWidth
            )
        }

      Children()

      Image(systemName: "checkmark")
        .font(.system(size: 10, weight: .bold))
        .foregroundStyle(Color.hermes(props.checkmarkTintColor))
        .frame(width: 20, height: 20)
        .background(Color.hermes(props.checkmarkBackgroundColor))
        .clipShape(Circle())
        .scaleEffect(props.selected ? 1 : 0.72)
        .opacity(props.selected ? 1 : 0)
        .padding(.trailing, 12)
    }
    .clipShape(RoundedRectangle(cornerRadius: props.cornerRadius, style: .continuous))
    .animation(
      .spring(response: 0.34, dampingFraction: 0.82),
      value: props.selected
    )
  }
}
