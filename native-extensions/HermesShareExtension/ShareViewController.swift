import CryptoKit
import Foundation
import Security
import UIKit
import UniformTypeIdentifiers

/// Cipher shared with the main app's HermesIntentQueueCipher. The key lives
/// in the shared Keychain access group when the entitlement is present and
/// is mirrored into the plain (no access group) item so resign-compatible
/// builds — where one side may lack the group entitlement — still decrypt
/// each other's payloads.
private enum HermesShareQueueCipher {
  private static let service = "app.hermes.intent-queue"
  private static let account = "payload-key-v1"

  static func seal(_ entry: [String: Any]) -> Data? {
    guard JSONSerialization.isValidJSONObject(entry),
          let clear = try? JSONSerialization.data(withJSONObject: entry),
          let encrypted = try? AES.GCM.seal(clear, using: key()),
          let combined = encrypted.combined else { return nil }
    return combined
  }

  private static func key() -> SymmetricKey {
    if let existing = readKey(), existing.count == 32 {
      return SymmetricKey(data: existing)
    }
    var bytes = Data(count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, 32, &bytes) == errSecSuccess else {
      return SymmetricKey(data: Data(repeating: 0, count: 32))
    }
    var insertedGroup = false
    if let accessGroup = sharedAccessGroup() {
      var insert = selector(accessGroup: accessGroup)
      insert[kSecValueData as String] = bytes
      insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let status = SecItemAdd(insert as CFDictionary, nil)
      insertedGroup = status == errSecSuccess
        || status == errSecDuplicateItem
    }
    // Mirror the same bytes into the plain item so a process without the
    // group entitlement can still open envelopes sealed here.
    var plain = selector(accessGroup: nil)
    plain[kSecValueData as String] = bytes
    plain[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(plain as CFDictionary, nil)
    if let existing = readKey(), existing.count == 32 {
      return SymmetricKey(data: existing)
    }
    _ = insertedGroup
    return SymmetricKey(data: bytes)
  }

  private static func readKey() -> Data? {
    for accessGroup in [sharedAccessGroup(), nil] {
      var query = selector(accessGroup: accessGroup)
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      query[kSecReturnData as String] = true
      var result: CFTypeRef?
      if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
         let data = result as? Data, data.count == 32 {
        return data
      }
    }
    return nil
  }

  private static func selector(accessGroup: String?) -> [String: Any] {
    var selector: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    if let accessGroup, !accessGroup.isEmpty, !accessGroup.contains("$(") {
      selector[kSecAttrAccessGroup as String] = accessGroup
    }
    return selector
  }

  private static func sharedAccessGroup() -> String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: "HermesSharedKeychainAccessGroup") as? String,
          !value.isEmpty,
          !value.contains("$(") else { return nil }
    return value
  }
}

final class ShareViewController: UIViewController {
  private static let appGroup = "group.app.sunstone1029.fig1171.hermes"
  private static let attachmentsDirectory = "agent-share-attachments-v1"
  // Each share becomes one individually sealed spool file. Append-only file
  // creation replaces the legacy read-modify-write UserDefaults array, so the
  // extension, App Intents, and the main app can enqueue concurrently without
  // any cross-process lock; the main app binds and consumes files on drain.
  private static let spoolDirectory = "agent-trigger-inbox-v3"
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
        } else if let filename = entry?["attachmentPath"] as? String, let root {
          // A rejected attachment has already been copied out of the
          // provider's temporary sandbox. Remove it immediately so repeated
          // oversized shares cannot fill the App Group container.
          try? FileManager.default.removeItem(at: root.appendingPathComponent(filename))
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
    provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { temporaryURL, _ in
      guard let temporaryURL, let root else { completion(nil, 0); return }
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
    let text = entries.compactMap { $0["content"] as? String }.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    let attachments = entries.filter { ($0["kind"] as? String) == "attachment" }
    let merged: [String: Any] = [
      "content": String(text.prefix(20_000)),
      "kind": "analyze-text",
      "requestID": UUID().uuidString.lowercased(),
      "createdAt": Date().timeIntervalSince1970 * 1000,
      "attachments": attachments,
    ]
    guard let envelope = HermesShareQueueCipher.seal(merged),
          let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup) else { return }
    let spool = group.appendingPathComponent(Self.spoolDirectory, isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: spool, withIntermediateDirectories: true)
      // One sealed file per request; a unique name plus the atomic write
      // make concurrent producers safe without any shared mutable state.
      let target = spool.appendingPathComponent("\(UUID().uuidString.lowercased()).bin")
      try envelope.write(to: target, options: [.atomic])
    } catch {
      // A failed spool write drops this share request rather than falling
      // back to the plaintext legacy key: silently downgrading the queue's
      // confidentiality is never the right recovery.
    }
  }
}
