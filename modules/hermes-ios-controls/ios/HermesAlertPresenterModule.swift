import ExpoModulesCore
import SwiftUI

public final class HermesAlertPresenterModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesAlertPresenter")
    View(HermesAlertPresenterView.self)
  }
}

final class HermesAlertPresenterProps: ExpoSwiftUI.ViewProps {
  @Field var open = false
  @Field var overlayColor = "#00000099"
}

struct HermesAlertPresenterView: ExpoSwiftUI.View {
  @ObservedObject var props: HermesAlertPresenterProps
  @State private var isPresented: Bool
  @State private var appeared = false

  init(props: HermesAlertPresenterProps) {
    self.props = props
    self._isPresented = State(initialValue: props.open)
  }

  var body: some View {
    Color.clear
      .frame(width: 1, height: 1)
      .fullScreenCover(isPresented: $isPresented) {
        ZStack {
          Rectangle()
            .fill(.regularMaterial)
            .ignoresSafeArea()
          Color.hermes(props.overlayColor)
            .ignoresSafeArea()
          Children()
            .scaleEffect(appeared ? 1 : 0.95)
            .opacity(appeared ? 1 : 0)
        }
        .onAppear {
          appeared = false
          withAnimation(.spring(response: 0.3, dampingFraction: 0.82)) {
            appeared = true
          }
        }
      }
      .onChange(of: props.open) { next in
        if !next { appeared = false }
        isPresented = next
      }
  }
}
