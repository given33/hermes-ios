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

struct HermesAlertPresenterView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HermesAlertPresenterProps
  @State private var isPresented: Bool
  @State private var appeared = false
  @State private var dismissalTask: Task<Void, Never>?

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
        .interactiveDismissDisabled()
        .onAppear {
          dismissalTask?.cancel()
          appeared = false
          withAnimation(.spring(response: 0.3, dampingFraction: 0.82)) {
            appeared = true
          }
        }
      }
      .onChange(of: props.open) { _, next in
        dismissalTask?.cancel()
        if next {
          isPresented = true
          withAnimation(.spring(response: 0.3, dampingFraction: 0.82)) {
            appeared = true
          }
        } else {
          withAnimation(.easeOut(duration: 0.18)) {
            appeared = false
          }
          dismissalTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 180_000_000)
            guard !Task.isCancelled, !props.open else { return }
            isPresented = false
            dismissalTask = nil
          }
        }
      }
      .onDisappear { dismissalTask?.cancel() }
  }
}
