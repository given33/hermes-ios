import ExpoModulesCore

public final class HermesContextMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesContextMenu")

    View(HermesContextMenuView.self) {
      Events("onMenuAction")

      Prop("actions") { (view, actions: [HermesContextMenuAction]) in
        view.actions = actions
      }
    }
  }
}
