import CryptoKit
import Foundation
import Security

final class HermesAttachmentVault {
  static let shared = HermesAttachmentVault()

  private static let envelopeMagic = Data("HATTV001".utf8)
  private static let keychainService = "app.hermes.attachment-vault.v1"
  private static let plaintextCacheDirectory = "hermes-attachment-plaintext-v1"
  private let keychainLock = NSLock()
  private let operationLock = NSLock()

  private init() {
    // Plaintext upload files are deliberately ephemeral. Remove anything left
    // by a process kill before accepting work in this app process.
    try? FileManager.default.removeItem(at: plaintextCacheRoot)
    // A failed migration is safe to retry on the next launch: the legacy
    // Documents root stays an accepted encrypt source until it drains.
    try? migrateLegacyOutbox()
  }

  func encrypt(owner: String, sourceURI: String, targetURI: String) throws -> [String: Any] {
    let normalizedOwner = try normalizeOwner(owner)
    operationLock.lock()
    defer { operationLock.unlock() }
    guard try !isRevoked(owner: normalizedOwner) else {
      throw HermesAttachmentVaultError.ownerRevoked
    }
    let source = try fileURL(sourceURI)
    let target = try fileURL(targetURI)
    try requireAllowedSource(source)
    try requireDescendant(target, of: encryptedOutboxRoot)
    guard source.standardizedFileURL != target.standardizedFileURL else {
      throw HermesAttachmentVaultError.invalidPath
    }

    let clear = try Data(contentsOf: source, options: [.mappedIfSafe])
    let sealed = try AES.GCM.seal(
      clear,
      using: try symmetricKey(owner: normalizedOwner),
      authenticating: associatedData(owner: normalizedOwner)
    )
    guard let combined = sealed.combined else {
      throw HermesAttachmentVaultError.invalidEnvelope
    }

    try FileManager.default.createDirectory(
      at: target.deletingLastPathComponent(),
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    var envelope = Self.envelopeMagic
    envelope.append(combined)
    do {
      try envelope.write(to: target, options: [.atomic, .completeFileProtection])
      try excludeFromBackup(target)
    } catch {
      try? FileManager.default.removeItem(at: target)
      throw error
    }
    return [
      "format": "aes-gcm-v1",
      "plaintextBytes": clear.count,
      "encryptedBytes": envelope.count,
    ]
  }

  func decryptForUpload(owner: String, encryptedURI: String, filename: String) throws -> String {
    let normalizedOwner = try normalizeOwner(owner)
    operationLock.lock()
    defer { operationLock.unlock() }
    guard try !isRevoked(owner: normalizedOwner) else {
      throw HermesAttachmentVaultError.ownerRevoked
    }
    let source = try fileURL(encryptedURI)
    try requireDescendant(source, of: encryptedOutboxRoot)
    let envelope = try Data(contentsOf: source, options: [.mappedIfSafe])
    guard envelope.count > Self.envelopeMagic.count,
          envelope.prefix(Self.envelopeMagic.count) == Self.envelopeMagic else {
      throw HermesAttachmentVaultError.invalidEnvelope
    }
    let combined = envelope.dropFirst(Self.envelopeMagic.count)
    let clear = try AES.GCM.open(
      AES.GCM.SealedBox(combined: combined),
      using: try symmetricKey(owner: normalizedOwner, create: false),
      authenticating: associatedData(owner: normalizedOwner)
    )

    let root = plaintextCacheRoot.appendingPathComponent(
      try keyAccount(owner: normalizedOwner),
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: root,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    let safeName = sanitizedFilename(filename)
    let target = root.appendingPathComponent("\(UUID().uuidString.lowercased())-\(safeName)")
    do {
      try clear.write(to: target, options: [.atomic, .completeFileProtection])
      try excludeFromBackup(target)
    } catch {
      try? FileManager.default.removeItem(at: target)
      throw error
    }
    return target.absoluteString
  }

  @discardableResult
  func deleteDecryptedFile(uri: String) throws -> Bool {
    let target = try fileURL(uri)
    try requireDescendant(target, of: plaintextCacheRoot)
    guard FileManager.default.fileExists(atPath: target.path) else { return false }
    try FileManager.default.removeItem(at: target)
    return true
  }

  @discardableResult
  func deleteKey(owner: String) throws -> Bool {
    let normalizedOwner = try normalizeOwner(owner)
    let account = try keyAccount(owner: normalizedOwner)
    operationLock.lock()
    defer { operationLock.unlock() }
    try markRevoked(owner: normalizedOwner)
    let ownerPlaintextCache = plaintextCacheRoot.appendingPathComponent(account, isDirectory: true)
    if FileManager.default.fileExists(atPath: ownerPlaintextCache.path) {
      try FileManager.default.removeItem(at: ownerPlaintextCache)
    }
    for outboxRoot in [encryptedOutboxRoot, legacyEncryptedOutboxRoot] {
      let ownerEncryptedOutbox = outboxRoot.appendingPathComponent(
        "owner-\(account)",
        isDirectory: true
      )
      if FileManager.default.fileExists(atPath: ownerEncryptedOutbox.path) {
        try FileManager.default.removeItem(at: ownerEncryptedOutbox)
      }
    }
    keychainLock.lock()
    defer { keychainLock.unlock() }
    let status = SecItemDelete(keySelector(account: account) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw HermesAttachmentVaultError.keychain(status)
    }
    return status == errSecSuccess
  }

  func activate(owner: String) throws {
    let normalizedOwner = try normalizeOwner(owner)
    let revokedAccount = try revocationAccount(owner: normalizedOwner)
    operationLock.lock()
    defer { operationLock.unlock() }
    keychainLock.lock()
    defer { keychainLock.unlock() }
    let status = SecItemDelete(keySelector(account: revokedAccount) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw HermesAttachmentVaultError.keychain(status)
    }
  }

  private var plaintextCacheRoot: URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent(Self.plaintextCacheDirectory, isDirectory: true)
  }

  private var encryptedOutboxRoot: URL {
    // Application Support is never listed by UIFileSharingEnabled, unlike
    // Documents, where the Files app would show (and let the user delete or
    // copy) every encrypted envelope in the outbox.
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("hermes-outbox", isDirectory: true)
  }

  private var legacyEncryptedOutboxRoot: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("hermes-outbox", isDirectory: true)
  }

