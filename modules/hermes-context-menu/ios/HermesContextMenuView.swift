import ExpoModulesCore
import UIKit

struct HermesContextMenuAction: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var systemImage: String?
  @Field var destructive: Bool = false
}

final class HermesContextMenuView: ExpoView, UIContextMenuInteractionDelegate {
  let onMenuAction = EventDispatcher()
  var actions: [HermesContextMenuAction] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    addInteraction(UIContextMenuInteraction(delegate: self))
  }

  func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    guard !actions.isEmpty else { return nil }
    return UIContextMenuConfiguration(
      identifier: nil,
      previewProvider: nil
    ) { [weak self] _ in
      guard let self else { return nil }
      let children = self.actions.map { action in
        UIAction(
          title: action.title,
          image: action.systemImage.flatMap(UIImage.init(systemName:)),
          attributes: action.destructive ? .destructive : []
        ) { [weak self] _ in
          self?.onMenuAction(["id": action.id])
        }
      }
      return UIMenu(children: children)
    }
  }
}
