import ExpoModulesCore

public final class HermesSwipeActionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSwipeActions")

    View(HermesSwipeActionsView.self) {
      Events("onAction")

      Prop("actions") { (view, actions: [HermesSwipeActionRecord]) in
        view.actions = actions
      }

      Prop("fullSwipeEnabled") { (view, enabled: Bool) in
        view.fullSwipeEnabled = enabled
      }
    }
  }
}
