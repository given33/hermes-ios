import ExpoModulesCore

public final class HermesSwipeActionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSwipeActions")
    View(HermesSwipeActionsView.self)
  }
}
