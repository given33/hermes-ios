import CryptoKit
import Foundation

struct HermesScreenTimeSpoolRecord {
  let identity: String
  let payload: [String: Any]
  let sequence: Int64
  let url: URL
}

enum HermesScreenTimeSpool {
  private static let appGroup = "group.app.sunstone1029.fig1171.hermes"

  static func records(
    lifecycleEpoch: Int,
    serverGeneration: String
  ) -> [HermesScreenTimeSpoolRecord] {
    guard lifecycleEpoch > 0,
          !serverGeneration.isEmpty,
          let directory = generationDirectory(
            lifecycleEpoch: lifecycleEpoch,
            serverGeneration: serverGeneration
          ),
          let urls = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
          ) else { return [] }
    let resolvedDirectory = directory.resolvingSymlinksInPath().standardizedFileURL
    return urls.compactMap { url in
      guard url.pathExtension == "chunk",
            url.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL
              == resolvedDirectory,
            let values = try? url.resourceValues(
              forKeys: [.isRegularFileKey, .isSymbolicLinkKey]
            ),
            values.isRegularFile == true,
            values.isSymbolicLink != true,
            let data = try? Data(contentsOf: url),
            let object = try? JSONSerialization.jsonObject(with: data),
            let envelope = object as? [String: Any],
            (envelope["version"] as? NSNumber)?.intValue == 2,
            let ciphertext = envelope["ciphertext"] as? String,
            let combined = Data(base64Encoded: ciphertext),
            let checksum = envelope["checksum"] as? String,
            checksum == digest(combined),
            let sequence = (envelope["sequence"] as? NSNumber)?.int64Value,
            sequence > 0,
            let eventID = envelope["event_id"] as? String,
            !eventID.isEmpty,
            let payload = HermesScreenTimeCrypto.open(combined),
            HermesScreenTimeService.generation(of: payload) == lifecycleEpoch,
            HermesScreenTimeService.serverGeneration(of: payload) == serverGeneration,
            (payload["sequence"] as? NSNumber)?.int64Value == sequence,
            payload["eventId"] as? String == eventID else { return nil }
      return HermesScreenTimeSpoolRecord(
        identity: url.lastPathComponent,
        payload: payload,
        sequence: sequence,
        url: url
      )
    }.sorted { $0.sequence < $1.sequence }
  }

  static func acknowledge(_ records: [HermesScreenTimeSpoolRecord]) -> Bool {
    guard !records.isEmpty else { return true }
    let fileManager = FileManager.default
    for record in records {
      do {
        if fileManager.fileExists(atPath: record.url.path) {
          try fileManager.removeItem(at: record.url)
        }
      } catch {
        return false
      }
    }
    guard let directory = records.last?.url.deletingLastPathComponent() else { return true }
    let ack = records.map(\.sequence).max() ?? 0
    do {
      try Data(String(ack).utf8).write(
        to: directory.appendingPathComponent("ack"),
        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
      )
      return true
    } catch {
      return false
    }
  }

  static func purgeAll() {
    guard let root = rootDirectory else { return }
    try? FileManager.default.removeItem(at: root)
  }

  private static var rootDirectory: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent("HermesScreenTimeSpool", isDirectory: true)
  }

  private static func generationDirectory(
    lifecycleEpoch: Int,
    serverGeneration: String
  ) -> URL? {
    let digest = SHA256.hash(data: Data(serverGeneration.utf8))
      .prefix(12)
      .map { String(format: "%02x", $0) }
      .joined()
    return rootDirectory?.appendingPathComponent(
      "\(lifecycleEpoch)-\(digest)",
      isDirectory: true
    )
  }

  private static func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
