import ExpoModulesCore
import QuickLook
import UIKit

public final class HermesQuickLookModule: Module {
  private var dataSource: HermesQuickLookDataSource?

  public func definition() -> ModuleDefinition {
    Name("HermesQuickLook")

    AsyncFunction("present") { (uri: URL, title: String?, promise: Promise) in
      guard uri.isFileURL,
            FileManager.default.fileExists(atPath: uri.path),
            let presenter = Self.topViewController(),
            self.dataSource == nil else {
        promise.resolve(false)
        return
      }

      let source = HermesQuickLookDataSource(url: uri, title: title) { [weak self] in
        self?.dataSource = nil
        promise.resolve(true)
      }
      let preview = QLPreviewController()
      preview.dataSource = source
      preview.delegate = source
      self.dataSource = source
      presenter.present(preview, animated: true) { [weak self] in
        // UIKit silently drops a present that collides with another
        // transition (confirm dialog dismissing, share sheet collapsing).
        // Without this check the dismiss callback never fired, the promise
        // hung open, the caller's `finally { delete plaintext }` never ran
        // (decrypted file stayed on disk), and dataSource stayed occupied
        // so every later preview resolved false until restart.
        if presenter.presentedViewController !== preview {
          self?.dataSource = nil
          source.cancel()
          promise.resolve(false)
        }
      }
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

private final class HermesQuickLookDataSource: NSObject,
  QLPreviewControllerDataSource,
  QLPreviewControllerDelegate {
  private let item: HermesQuickLookItem
  private var onDismiss: (() -> Void)?

  init(url: URL, title: String?, onDismiss: @escaping () -> Void) {
    item = HermesQuickLookItem(url: url, title: title)
    self.onDismiss = onDismiss
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

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    let completion = onDismiss
    onDismiss = nil
    completion?()
  }

  /// Presentation failed after the fact: drop the pending callback so a
  /// stray dismissal of some other controller can never resolve the
  /// already-failed promise a second time.
  func cancel() {
    onDismiss = nil
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
