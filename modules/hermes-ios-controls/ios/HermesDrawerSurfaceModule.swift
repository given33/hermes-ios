import ExpoModulesCore
import SwiftUI

public final class HermesDrawerSurfaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesDrawerSurface")
    View(HermesDrawerSurfaceView.self)
  }
}

final class HermesDrawerSurfaceProps: ExpoSwiftUI.ViewProps {
  @Field var open = false
  @Field var width = 280.0
  @Field var overlayColor = "#00000066"

  var onRequestClose = EventDispatcher()
}

struct HermesDrawerSurfaceView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HermesDrawerSurfaceProps
  @State private var isOpen: Bool
  @GestureState private var dragTranslation: CGFloat = 0

  init(props: HermesDrawerSurfaceProps) {
    self.props = props
    self._isOpen = State(initialValue: props.open)
  }

  var body: some View {
    ZStack(alignment: .leading) {
      Color.hermes(props.overlayColor)
        .opacity(isOpen ? 1 : 0)
        .ignoresSafeArea()
        .contentShape(Rectangle())
        .onTapGesture { requestClose() }

      Children()
        .frame(width: CGFloat(props.width))
        .frame(maxHeight: .infinity)
        .offset(x: baseOffset + min(0, dragTranslation))
        .simultaneousGesture(
          DragGesture(minimumDistance: 8)
            .updating($dragTranslation) { value, state, _ in
              guard
                isOpen,
                abs(value.translation.width) > abs(value.translation.height)
              else { return }
              state = min(0, value.translation.width)
            }
            .onEnded { value in
              guard
                isOpen,
                abs(value.translation.width) > abs(value.translation.height)
              else { return }
              let projected = min(
                value.translation.width,
                value.predictedEndTranslation.width
              )
              if projected < -CGFloat(props.width) * 0.22 {
                requestClose()
              }
            }
        )
    }
    .allowsHitTesting(isOpen)
    .animation(.spring(response: 0.36, dampingFraction: 0.88), value: isOpen)
    .onChange(of: props.open) { _, next in isOpen = next }
  }

  private var baseOffset: CGFloat {
    isOpen ? 0 : -CGFloat(props.width)
  }

  private func requestClose() {
    guard isOpen else { return }
    isOpen = false
    props.onRequestClose()
  }
}
