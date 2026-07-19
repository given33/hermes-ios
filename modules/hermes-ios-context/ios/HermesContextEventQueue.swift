import CryptoKit
import Foundation
import Security

final class HermesContextEventQueue {
  static let shared = HermesContextEventQueue()

  private let ioQueue = DispatchQueue(label: "app.hermes.context-events", qos: .utility)
  private let sequenceKey = "app.hermes.context-events.sequence"
  private let eventsURL: URL
  private let relayStateURL: URL
  private let legacyURL: URL
  private var deferredEvents: [[String: Any]] = []

  private init() {
    let applicationSupport = FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first!
    let directory = applicationSupport.appendingPathComponent("HermesContext", isDirectory: true)
    try? FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
    )
    eventsURL = directory.appendingPathComponent("pending-events.encjsonl")
    relayStateURL = directory.appendingPathComponent("relay-state.enc")
    legacyURL = directory.appendingPathComponent("pending-events.jsonl")
    ioQueue.async { [weak self] in self?.migrateLegacyEventsUnlocked() }
  }

  var installationIdentifier: String {
    HermesSecureKeychain.installationIdentifier()
  }

  var isCollectionSuspended: Bool {
    ioQueue.sync { isCollectionSuspendedUnlocked() }
  }

  var accountGeneration: Int {
    ioQueue.sync { accountGenerationUnlocked() }
  }

  func isCurrentOwnerScope(_ scope: String) -> Bool {
    ioQueue.sync {
      !scope.isEmpty && (loadRelayStateUnlocked()["ownerScope"] as? String) == scope
    }
  }

  func enqueue(
    type: String,
    payload: [String: Any],
    occurredAt: Date = Date(),
    sourceDeviceID: String? = nil,
    completion: (() -> Void)? = nil
  ) {
    ioQueue.async { [self] in
      guard !isCollectionSuspendedUnlocked() else {
        DispatchQueue.main.async { completion?() }
        return
      }
      let scopedEvent = self.makeEventUnlocked(
        type: type,
        payload: payload,
        occurredAt: occurredAt,
        sourceDeviceID: sourceDeviceID,
        eventID: nil
      )
      flushDeferredUnlocked()
      if !appendUnlocked(scopedEvent) {
        deferredEvents.append(scopedEvent)
      }
      DispatchQueue.main.async { completion?() }
    }
  }

  func enqueueBatch(_ rawEvents: [[String: Any]]) throws -> Int {
    try ioQueue.sync {
      guard !isCollectionSuspendedUnlocked() else { return 0 }
      flushDeferredUnlocked()
      let persistedIDs = Set(loadUnlocked().compactMap { $0["id"] as? String })
      var seenIDs = persistedIDs
      var accepted = 0
      var failed = false

      for raw in rawEvents {
        guard let type = raw["kind"] as? String, !type.isEmpty,
              let payload = raw["payload"] as? [String: Any] else {
          throw HermesSecureStoreError.invalidEvent
        }
        let eventID = (raw["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let eventID, !eventID.isEmpty, seenIDs.contains(eventID) {
          accepted += 1
          continue
        }
        let timestamp = (raw["timestamp"] as? NSNumber)?.doubleValue
          ?? (raw["observed_at"] as? NSNumber)?.doubleValue
          ?? Date().timeIntervalSince1970 * 1000
        let occurredAt = Date(
          timeIntervalSince1970: timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp
        )
        let event = makeEventUnlocked(
          type: type,
          payload: payload,
          occurredAt: occurredAt,
          sourceDeviceID: raw["source_device_id"] as? String,
          eventID: eventID
        )
        let storedID = event["id"] as? String ?? ""
        if appendUnlocked(event) {
          seenIDs.insert(storedID)
          accepted += 1
        } else {
          deferredEvents.append(event)
          failed = true
        }
      }
      if failed { throw HermesSecureStoreError.persistenceFailed }
      return accepted
    }
  }

  func read(limit: Int, kinds: Set<String>? = nil, scope: String? = nil) -> [[String: Any]] {
    ioQueue.sync {
      flushDeferredUnlocked()
      guard limit > 0 else { return [] }
      let events = loadUnlocked().filter { event in
        if let scope, (event["owner_scope"] as? String) != scope { return false }
        guard let kinds else { return true }
        return kinds.contains(event["kind"] as? String ?? "")
      }
      return Array(events.prefix(min(limit, 1_000)))
    }
  }

  func acknowledge(ids: Set<String>, cursor: Int?, scope: String? = nil) -> Int {
    ioQueue.sync {
      flushDeferredUnlocked()
      let events = loadUnlocked()
      let remaining = events.filter { event in
        if let scope, (event["owner_scope"] as? String) != scope { return true }
        if let id = event["id"] as? String, ids.contains(id) { return false }
        if let cursor, let sequence = event["sequence"] as? Int, sequence <= cursor { return false }
        return true
      }
      guard remaining.count != events.count else { return 0 }
      persistUnlocked(remaining)
      return events.count - remaining.count
    }
  }

  func commandCursor() -> String {
    ioQueue.sync {
      let state = loadRelayStateUnlocked()
      let scope = state["ownerScope"] as? String ?? ""
      let cursors = state["commandCursorsByScope"] as? [String: String] ?? [:]
      return cursors[scope] ?? ""
    }
  }

  // Relay wakes must survive a suspended or relaunched app process. They are
  // kept in the same encrypted state envelope as command cursors so a native
  // background launch can drain them before JavaScript subscriptions attach.
  func recordRelayWake(id: String, reason: String) {
    guard !id.isEmpty else { return }
    ioQueue.sync {
      guard !isCollectionSuspendedUnlocked() else { return }
      var state = loadRelayStateUnlocked()
      var wakes = state["pendingRelayWakes"] as? [[String: Any]] ?? []
      wakes.removeAll { ($0["wakeId"] as? String) == id }
      wakes.append([
        "wakeId": id,
        "reason": String(reason.prefix(128)),
        "createdAt": Date().timeIntervalSince1970 * 1000,
      ])
      state["pendingRelayWakes"] = Array(wakes.suffix(100))
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
    }
  }

  func pendingRelayWakes() -> [[String: String]] {
    ioQueue.sync {
      let state = loadRelayStateUnlocked()
      let wakes = state["pendingRelayWakes"] as? [[String: Any]] ?? []
      return wakes.compactMap { wake in
        guard let wakeID = wake["wakeId"] as? String, !wakeID.isEmpty else { return nil }
        return [
          "wakeId": wakeID,
          "reason": wake["reason"] as? String ?? "background",
        ]
      }
    }
  }

  func completeRelayWake(id: String) {
    guard !id.isEmpty else { return }
    ioQueue.sync {
      var state = loadRelayStateUnlocked()
      var wakes = state["pendingRelayWakes"] as? [[String: Any]] ?? []
      wakes.removeAll { ($0["wakeId"] as? String) == id }
      state["pendingRelayWakes"] = wakes
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
    }
  }

  func setOwnerScope(_ scope: String) {
    ioQueue.sync {
      var state = loadRelayStateUnlocked()
      let previousScope = state["ownerScope"] as? String ?? ""
      let wasSuspended = state["collectionSuspended"] as? Bool ?? false
      let deletedScopes = Set(state["deletedOwnerScopes"] as? [String] ?? [])
      guard !wasSuspended, !deletedScopes.contains(scope) else { return }
      if previousScope.isEmpty && !scope.isEmpty && !wasSuspended {
        var events = loadUnlocked()
        var migrated = false
        for index in events.indices {
          let eventScope = events[index]["owner_scope"] as? String ?? ""
          if eventScope.isEmpty {
            events[index]["owner_scope"] = scope
            migrated = true
          }
        }
        if migrated { persistUnlocked(events) }
      }
      if !scope.isEmpty {
        var cursors = state["commandCursorsByScope"] as? [String: String] ?? [:]
        if cursors[scope] == nil, let legacyCursor = state["commandCursor"] as? String {
          cursors[scope] = legacyCursor
        }
        state["commandCursorsByScope"] = cursors
        var completedByScope = state["completedCommandIDsByScope"] as? [String: [String]] ?? [:]
        if completedByScope[scope] == nil,
           let legacyCompleted = state["completedCommandIDs"] as? [String] {
          completedByScope[scope] = legacyCompleted
        }
        state["completedCommandIDsByScope"] = completedByScope
      }
      state.removeValue(forKey: "commandCursor")
      state.removeValue(forKey: "completedCommandIDs")
      state["ownerScope"] = scope
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
    }
  }

  @discardableResult
  func activateOwnerScope(_ scope: String) -> Int {
    ioQueue.sync {
      let normalized = scope.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !normalized.isEmpty else { return accountGenerationUnlocked() }
      var state = loadRelayStateUnlocked()
      let previousScope = state["ownerScope"] as? String ?? ""
      let wasSuspended = state["collectionSuspended"] as? Bool ?? false
      var deletedScopes = Set(state["deletedOwnerScopes"] as? [String] ?? [])
      deletedScopes.remove(normalized)
      state["deletedOwnerScopes"] = Array(deletedScopes).sorted()
      if wasSuspended || previousScope != normalized {
        state["accountGeneration"] = (state["accountGeneration"] as? Int ?? 0) + 1
      }
      state["collectionSuspended"] = false
      state["ownerScope"] = normalized
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
      return state["accountGeneration"] as? Int ?? 0
    }
  }

  func deleteOwnerScope(_ scope: String) -> HermesOwnerScopeDeletionResult {
    ioQueue.sync {
      deleteOwnerScopeUnlocked(scope)
    }
  }

  func deleteCurrentOwnerScope() -> Int {
    ioQueue.sync {
      let scope = loadRelayStateUnlocked()["ownerScope"] as? String ?? ""
      guard !scope.isEmpty else { return 0 }
      return deleteOwnerScopeUnlocked(scope).deletedCount
    }
  }

  private func deleteOwnerScopeUnlocked(_ scope: String) -> HermesOwnerScopeDeletionResult {
    guard !scope.isEmpty else {
      return HermesOwnerScopeDeletionResult(
        deletedCount: 0,
        deletedWasCurrent: false,
        accountGeneration: accountGenerationUnlocked()
      )
    }
    var state = loadRelayStateUnlocked()
    let deletingCurrentScope = (state["ownerScope"] as? String) == scope
    let events = loadUnlocked()
    let remaining = events.filter { event in
      let eventScope = event["owner_scope"] as? String ?? ""
      return eventScope != scope && !(deletingCurrentScope && eventScope.isEmpty)
    }
    let deferredBefore = deferredEvents.count
    deferredEvents.removeAll { event in
      let eventScope = event["owner_scope"] as? String ?? ""
      return eventScope == scope || (deletingCurrentScope && eventScope.isEmpty)
    }
    if remaining.count != events.count { persistUnlocked(remaining) }
    let commands = state["pendingCommands"] as? [[String: Any]] ?? []
    state["pendingCommands"] = commands.filter { ($0["_relay_owner_scope"] as? String) != scope }
    var cursors = state["commandCursorsByScope"] as? [String: String] ?? [:]
    cursors.removeValue(forKey: scope)
    state["commandCursorsByScope"] = cursors
    var completed = state["completedCommandIDsByScope"] as? [String: [String]] ?? [:]
    completed.removeValue(forKey: scope)
    state["completedCommandIDsByScope"] = completed
    var executionResults = state["commandExecutionResultsByScope"]
      as? [String: [String: [String: Any]]] ?? [:]
    executionResults.removeValue(forKey: scope)
    state["commandExecutionResultsByScope"] = executionResults
    if deletingCurrentScope {
      let generation = (state["accountGeneration"] as? Int ?? 0) + 1
      state["accountGeneration"] = generation
      state["ownerScope"] = ""
      state["pendingRelayWakes"] = []
      state["collectionSuspended"] = true
      try? FileManager.default.removeItem(at: legacyURL)
    }
    var deletedScopes = Set(state["deletedOwnerScopes"] as? [String] ?? [])
    deletedScopes.insert(scope)
    state["deletedOwnerScopes"] = Array(deletedScopes).sorted()
    state["updatedAt"] = Date().timeIntervalSince1970 * 1000
    persistRelayStateUnlocked(state)
    return HermesOwnerScopeDeletionResult(
      deletedCount: events.count - remaining.count + deferredBefore - deferredEvents.count,
      deletedWasCurrent: deletingCurrentScope,
      accountGeneration: state["accountGeneration"] as? Int ?? 0
    )
  }

  func hasCompletedCommand(_ id: String) -> Bool {
    ioQueue.sync {
      let state = loadRelayStateUnlocked()
      let scope = state["ownerScope"] as? String ?? ""
      let completedByScope = state["completedCommandIDsByScope"] as? [String: [String]] ?? [:]
      let completed = completedByScope[scope] ?? []
      return completed.contains(id)
    }
  }

  func recordCommandCompletion(id: String, cursor: String) {
    ioQueue.sync {
      var state = loadRelayStateUnlocked()
      let scope = state["ownerScope"] as? String ?? ""
      var completedByScope = state["completedCommandIDsByScope"] as? [String: [String]] ?? [:]
      var completed = completedByScope[scope] ?? []
      if !completed.contains(id) { completed.append(id) }
      completedByScope[scope] = Array(completed.suffix(2_048))
      state["completedCommandIDsByScope"] = completedByScope
      var cursors = state["commandCursorsByScope"] as? [String: String] ?? [:]
      cursors[scope] = cursor
      state["commandCursorsByScope"] = cursors
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
    }
  }

  func commandExecutionResult(id: String) -> [String: Any]? {
    ioQueue.sync {
      let state = loadRelayStateUnlocked()
      let scope = state["ownerScope"] as? String ?? ""
      let results = state["commandExecutionResultsByScope"]
        as? [String: [String: [String: Any]]] ?? [:]
      return results[scope]?[id]
    }
  }

  func recordCommandExecutionResult(id: String, result: [String: Any]) {
    guard !id.isEmpty else { return }
    ioQueue.sync {
      var state = loadRelayStateUnlocked()
      let scope = state["ownerScope"] as? String ?? ""
      var resultsByScope = state["commandExecutionResultsByScope"]
        as? [String: [String: [String: Any]]] ?? [:]
      var results = resultsByScope[scope] ?? [:]
      results[id] = result
      if results.count > 200 {
        let completedByScope = state["completedCommandIDsByScope"] as? [String: [String]] ?? [:]
        let keep = Set(Array((completedByScope[scope] ?? []).suffix(199)) + [id])
        results = results.filter { keep.contains($0.key) }
      }
      resultsByScope[scope] = results
      state["commandExecutionResultsByScope"] = resultsByScope
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
    }
  }

  func setCommandCursor(_ cursor: String) {
    ioQueue.sync {
      var state = loadRelayStateUnlocked()
      let scope = state["ownerScope"] as? String ?? ""
      var cursors = state["commandCursorsByScope"] as? [String: String] ?? [:]
      cursors[scope] = cursor
      state["commandCursorsByScope"] = cursors
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
    }
  }

  func storePendingCommand(_ command: [String: Any]) {
    guard let id = command["id"] as? String, !id.isEmpty else { return }
    ioQueue.sync {
      var state = loadRelayStateUnlocked()
      var commands = state["pendingCommands"] as? [[String: Any]] ?? []
      commands.removeAll { ($0["id"] as? String) == id }
      commands.append(command)
      state["pendingCommands"] = Array(commands.suffix(200))
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
    }
  }

  func pendingCommands() -> [[String: Any]] {
    ioQueue.sync { loadRelayStateUnlocked()["pendingCommands"] as? [[String: Any]] ?? [] }
  }

  func removePendingCommand(_ id: String) {
    ioQueue.sync {
      var state = loadRelayStateUnlocked()
      var commands = state["pendingCommands"] as? [[String: Any]] ?? []
      commands.removeAll { ($0["id"] as? String) == id }
      state["pendingCommands"] = commands
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
    }
  }

  private func loadUnlocked() -> [[String: Any]] {
    guard let data = try? Data(contentsOf: eventsURL), !data.isEmpty else { return [] }
    var events: [[String: Any]] = []
    var corruptLines = Data()
    for line in data.split(separator: 0x0a, omittingEmptySubsequences: true) {
      guard let sealed = Data(base64Encoded: Data(line)),
            let clear = try? HermesSecureKeychain.open(sealed),
            let value = try? JSONSerialization.jsonObject(with: clear),
            let event = value as? [String: Any] else {
        corruptLines.append(contentsOf: line)
        corruptLines.append(0x0a)
        continue
      }
      events.append(event)
    }
    if !corruptLines.isEmpty { quarantineCorruptLinesUnlocked(corruptLines) }
    return events.sorted {
      ($0["sequence"] as? Int ?? 0) < ($1["sequence"] as? Int ?? 0)
    }
  }

  private func makeEventUnlocked(
    type: String,
    payload: [String: Any],
    occurredAt: Date,
    sourceDeviceID: String?,
    eventID: String?
  ) -> [String: Any] {
    let sequence = UserDefaults.standard.integer(forKey: sequenceKey) + 1
    UserDefaults.standard.set(sequence, forKey: sequenceKey)
    let identifier = (eventID?.isEmpty == false ? eventID : nil)
      ?? UUID().uuidString.lowercased()
    return [
      "id": String(identifier.prefix(256)),
      "kind": String(type.prefix(128)),
      "owner_scope": loadRelayStateUnlocked()["ownerScope"] as? String ?? "",
      "payload": payload,
      "sequence": sequence,
      "source_device_id": sourceDeviceID ?? installationIdentifier,
      "timestamp": occurredAt.timeIntervalSince1970 * 1000,
    ]
  }

  @discardableResult
  private func appendUnlocked(_ event: [String: Any]) -> Bool {
    guard JSONSerialization.isValidJSONObject(event),
          let clear = try? JSONSerialization.data(withJSONObject: event),
          let sealed = try? HermesSecureKeychain.seal(clear) else {
      return false
    }
    var line = sealed.base64EncodedData()
    line.append(0x0a)
    do {
      if !FileManager.default.fileExists(atPath: eventsURL.path) {
        try line.write(
          to: eventsURL,
          options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        )
      } else {
        let handle = try FileHandle(forWritingTo: eventsURL)
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
        try handle.synchronize()
        try handle.close()
      }
      try applyFileProtection(to: eventsURL)
      return true
    } catch {
      return false
    }
  }

  private func persistUnlocked(_ events: [[String: Any]]) {
    var data = Data()
    for event in events {
      guard JSONSerialization.isValidJSONObject(event),
            let clear = try? JSONSerialization.data(withJSONObject: event),
            let sealed = try? HermesSecureKeychain.seal(clear) else { continue }
      data.append(sealed.base64EncodedData())
      data.append(0x0a)
    }
    do {
      try data.write(
        to: eventsURL,
        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
      )
      try applyFileProtection(to: eventsURL)
    } catch {
      // The in-memory batch remains intact and is retried by the next collector callback.
    }
  }

  private func flushDeferredUnlocked() {
    guard !deferredEvents.isEmpty else { return }
    var remaining: [[String: Any]] = []
    for event in deferredEvents where !appendUnlocked(event) { remaining.append(event) }
    deferredEvents = remaining
  }

  private func loadRelayStateUnlocked() -> [String: Any] {
    guard let sealed = try? Data(contentsOf: relayStateURL),
          let clear = try? HermesSecureKeychain.open(sealed),
          let object = try? JSONSerialization.jsonObject(with: clear),
          let state = object as? [String: Any] else { return [:] }
    return state
  }

  private func isCollectionSuspendedUnlocked() -> Bool {
    loadRelayStateUnlocked()["collectionSuspended"] as? Bool ?? false
  }

  private func accountGenerationUnlocked() -> Int {
    loadRelayStateUnlocked()["accountGeneration"] as? Int ?? 0
  }

  private func persistRelayStateUnlocked(_ state: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(state),
          let clear = try? JSONSerialization.data(withJSONObject: state),
          let sealed = try? HermesSecureKeychain.seal(clear) else { return }
    try? sealed.write(
      to: relayStateURL,
      options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
    )
    try? applyFileProtection(to: relayStateURL)
  }

  private func migrateLegacyEventsUnlocked() {
    guard !isCollectionSuspendedUnlocked() else {
      try? FileManager.default.removeItem(at: legacyURL)
      return
    }
    guard FileManager.default.fileExists(atPath: legacyURL.path),
          let data = try? Data(contentsOf: legacyURL) else { return }
    for line in data.split(separator: 0x0a, omittingEmptySubsequences: true) {
      guard let value = try? JSONSerialization.jsonObject(with: Data(line)),
            let event = value as? [String: Any] else { continue }
      _ = appendUnlocked(event)
    }
    try? FileManager.default.removeItem(at: legacyURL)
  }

  private func quarantineCorruptLinesUnlocked(_ data: Data) {
    let url = eventsURL.deletingLastPathComponent().appendingPathComponent(
      "pending-events-corrupt-\(Int(Date().timeIntervalSince1970)).encjsonl"
    )
    try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  private func applyFileProtection(to url: URL) throws {
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
      ofItemAtPath: url.path
    )
  }
}

