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

  var onRequestClose = EventDispatcher()
}

struct HermesDrawerSurfaceView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesDrawerSurfaceProps
  @State private var isOpen: Bool
  @GestureState private var dragTranslation: CGFloat = 0

  init(props: HermesDrawerSurfaceProps) {
    self.props = props
    self._isOpen = State(initialValue: props.open)
  }

  var body: some View {
    Children()
      .frame(width: CGFloat(props.width))
      .offset(x: baseOffset + min(0, dragTranslation))
      .animation(
        .spring(response: 0.36, dampingFraction: 0.88),
        value: isOpen
      )
      .gesture(
        DragGesture(minimumDistance: 8)
          .updating($dragTranslation) { value, state, _ in
            guard isOpen else { return }
            state = value.translation.width
          }
          .onEnded { value in
            guard isOpen else { return }
            let projected = value.predictedEndTranslation.width
            if min(value.translation.width, projected) < -CGFloat(props.width) * 0.22 {
              props.onRequestClose()
            }
          }
      )
      .onChange(of: props.open) { _, next in
        isOpen = next
      }
  }

  private var baseOffset: CGFloat {
    isOpen ? 0 : -CGFloat(props.width)
  }
}
