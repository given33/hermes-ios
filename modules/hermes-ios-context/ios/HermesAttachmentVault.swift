import CryptoKit
import Foundation
import Security

final class HermesAttachmentVault {
  static let shared = HermesAttachmentVault()

  private static let legacyEnvelopeMagic = Data("HATTV001".utf8)
  private static let chunkedEnvelopeMagic = Data("HATTV002".utf8)
  private static let maximumPlaintextBytes: UInt64 = 64 * 1024 * 1024
  private static let chunkBytes = 256 * 1024
  private static let chunkedHeaderBytes = 8 + 8 + 4 + 4 + 32
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
    let ownerToken = try requireCurrentOwner(normalizedOwner)
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

    let plaintextBytes = try fileSize(source)
    guard plaintextBytes <= Self.maximumPlaintextBytes else {
      throw HermesAttachmentVaultError.fileTooLarge
    }
    try FileManager.default.createDirectory(
      at: target.deletingLastPathComponent(),
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    let temporary = target.deletingLastPathComponent().appendingPathComponent(
      ".\(target.lastPathComponent).\(UUID().uuidString.lowercased()).tmp"
    )
    let expectedChunks = plaintextBytes == 0
      ? 0
      : Int((plaintextBytes + UInt64(Self.chunkBytes) - 1) / UInt64(Self.chunkBytes))
    let key = try symmetricKey(owner: normalizedOwner)
    let input = try FileHandle(forReadingFrom: source)
    guard FileManager.default.createFile(
      atPath: temporary.path,
      contents: nil,
      attributes: [.protectionKey: FileProtectionType.complete]
    ) else {
      try? input.close()
      throw HermesAttachmentVaultError.invalidPath
    }
    let output = try FileHandle(forWritingTo: temporary)
    var hasher = SHA256()
    var plaintextDigest = Data()
    var processed: UInt64 = 0
    var chunkIndex = 0
    do {
      try output.write(contentsOf: Self.chunkedEnvelopeMagic)
      try output.write(contentsOf: uint64Data(plaintextBytes))
      try output.write(contentsOf: uint32Data(UInt32(Self.chunkBytes)))
      try output.write(contentsOf: uint32Data(UInt32(expectedChunks)))
      try output.write(contentsOf: Data(repeating: 0, count: 32))
      while let clear = try input.read(upToCount: Self.chunkBytes), !clear.isEmpty {
        guard HermesContextEventQueue.shared.isCurrentCollectorGenerationToken(ownerToken) else {
          throw HermesAttachmentVaultError.staleOwner
        }
        processed += UInt64(clear.count)
        guard processed <= plaintextBytes, chunkIndex < expectedChunks else {
          throw HermesAttachmentVaultError.invalidEnvelope
        }
        hasher.update(data: clear)
        let sealed = try AES.GCM.seal(
          clear,
          using: key,
          authenticating: chunkAssociatedData(
            owner: normalizedOwner,
            plaintextBytes: plaintextBytes,
            chunkIndex: chunkIndex,
            chunkBytes: clear.count
          )
        )
        guard let combined = sealed.combined else {
          throw HermesAttachmentVaultError.invalidEnvelope
        }
        try output.write(contentsOf: uint32Data(UInt32(combined.count)))
        try output.write(contentsOf: combined)
        chunkIndex += 1
      }
      guard processed == plaintextBytes,
            chunkIndex == expectedChunks,
            HermesContextEventQueue.shared.isCurrentCollectorGenerationToken(ownerToken) else {
        throw HermesAttachmentVaultError.staleOwner
      }
      plaintextDigest = Data(hasher.finalize())
      try output.seek(toOffset: UInt64(Self.chunkedHeaderBytes - 32))
      try output.write(contentsOf: plaintextDigest)
      try output.synchronize()
      try input.close()
      try output.close()
      try excludeFromBackup(temporary)
      try installAtomically(temporary, at: target)
    } catch {
      try? input.close()
      try? output.close()
      try? FileManager.default.removeItem(at: temporary)
      throw error
    }
    return [
      "format": "aes-gcm-chunked-v2",
      "plaintextBytes": Int(plaintextBytes),
      "encryptedBytes": Int(try fileSize(target)),
      "sha256": hexDigest(plaintextDigest),
    ]
  }

