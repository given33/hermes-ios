import ExpoModulesCore
import QuickLook
import UIKit

public final class HermesQuickLookModule: Module {
  private var dataSource: HermesQuickLookDataSource?

  public func definition() -> ModuleDefinition {
    Name("HermesQuickLook")

    AsyncFunction("present") { (uri: URL, title: String?) -> Bool in
      guard uri.isFileURL,
            FileManager.default.fileExists(atPath: uri.path),
            let presenter = Self.topViewController() else {
        return false
      }

      let source = HermesQuickLookDataSource(url: uri, title: title)
      let preview = QLPreviewController()
      preview.dataSource = source
      self.dataSource = source
      presenter.present(preview, animated: true)
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

private final class HermesQuickLookDataSource: NSObject, QLPreviewControllerDataSource {
  private let item: HermesQuickLookItem

  init(url: URL, title: String?) {
    item = HermesQuickLookItem(url: url, title: title)
    super.init()
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
    1
  }

  func previewController(
    _ controller: QLPreviewController,
    previewItemAt index: Int
  ) -> QLPreviewItem {
    item
  }
}

private final class HermesQuickLookItem: NSObject, QLPreviewItem {
  let previewItemURL: URL?
  let previewItemTitle: String?

  init(url: URL, title: String?) {
    previewItemURL = url
    previewItemTitle = title
    super.init()
  }
}
