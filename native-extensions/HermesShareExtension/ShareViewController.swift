import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private static let appGroup = "group.app.sunstone1029.fig1171.hermes"
  private static let key = "agent-trigger-inbox-v1"

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    consumeShareItem()
  }

  private func consumeShareItem() {
    let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
    let providers = items.flatMap { $0.attachments ?? [] }
    guard let provider = providers.first else {
      finish()
      return
    }
    let type = provider.hasItemConformingToTypeIdentifier(UTType.text.identifier)
      ? UTType.text.identifier
      : UTType.url.identifier
    provider.loadItem(forTypeIdentifier: type, options: nil) { [weak self] item, _ in
      let content: String?
      if let text = item as? String {
        content = text
      } else if let url = item as? URL {
        content = url.absoluteString
      } else if let data = item as? Data {
        content = String(data: data, encoding: .utf8)
      } else {
        content = nil
      }
      DispatchQueue.main.async {
        if let content {
          self?.enqueue(content: content)
        }
        self?.finish()
      }
    }
  }

  private func enqueue(content: String) {
    let normalized = content.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty, normalized.count <= 12_000 else { return }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    var entries = defaults.array(forKey: Self.key) as? [[String: Any]] ?? []
    entries.append([
      "content": normalized,
      "createdAt": Date().timeIntervalSince1970 * 1000,
      "kind": "analyze-text",
      "requestID": UUID().uuidString.lowercased(),
    ])
    defaults.set(Array(entries.suffix(50)), forKey: Self.key)
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil)
  }
}