  func decryptForUpload(owner: String, encryptedURI: String, filename: String) throws -> String {
    let normalizedOwner = try normalizeOwner(owner)
    operationLock.lock()
    defer { operationLock.unlock() }
    let ownerToken = try requireCurrentOwner(normalizedOwner)
    guard try !isRevoked(owner: normalizedOwner) else {
      throw HermesAttachmentVaultError.ownerRevoked
    }
    let source = try fileURL(encryptedURI)
    try requireDescendant(source, of: encryptedOutboxRoot)
    let encryptedBytes = try fileSize(source)
    let maximumEnvelopeBytes = Self.maximumPlaintextBytes
      + UInt64(Self.maximumPlaintextBytes / UInt64(Self.chunkBytes) + 1) * 64
      + UInt64(Self.chunkedHeaderBytes)
    guard encryptedBytes <= maximumEnvelopeBytes else {
      throw HermesAttachmentVaultError.fileTooLarge
    }
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
    let temporary = root.appendingPathComponent(".\(UUID().uuidString.lowercased()).tmp")
    do {
      let input = try FileHandle(forReadingFrom: source)
      let magic = try readExactly(input, count: 8)
      try input.close()
      if magic == Self.chunkedEnvelopeMagic {
        try decryptChunked(
          owner: normalizedOwner,
          ownerToken: ownerToken,
          source: source,
          target: temporary
        )
      } else if magic == Self.legacyEnvelopeMagic {
        try decryptLegacy(owner: normalizedOwner, source: source, target: temporary)
      } else {
        throw HermesAttachmentVaultError.invalidEnvelope
      }
      guard HermesContextEventQueue.shared.isCurrentCollectorGenerationToken(ownerToken) else {
        throw HermesAttachmentVaultError.staleOwner
      }
      try excludeFromBackup(temporary)
      try installAtomically(temporary, at: target)
    } catch {
      try? FileManager.default.removeItem(at: temporary)
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
    _ = try requireCurrentOwner(normalizedOwner)
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

  private func chunkAssociatedData(
    owner: String,
    plaintextBytes: UInt64,
    chunkIndex: Int,
    chunkBytes: Int
  ) -> Data {
    var data = Data("hermes-attachment-v2\0\(owner)".utf8)
    data.append(uint64Data(plaintextBytes))
    data.append(uint32Data(UInt32(chunkIndex)))
    data.append(uint32Data(UInt32(chunkBytes)))
    return data
  }

  private func requireCurrentOwner(_ owner: String) throws -> HermesCollectorGenerationToken {
    guard let token = HermesContextEventQueue.shared.currentCollectorGenerationToken(),
          token.ownerScope.lowercased() == owner else {
      throw HermesAttachmentVaultError.staleOwner
    }
    return token
  }

  private func decryptChunked(
    owner: String,
    ownerToken: HermesCollectorGenerationToken,
    source: URL,
    target: URL
  ) throws {
    let input = try FileHandle(forReadingFrom: source)
    guard FileManager.default.createFile(
      atPath: target.path,
      contents: nil,
      attributes: [.protectionKey: FileProtectionType.complete]
    ) else {
      try? input.close()
      throw HermesAttachmentVaultError.invalidPath
    }
    let output = try FileHandle(forWritingTo: target)
    do {
      guard try readExactly(input, count: 8) == Self.chunkedEnvelopeMagic else {
        throw HermesAttachmentVaultError.invalidEnvelope
      }
      let plaintextBytes = uint64Value(try readExactly(input, count: 8))
      let chunkBytes = Int(uint32Value(try readExactly(input, count: 4)))
      let chunkCount = Int(uint32Value(try readExactly(input, count: 4)))
      let expectedDigest = try readExactly(input, count: 32)
      guard plaintextBytes <= Self.maximumPlaintextBytes,
            chunkBytes > 0,
            chunkBytes <= 1024 * 1024 else {
        throw HermesAttachmentVaultError.invalidEnvelope
      }
      let expectedChunks = plaintextBytes == 0
        ? 0
        : Int((plaintextBytes + UInt64(chunkBytes) - 1) / UInt64(chunkBytes))
      guard chunkCount == expectedChunks else {
        throw HermesAttachmentVaultError.invalidEnvelope
      }
      let key = try symmetricKey(owner: owner, create: false)
      var hasher = SHA256()
      var written: UInt64 = 0
      for chunkIndex in 0..<chunkCount {
        guard HermesContextEventQueue.shared.isCurrentCollectorGenerationToken(ownerToken) else {
          throw HermesAttachmentVaultError.staleOwner
        }
        let combinedBytes = Int(uint32Value(try readExactly(input, count: 4)))
        let expectedClearBytes = Int(min(UInt64(chunkBytes), plaintextBytes - written))
        guard combinedBytes == expectedClearBytes + 28 else {
          throw HermesAttachmentVaultError.invalidEnvelope
        }
        let combined = try readExactly(input, count: combinedBytes)
        let clear = try AES.GCM.open(
          AES.GCM.SealedBox(combined: combined),
          using: key,
          authenticating: chunkAssociatedData(
            owner: owner,
            plaintextBytes: plaintextBytes,
            chunkIndex: chunkIndex,
            chunkBytes: expectedClearBytes
          )
        )
        guard clear.count == expectedClearBytes else {
          throw HermesAttachmentVaultError.invalidEnvelope
        }
        hasher.update(data: clear)
        try output.write(contentsOf: clear)
        written += UInt64(clear.count)
      }
      let trailing = try input.read(upToCount: 1)
      guard written == plaintextBytes,
            trailing == nil || trailing?.isEmpty == true,
            Data(hasher.finalize()) == expectedDigest else {
        throw HermesAttachmentVaultError.invalidEnvelope
      }
      try output.synchronize()
      try input.close()
      try output.close()
    } catch {
      try? input.close()
      try? output.close()
      throw error
    }
  }

  private func decryptLegacy(owner: String, source: URL, target: URL) throws {
    let envelope = try Data(contentsOf: source, options: [.mappedIfSafe])
    guard envelope.count > Self.legacyEnvelopeMagic.count,
          envelope.prefix(Self.legacyEnvelopeMagic.count) == Self.legacyEnvelopeMagic else {
      throw HermesAttachmentVaultError.invalidEnvelope
    }
    let clear = try AES.GCM.open(
      AES.GCM.SealedBox(combined: envelope.dropFirst(Self.legacyEnvelopeMagic.count)),
      using: try symmetricKey(owner: owner, create: false),
      authenticating: associatedData(owner: owner)
    )
    guard UInt64(clear.count) <= Self.maximumPlaintextBytes else {
      throw HermesAttachmentVaultError.fileTooLarge
    }
    try clear.write(to: target, options: [.atomic, .completeFileProtection])
  }

  private func fileSize(_ url: URL) throws -> UInt64 {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard let number = attributes[.size] as? NSNumber else {
      throw HermesAttachmentVaultError.invalidPath
    }
    return number.uint64Value
  }

  private func installAtomically(_ temporary: URL, at target: URL) throws {
    if FileManager.default.fileExists(atPath: target.path) {
      _ = try FileManager.default.replaceItemAt(target, withItemAt: temporary)
    } else {
      try FileManager.default.moveItem(at: temporary, to: target)
    }
  }

  private func readExactly(_ handle: FileHandle, count: Int) throws -> Data {
    guard count >= 0 else { throw HermesAttachmentVaultError.invalidEnvelope }
    var result = Data()
    result.reserveCapacity(count)
    while result.count < count {
      guard let part = try handle.read(upToCount: count - result.count), !part.isEmpty else {
        throw HermesAttachmentVaultError.invalidEnvelope
      }
      result.append(part)
    }
    return result
  }

  private func uint32Data(_ value: UInt32) -> Data {
    var bigEndian = value.bigEndian
    return withUnsafeBytes(of: &bigEndian) { Data($0) }
  }

  private func uint64Data(_ value: UInt64) -> Data {
    var bigEndian = value.bigEndian
    return withUnsafeBytes(of: &bigEndian) { Data($0) }
  }

  private func uint32Value(_ data: Data) -> UInt32 {
    data.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
  }

  private func uint64Value(_ data: Data) -> UInt64 {
    data.reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
  }

  private func hexDigest(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
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
  case fileTooLarge
  case invalidEnvelope
  case invalidOwner
  case invalidPath
  case keyUnavailable
  case keychain(OSStatus)
  case ownerRevoked
  case staleOwner
}
