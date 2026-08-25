import CryptoKit
import Darwin
import Foundation
import Security

enum HermesScreenTimeSpool {
  private static let appGroup = "group.app.sunstone1029.fig1171.hermes"
  private static let associatedData = Data("hermes-screen-time-v2".utf8)
  private static let maxChunksPerGeneration = 500
  private static let generationKey = "account-generation"
  private static let serverGenerationKey = "server-account-generation"

  static func captureGeneration() -> (lifecycleEpoch: Int, serverGeneration: String)? {
    let defaults = UserDefaults(suiteName: appGroup)
    let lifecycleEpoch = defaults?.integer(forKey: generationKey) ?? 0
    let serverGeneration = defaults?.string(forKey: serverGenerationKey)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard lifecycleEpoch > 0, !serverGeneration.isEmpty else { return nil }
    return (lifecycleEpoch, serverGeneration)
  }

  @discardableResult
  static func append(
    _ rawPayload: [String: Any],
    generation: (lifecycleEpoch: Int, serverGeneration: String)
  ) -> Bool {
    guard let key = sharedKey(),
          let directory = generationDirectory(generation, create: true),
          let sequence = allocateSequence(in: directory) else { return false }
    var payload = rawPayload
    payload["accountGeneration"] = generation.lifecycleEpoch
    payload["account_generation"] = generation.serverGeneration
    payload["sequence"] = sequence
    guard let eventID = payload["eventId"] as? String, !eventID.isEmpty,
          let clear = try? JSONSerialization.data(withJSONObject: payload),
          let sealed = try? AES.GCM.seal(clear, using: key, authenticating: associatedData),
          let combined = sealed.combined else { return false }
    let checksum = SHA256.hash(data: combined)
      .map { String(format: "%02x", $0) }
      .joined()
    let envelope: [String: Any] = [
      "checksum": checksum,
      "ciphertext": combined.base64EncodedString(),
      "event_id": eventID,
      "sequence": sequence,
      "version": 2,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: envelope) else { return false }
    let safeID = eventID.replacingOccurrences(
      of: "[^A-Za-z0-9._-]",
      with: "_",
      options: .regularExpression
    )
    let filename = String(format: "%020lld-%@.chunk", sequence, String(safeID.prefix(96)))
    let target = directory.appendingPathComponent(filename)
    do {
      try data.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      prune(directory)
      return true
    } catch {
      return false
    }
  }

  private static func prune(_ directory: URL, keep: Int = maxChunksPerGeneration) {
    guard
      let urls = try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
      )
    else { return }
    let chunks = urls
      .filter { $0.pathExtension == "chunk" }
      .sorted { $0.lastPathComponent > $1.lastPathComponent }
    for stale in chunks.dropFirst(max(0, keep)) {
      try? FileManager.default.removeItem(at: stale)
    }
  }

  private static func generationDirectory(
    _ generation: (lifecycleEpoch: Int, serverGeneration: String),
    create: Bool
  ) -> URL? {
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroup
    ) else { return nil }
    let digest = SHA256.hash(data: Data(generation.serverGeneration.utf8))
      .prefix(12)
      .map { String(format: "%02x", $0) }
      .joined()
    let directory = container
      .appendingPathComponent("HermesScreenTimeSpool", isDirectory: true)
      .appendingPathComponent("\(generation.lifecycleEpoch)-\(digest)", isDirectory: true)
    if create {
      try? FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
    }
    return directory
  }

  private static func allocateSequence(in directory: URL) -> Int64? {
    let url = directory.appendingPathComponent("sequence")
    let descriptor = Darwin.open(url.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { return nil }
    defer { Darwin.close(descriptor) }
    var fileLock = Darwin.flock()
    fileLock.l_type = Int16(F_WRLCK)
    fileLock.l_whence = Int16(SEEK_SET)
    guard Darwin.fcntl(descriptor, F_SETLKW, &fileLock) != -1 else { return nil }
    defer {
      fileLock.l_type = Int16(F_UNLCK)
      _ = Darwin.fcntl(descriptor, F_SETLK, &fileLock)
    }
    let current = (try? String(contentsOf: url, encoding: .utf8))
      .flatMap(Int64.init) ?? 0
    let next = current + 1
    let encoded = Data(String(next).utf8)
    guard Darwin.ftruncate(descriptor, 0) == 0,
          Darwin.lseek(descriptor, 0, SEEK_SET) >= 0 else { return nil }
    let written = encoded.withUnsafeBytes { buffer in
      Darwin.write(descriptor, buffer.baseAddress, buffer.count)
    }
    guard written == encoded.count, Darwin.fsync(descriptor) == 0 else { return nil }
    return next
  }

  private static func sharedKey() -> SymmetricKey? {
    guard let accessGroup = Bundle.main.object(
      forInfoDictionaryKey: "HermesSharedKeychainAccessGroup"
    ) as? String,
    !accessGroup.isEmpty,
    !accessGroup.contains("$(") else { return nil }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "app.hermes.screen-time",
      kSecAttrAccount as String: "shared-activity-key-v2",
      kSecAttrAccessGroup as String: accessGroup,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: true,
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data, data.count == 32 else { return nil }
    return SymmetricKey(data: data)
  }
}