  var outboxRootURI: String {
    encryptedOutboxRoot.absoluteString
  }

  // Attachment sources may only come from locations the app itself stages:
  // picker caches, the temporary directory, and outbox roots holding files
  // from builds that predate encryption. Encrypt-and-return on arbitrary
  // container paths would let hijacked JS exfiltrate any local file.
  private func requireAllowedSource(_ source: URL) throws {
    let allowedRoots = [
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0],
      URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true),
      encryptedOutboxRoot,
      legacyEncryptedOutboxRoot,
    ]
    guard allowedRoots.contains(where: { isDescendant(source, of: $0) }) else {
      throw HermesAttachmentVaultError.invalidPath
    }
  }

  // Builds before this one kept the encrypted outbox under Documents. Move it
  // once; entries already present at the new root were written by newer code
  // and win, merging per owner and per request directory.
  private func migrateLegacyOutbox() throws {
    let fileManager = FileManager.default
    guard fileManager.fileExists(atPath: legacyEncryptedOutboxRoot.path) else { return }
    try fileManager.createDirectory(
      at: encryptedOutboxRoot.deletingLastPathComponent(),
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    try mergeLegacyEntry(from: legacyEncryptedOutboxRoot, to: encryptedOutboxRoot, depth: 2)
  }

  private func mergeLegacyEntry(from source: URL, to target: URL, depth: Int) throws {
    let fileManager = FileManager.default
    guard fileManager.fileExists(atPath: target.path) else {
      try fileManager.moveItem(at: source, to: target)
      return
    }
    guard depth > 0 else { return }
    for name in try fileManager.contentsOfDirectory(atPath: source.path) {
      try? mergeLegacyEntry(
        from: source.appendingPathComponent(name),
        to: target.appendingPathComponent(name),
        depth: depth - 1
      )
    }
    if try fileManager.contentsOfDirectory(atPath: source.path).isEmpty {
      try fileManager.removeItem(at: source)
    }
  }

  private func normalizeOwner(_ owner: String) throws -> String {
    let normalized = owner.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !normalized.isEmpty else { throw HermesAttachmentVaultError.invalidOwner }
    return normalized
  }

  private func associatedData(owner: String) -> Data {
    Data("hermes-attachment-v1\0\(owner)".utf8)
  }

  private func keyAccount(owner: String) throws -> String {
    SHA256.hash(data: Data(owner.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func revocationAccount(owner: String) throws -> String {
    "revoked-\(try keyAccount(owner: owner))"
  }

  private func isRevoked(owner: String) throws -> Bool {
    let account = try revocationAccount(owner: owner)
    keychainLock.lock()
    defer { keychainLock.unlock() }
    return try readValue(account: account) != nil
  }

  private func markRevoked(owner: String) throws {
    let account = try revocationAccount(owner: owner)
    keychainLock.lock()
    defer { keychainLock.unlock() }
    if try readValue(account: account) != nil { return }
    var insert = keySelector(account: account)
    insert[kSecValueData as String] = Data([1])
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(insert as CFDictionary, nil)
    guard status == errSecSuccess || status == errSecDuplicateItem else {
      throw HermesAttachmentVaultError.keychain(status)
    }
  }

  private func symmetricKey(owner: String, create: Bool = true) throws -> SymmetricKey {
    let account = try keyAccount(owner: owner)
    keychainLock.lock()
    defer { keychainLock.unlock() }

    if let existing = try readKey(account: account) {
      return SymmetricKey(data: existing)
    }
    guard create else { throw HermesAttachmentVaultError.keyUnavailable }

    var keyData = Data(count: 32)
    let randomStatus = keyData.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, 32, buffer.baseAddress!)
    }
    guard randomStatus == errSecSuccess else {
      throw HermesAttachmentVaultError.keychain(randomStatus)
    }
    var insert = keySelector(account: account)
    insert[kSecValueData as String] = keyData
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let insertStatus = SecItemAdd(insert as CFDictionary, nil)
    if insertStatus == errSecDuplicateItem, let existing = try readKey(account: account) {
      return SymmetricKey(data: existing)
    }
    guard insertStatus == errSecSuccess else {
      throw HermesAttachmentVaultError.keychain(insertStatus)
    }
    return SymmetricKey(data: keyData)
  }

  private func readKey(account: String) throws -> Data? {
    guard let data = try readValue(account: account) else { return nil }
    guard data.count == 32 else { throw HermesAttachmentVaultError.invalidEnvelope }
    return data
  }

  private func readValue(account: String) throws -> Data? {
    var query = keySelector(account: account)
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    query[kSecReturnData as String] = true
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw HermesAttachmentVaultError.keychain(status)
    }
    return data
  }

  private func keySelector(account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.keychainService,
      kSecAttrAccount as String: account,
    ]
  }

  private func fileURL(_ raw: String) throws -> URL {
    guard let url = URL(string: raw), url.isFileURL else {
      throw HermesAttachmentVaultError.invalidPath
    }
    return url.standardizedFileURL
  }

  private func isDescendant(_ candidate: URL, of root: URL) -> Bool {
    // Resolve symlinks on both sides before comparing: iOS containers live
    // under /private/var while callers commonly hand over /var/... URIs, and
    // a symlink planted inside the tree must not smuggle a path outside it.
    // Component comparison also avoids "/rootX" matching a "/root" prefix.
    let rootComponents = root.standardizedFileURL.resolvingSymlinksInPath().pathComponents
    let candidateComponents = candidate.standardizedFileURL.resolvingSymlinksInPath().pathComponents
    return candidateComponents.count > rootComponents.count
      && Array(candidateComponents.prefix(rootComponents.count)) == rootComponents
  }

  private func requireDescendant(_ candidate: URL, of root: URL) throws {
    guard isDescendant(candidate, of: root) else {
      throw HermesAttachmentVaultError.invalidPath
    }
  }

  private func sanitizedFilename(_ filename: String) -> String {
    let last = (filename as NSString).lastPathComponent
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
    let safe = last.unicodeScalars.map { allowed.contains($0) ? String($0) : "_" }.joined()
    return String((safe.isEmpty ? "attachment" : safe).prefix(160))
  }

  private func excludeFromBackup(_ url: URL) throws {
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var mutableURL = url
    try mutableURL.setResourceValues(values)
  }
}

private enum HermesAttachmentVaultError: Error {
  case invalidEnvelope
  case invalidOwner
  case invalidPath
  case keyUnavailable
  case keychain(OSStatus)
  case ownerRevoked
}