struct HermesOwnerScopeDeletionResult {
  let deletedCount: Int
  let deletedWasCurrent: Bool
  let accountGeneration: Int
}

private enum HermesSecureKeychain {
  private static let service = "app.hermes.ios-context"
  private static let keyAccount = "event-queue-key-v1"
  private static let deviceAccount = "installation-id-v1"

  static func seal(_ clear: Data) throws -> Data {
    let sealed = try AES.GCM.seal(clear, using: try symmetricKey())
    guard let combined = sealed.combined else { throw HermesSecureStoreError.invalidEnvelope }
    return combined
  }

  static func open(_ sealed: Data) throws -> Data {
    try AES.GCM.open(AES.GCM.SealedBox(combined: sealed), using: try symmetricKey())
  }

  static func installationIdentifier() -> String {
    if let data = read(account: deviceAccount),
       let value = String(data: data, encoding: .utf8), !value.isEmpty {
      return value
    }
    let value = "ios-\(UUID().uuidString.lowercased())"
    _ = write(Data(value.utf8), account: deviceAccount)
    return value
  }

  private static func symmetricKey() throws -> SymmetricKey {
    if let data = read(account: keyAccount), data.count == 32 {
      return SymmetricKey(data: data)
    }
    var bytes = Data(count: 32)
    let status = bytes.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, 32, buffer.baseAddress!)
    }
    guard status == errSecSuccess, write(bytes, account: keyAccount) else {
      throw HermesSecureStoreError.keyUnavailable
    }
    return SymmetricKey(data: bytes)
  }

  private static func read(account: String) -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: true,
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
    return result as? Data
  }

  @discardableResult
  private static func write(_ value: Data, account: String) -> Bool {
    let selector: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: value,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let update = SecItemUpdate(selector as CFDictionary, attributes as CFDictionary)
    if update == errSecSuccess { return true }
    var insert = selector
    attributes.forEach { insert[$0.key] = $0.value }
    return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
  }
}

private enum HermesSecureStoreError: Error {
  case invalidEvent
  case invalidEnvelope
  case keyUnavailable
  case persistenceFailed
}
