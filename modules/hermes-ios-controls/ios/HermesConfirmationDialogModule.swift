import ExpoModulesCore
import SwiftUI

public final class HermesConfirmationDialogModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesConfirmationDialog")
    View(HermesConfirmationDialogView.self)
  }
}

struct HermesConfirmationDialogAction: Record {
  @Field var id = ""
  @Field var title = ""
  @Field var destructive = false
}

final class HermesConfirmationDialogProps: ExpoSwiftUI.ViewProps {
  @Field var open = false
  @Field var title = ""
  @Field var cancelTitle = "Cancel"
  @Field var actions: [HermesConfirmationDialogAction] = []

  var onAction = EventDispatcher()
  var onOpenChange = EventDispatcher()
}

struct HermesConfirmationDialogView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: HermesConfirmationDialogProps
  @State private var isPresented: Bool

  init(props: HermesConfirmationDialogProps) {
    self.props = props
    self._isPresented = State(initialValue: props.open)
  }

  var body: some View {
    Color.clear
      .frame(width: 1, height: 1)
      .confirmationDialog(
        props.title,
        isPresented: $isPresented,
        titleVisibility: .visible
      ) {
        ForEach(props.actions.indices, id: \.self) { index in
          let action = props.actions[index]
          if action.destructive {
            SwiftUI.Button(action.title, role: .destructive) {
              props.onAction(["id": action.id])
            }
          } else {
            SwiftUI.Button(action.title) {
              props.onAction(["id": action.id])
            }
          }
        }
        SwiftUI.Button(props.cancelTitle, role: .cancel) {}
      }
      .onChange(of: props.open) { _, next in
        isPresented = next
      }
      .onChange(of: isPresented) { _, next in
        props.onOpenChange(["open": next])
      }
  }
}
