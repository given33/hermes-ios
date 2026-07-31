import Foundation
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private static let appGroup = "group.app.sunstone1029.fig1171.hermes"
  private static let key = "agent-trigger-inbox-v1"
  private static let attachmentsDirectory = "agent-share-attachments-v1"
  private static let maxItems = 20
  private static let maxBytes = 50 * 1024 * 1024

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    process()
  }

  private func process() {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)
    let root = group?.appendingPathComponent(Self.attachmentsDirectory, isDirectory: true)
    if let root { try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true) }
    let work = DispatchGroup()
    let lock = NSLock()
    var entries: [[String: Any]] = []
    var totalBytes = 0
    for provider in providers.prefix(Self.maxItems) {
      work.enter()
      load(provider: provider, root: root) { entry, bytes in
        lock.lock(); defer { lock.unlock() }
        if let entry, entries.count < Self.maxItems, totalBytes + bytes <= Self.maxBytes {
          entries.append(entry); totalBytes += bytes
        }
        work.leave()
      }
    }
    work.notify(queue: .main) { [weak self] in
      self?.enqueue(entries: entries)
      self?.extensionContext?.completeRequest(returningItems: nil)
    }
  }

  private func load(provider: NSItemProvider, root: URL?, completion: @escaping ([String: Any]?, Int) -> Void) {
    let requestID = UUID().uuidString.lowercased()
    if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      provider.loadDataRepresentation(forTypeIdentifier: UTType.plainText.identifier) { data, _ in
        let text = data.flatMap { String(data: $0, encoding: .utf8) }?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        completion(text.isEmpty ? nil : ["content": String(text.prefix(20_000)), "kind": "analyze-text", "requestID": requestID, "createdAt": Date().timeIntervalSince1970 * 1000], text.utf8.count)
      }
      return
    }
    if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
        let url = (item as? URL)?.absoluteString ?? (item as? String) ?? ""
        completion(url.isEmpty ? nil : ["content": String(url.prefix(8_000)), "kind": "analyze-text", "requestID": requestID, "createdAt": Date().timeIntervalSince1970 * 1000], url.utf8.count)
      }
      return
    }
    let type: UTType = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) ? .url : provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) ? .image : provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) ? .movie : .item
    provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { [weak self] temporaryURL, _ in
      guard let self, let temporaryURL, let root else { completion(nil, 0); return }
      let accessed = temporaryURL.startAccessingSecurityScopedResource()
      defer { if accessed { temporaryURL.stopAccessingSecurityScopedResource() } }
      guard let values = try? temporaryURL.resourceValues(forKeys: [.fileSizeKey]), let size = values.fileSize, size <= Self.maxBytes else { completion(nil, 0); return }
      let safeName = temporaryURL.lastPathComponent.replacingOccurrences(of: "/", with: "_").prefix(120)
      let filename = "\(requestID)-\(safeName.isEmpty ? "attachment" : String(safeName))"
      let destination = root.appendingPathComponent(filename)
      do {
        try FileManager.default.copyItem(at: temporaryURL, to: destination)
        completion(["attachmentID": requestID, "attachmentPath": filename, "filename": String(safeName), "kind": "attachment", "requestID": requestID, "createdAt": Date().timeIntervalSince1970 * 1000], size)
      } catch { completion(nil, 0) }
    }
  }

  private func enqueue(entries: [[String: Any]]) {
    guard !entries.isEmpty else { return }
    let defaults = UserDefaults(suiteName: Self.appGroup) ?? .standard
    let old = defaults.array(forKey: Self.key) as? [[String: Any]] ?? []
    let text = entries.compactMap { $0["content"] as? String }.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    let attachments = entries.filter { ($0["kind"] as? String) == "attachment" }
    let merged: [String: Any] = [
      "content": String(text.prefix(20_000)),
      "kind": "analyze-text",
      "requestID": UUID().uuidString.lowercased(),
      "createdAt": Date().timeIntervalSince1970 * 1000,
      "attachments": attachments,
    ]
    defaults.set(Array((old + [merged]).suffix(100)), forKey: Self.key)
    defaults.synchronize()
  }
}
