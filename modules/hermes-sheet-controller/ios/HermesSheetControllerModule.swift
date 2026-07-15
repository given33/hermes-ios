import ExpoModulesCore
import UIKit

public final class HermesSheetControllerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HermesSheetController")

    AsyncFunction("configure") { () -> Bool in
      guard
        let controller = Self.topViewController(),
        let sheet = controller.sheetPresentationController
      else {
        return false
      }

      sheet.detents = [.medium(), .large()]
      sheet.prefersGrabberVisible = true
      sheet.prefersScrollingExpandsWhenScrolledToEdge = true
      sheet.preferredCornerRadius = 18
      sheet.animateChanges {
        if sheet.selectedDetentIdentifier == nil {
          sheet.selectedDetentIdentifier = .large
        }
      }
      return true
    }.runOnQueue(.main)
  }

  private static func topViewController(
    from root: UIViewController? = activeWindow()?.rootViewController
  ) -> UIViewController? {
    if let presented = root?.presentedViewController {
      return topViewController(from: presented)
    }
    if let navigation = root as? UINavigationController {
      return topViewController(from: navigation.visibleViewController)
    }
    if let tabs = root as? UITabBarController {
      return topViewController(from: tabs.selectedViewController)
    }
    return root
  }

  private static func activeWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow }
  }
}
