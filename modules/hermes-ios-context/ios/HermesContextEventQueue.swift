import CryptoKit
import Darwin
import Foundation
import Security

final class HermesContextEventQueue {
  static let shared = HermesContextEventQueue()

  private let ioQueue = DispatchQueue(label: "app.hermes.context-events", qos: .utility)
  private let sequenceKey = "app.hermes.context-events.sequence"
  private let eventsURL: URL
  private let relayStateURL: URL
  private let legacyURL: URL
  private let maximumEventCount = 10_000
  private let maximumEncryptedBytes = 16 * 1024 * 1024
  private var cachedEvents: [[String: Any]]?
  private var cachedEventIDs = Set<String>()
  private var cachedMaxSequence = 0
  private var cachedEncryptedBytes = 0
  private var cachedRelayState: [String: Any]?

  private init() {
    // The system normally always supplies an Application Support URL, but an
    // extension or a constrained test host can return an empty array. Keep the
    // encrypted queue alive in a private temporary directory instead of
    // crashing the process during singleton initialization.
    let applicationSupport = FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
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

  var serverAccountGeneration: String {
    ioQueue.sync {
      loadRelayStateUnlocked()["serverAccountGeneration"] as? String ?? ""
    }
  }

  /// Identity used to fence App Intent and shortcut requests.  These values
  /// are read from the same serialized relay state as context events, so an
  /// extension cannot accidentally attach a request to a stale JS session.
  var currentOwnerIdentity: HermesOwnerIdentity {
    ioQueue.sync {
      let state = loadRelayStateUnlocked()
      return HermesOwnerIdentity(
        ownerScope: state["ownerScope"] as? String ?? "",
        accountGeneration: state["serverAccountGeneration"] as? String ?? ""
      )
    }
  }

  var hasCurrentOwner: Bool {
    ioQueue.sync {
      let scope = loadRelayStateUnlocked()["ownerScope"] as? String ?? ""
      return !scope.isEmpty
    }
  }

  func currentCollectorGenerationToken() -> HermesCollectorGenerationToken? {
    ioQueue.sync {
      let state = loadRelayStateUnlocked()
      let ownerScope = state["ownerScope"] as? String ?? ""
      let serverGeneration = state["serverAccountGeneration"] as? String ?? ""
      let lifecycleEpoch = state["accountGeneration"] as? Int ?? 0
      let startedAt = state["accountGenerationStartedAt"] as? Double ?? 0
      guard !(state["collectionSuspended"] as? Bool ?? false),
            !ownerScope.isEmpty,
            !serverGeneration.isEmpty,
            lifecycleEpoch > 0,
            startedAt.isFinite,
            startedAt > 0 else { return nil }
      return HermesCollectorGenerationToken(
        ownerScope: ownerScope,
        serverAccountGeneration: serverGeneration,
        lifecycleEpoch: lifecycleEpoch,
        startedAtMilliseconds: startedAt
      )
    }
  }

  func isCurrentCollectorGenerationToken(_ token: HermesCollectorGenerationToken) -> Bool {
    ioQueue.sync {
      let state = loadRelayStateUnlocked()
      return !(state["collectionSuspended"] as? Bool ?? false)
        && (state["ownerScope"] as? String) == token.ownerScope
        && (state["serverAccountGeneration"] as? String) == token.serverAccountGeneration
        && (state["accountGeneration"] as? Int) == token.lifecycleEpoch
        && (state["accountGenerationStartedAt"] as? Double) == token.startedAtMilliseconds
    }
  }

  func isCurrentOwnerScope(_ scope: String) -> Bool {
    ioQueue.sync { isCurrentOwnerScopeUnlocked(scope) }
  }

  private func isCurrentOwnerScopeUnlocked(_ scope: String) -> Bool {
    !scope.isEmpty && (loadRelayStateUnlocked()["ownerScope"] as? String) == scope
  }

  @discardableResult
  func enqueue(
    type: String,
    payload: [String: Any],
    occurredAt: Date = Date(),
    sourceDeviceID: String? = nil,
    accountGeneration: Int? = nil,
    eventID: String? = nil,
    onPersisted: (() -> Void)? = nil
  ) -> Bool {
    let persisted = ioQueue.sync { [self] in
      let relayState = loadRelayStateUnlocked()
      let ownerScope = relayState["ownerScope"] as? String ?? ""
      let currentGeneration = relayState["accountGeneration"] as? Int ?? 0
      let generationStartedAt = relayState["accountGenerationStartedAt"] as? Double ?? 0
      guard !(relayState["collectionSuspended"] as? Bool ?? false),
            !ownerScope.isEmpty,
            accountGeneration == nil || accountGeneration == currentGeneration,
            occurredAt.timeIntervalSince1970 * 1000 >= generationStartedAt else {
        return false
      }
      if cachedEvents == nil { _ = loadUnlocked() }
      if let eventID, !eventID.isEmpty,
         cachedEventIDs.contains(String(eventID.prefix(256))) {
        return true
      }
      let scopedEvent = self.makeEventUnlocked(
        type: type,
        payload: payload,
        occurredAt: occurredAt,
        sourceDeviceID: sourceDeviceID,
        eventID: eventID
      )
      return appendUnlocked(scopedEvent)
    }
    if persisted { onPersisted?() }
    return persisted
  }

  func enqueueBatch(_ rawEvents: [[String: Any]]) throws -> Int {
    try ioQueue.sync {
      let relayState = loadRelayStateUnlocked()
      let ownerScope = relayState["ownerScope"] as? String ?? ""
      guard !(relayState["collectionSuspended"] as? Bool ?? false),
            !ownerScope.isEmpty else { return 0 }
      let persistedEvents = loadUnlocked()
      let persistedIDs = Set(persistedEvents.compactMap { $0["id"] as? String })
      var seenIDs = persistedIDs
      var accepted = 0
      var pending: [[String: Any]] = []
      var nextSequence = max(
        UserDefaults.standard.integer(forKey: sequenceKey),
        persistedEvents.compactMap { $0["sequence"] as? Int }.max() ?? 0
      )

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
        let expectedGeneration = (raw["lifecycle_epoch"] as? NSNumber)?.intValue
          ?? raw["lifecycle_epoch"] as? Int
        if let expectedGeneration,
           expectedGeneration != (relayState["accountGeneration"] as? Int ?? 0) {
          continue
        }
        if let expectedAccountGeneration = raw["account_generation"] as? String,
           expectedAccountGeneration != (relayState["serverAccountGeneration"] as? String ?? "") {
          continue
        }
        let generationStartedAt = relayState["accountGenerationStartedAt"] as? Double ?? 0
        if timestamp < generationStartedAt { continue }
        let occurredAt = Date(
          timeIntervalSince1970: timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp
        )
        nextSequence += 1
        let event = makeEventUnlocked(
          type: type,
          payload: payload,
          occurredAt: occurredAt,
          sourceDeviceID: raw["source_device_id"] as? String,
          eventID: eventID,
          sequenceOverride: nextSequence,
          relayStateOverride: relayState
        )
        let storedID = event["id"] as? String ?? ""
        pending.append(event)
        seenIDs.insert(storedID)
        accepted += 1
      }
      guard appendBatchUnlocked(pending) else { throw HermesSecureStoreError.persistenceFailed }
      UserDefaults.standard.set(nextSequence, forKey: sequenceKey)
      UserDefaults.standard.synchronize()
      return accepted
    }
  }

  // Reads and acknowledgements are strictly owner-scoped: the caller must
  // present the currently active scope, and a stale or foreign scope drains
  // nothing. Cross-scope maintenance only happens through the explicit
  // deleteOwnerScope lifecycle path.
  func read(limit: Int, kinds: Set<String>? = nil, scope: String) -> [[String: Any]] {
    ioQueue.sync {
      guard limit > 0, isCurrentOwnerScopeUnlocked(scope) else { return [] }
      let events = loadUnlocked().filter { event in
        guard (event["owner_scope"] as? String) == scope else { return false }
        guard let kinds else { return true }
        return kinds.contains(event["kind"] as? String ?? "")
      }
      return Array(events.prefix(min(limit, 1_000)))
    }
  }

  func claim(limit: Int, kinds: Set<String>? = nil, scope: String) throws -> [String: Any] {
    try ioQueue.sync {
      guard limit > 0, isCurrentOwnerScopeUnlocked(scope) else {
        return ["token": "", "events": []]
      }
      var events = loadUnlocked()
      let now = Date().timeIntervalSince1970 * 1000
      let token = UUID().uuidString.lowercased()
      var claimed: [[String: Any]] = []
      for index in events.indices where claimed.count < min(limit, 1_000) {
        guard (events[index]["owner_scope"] as? String) == scope else { continue }
        if let kinds, !kinds.contains(events[index]["kind"] as? String ?? "") { continue }
        let status = events[index]["outbox_state"] as? String ?? "pending"
        let leaseExpiresAt = (events[index]["lease_expires_at"] as? NSNumber)?.doubleValue
          ?? events[index]["lease_expires_at"] as? Double
          ?? 0
        guard status == "pending" || (status == "inflight" && leaseExpiresAt <= now) else {
          continue
        }
        events[index]["outbox_state"] = "inflight"
        events[index]["batch_token"] = token
        events[index]["lease_expires_at"] = now + 120_000
        claimed.append(events[index])
      }
      guard !claimed.isEmpty else { return ["token": "", "events": []] }
      try persistUnlocked(events)
      return ["token": token, "events": claimed]
    }
  }

  func acknowledgeClaim(
    token: String,
    ids: Set<String>,
    cursor: Int?,
    scope: String
  ) throws -> Int {
    try ioQueue.sync {
      guard !token.isEmpty, isCurrentOwnerScopeUnlocked(scope) else { return 0 }
      let events = loadUnlocked()
      let remaining = events.filter { event in
        guard (event["owner_scope"] as? String) == scope,
              (event["outbox_state"] as? String) == "inflight",
              (event["batch_token"] as? String) == token else { return true }
        if let id = event["id"] as? String, ids.contains(id) { return false }
        if let cursor, let sequence = event["sequence"] as? Int, sequence <= cursor {
          return false
        }
        return true
      }
      guard remaining.count != events.count else { return 0 }
      try persistUnlocked(remaining)
      return events.count - remaining.count
    }
  }

  func acknowledge(ids: Set<String>, cursor: Int?, scope: String) throws -> Int {
    try ioQueue.sync {
      guard isCurrentOwnerScopeUnlocked(scope) else { return 0 }
      let events = loadUnlocked()
      let remaining = events.filter { event in
        if (event["owner_scope"] as? String) != scope { return true }
        if let id = event["id"] as? String, ids.contains(id) { return false }
        if let cursor, let sequence = event["sequence"] as? Int, sequence <= cursor { return false }
        return true
      }
      guard remaining.count != events.count else { return 0 }
      try persistUnlocked(remaining)
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

  func setOwnerScope(_ scope: String, accountGeneration: String) {
    ioQueue.sync {
      let normalized = scope.trimmingCharacters(in: .whitespacesAndNewlines)
      let normalizedGeneration = accountGeneration.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !normalized.isEmpty, !normalizedGeneration.isEmpty else { return }
      var state = loadRelayStateUnlocked()
      let currentScope = state["ownerScope"] as? String ?? ""
      let currentAccountGeneration = state["serverAccountGeneration"] as? String ?? ""
      let wasSuspended = state["collectionSuspended"] as? Bool ?? false
      let deletedScopes = Set(state["deletedOwnerScopes"] as? [String] ?? [])
      guard !wasSuspended,
            currentScope == normalized,
            currentAccountGeneration == normalizedGeneration,
            !deletedScopes.contains(normalized) else { return }
      if !normalized.isEmpty {
        let cursors = state["commandCursorsByScope"] as? [String: String] ?? [:]
        // Legacy cursors are fenced in their original unscoped namespace.
        state["commandCursorsByScope"] = cursors
        let completedByScope = state["completedCommandIDsByScope"] as? [String: [String]] ?? [:]
        state["completedCommandIDsByScope"] = completedByScope
      }
      state.removeValue(forKey: "commandCursor")
      state.removeValue(forKey: "completedCommandIDs")
      state["ownerScope"] = normalized
      state["serverAccountGeneration"] = normalizedGeneration
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      persistRelayStateUnlocked(state)
    }
  }

  @discardableResult
  func activateOwnerScope(_ scope: String, accountGeneration: String) -> Int {
    ioQueue.sync {
      let normalized = scope.trimmingCharacters(in: .whitespacesAndNewlines)
      let normalizedGeneration = accountGeneration.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !normalized.isEmpty, !normalizedGeneration.isEmpty else {
        return accountGenerationUnlocked()
      }
      var state = loadRelayStateUnlocked()
      let previousScope = state["ownerScope"] as? String ?? ""
      let previousAccountGeneration = state["serverAccountGeneration"] as? String ?? ""
      let wasSuspended = state["collectionSuspended"] as? Bool ?? false
      let deletedScopes = Set(state["deletedOwnerScopes"] as? [String] ?? [])
      guard !deletedScopes.contains(normalized) else { return accountGenerationUnlocked() }
      if wasSuspended
          || previousScope != normalized
          || previousAccountGeneration != normalizedGeneration {
        state["accountGeneration"] = (state["accountGeneration"] as? Int ?? 0) + 1
        state["accountGenerationStartedAt"] = Date().timeIntervalSince1970 * 1000
      }
      state["collectionSuspended"] = false
      state["ownerScope"] = normalized
      state["serverAccountGeneration"] = normalizedGeneration
      state["updatedAt"] = Date().timeIntervalSince1970 * 1000
      guard persistRelayStateUnlocked(state) else {
        return accountGenerationUnlocked()
      }
      return state["accountGeneration"] as? Int ?? 0
    }
  }

  func deleteOwnerScope(
    _ scope: String,
    accountGeneration: String,
    requestedAt: Double? = nil
  ) -> HermesOwnerScopeDeletionResult {
    ioQueue.sync {
      deleteOwnerScopeUnlocked(
        scope,
        accountGeneration: accountGeneration,
        requestedAt: requestedAt
      )
    }
  }

  func deleteCurrentOwnerScope() -> Int {
    ioQueue.sync {
      let scope = loadRelayStateUnlocked()["ownerScope"] as? String ?? ""
      guard !scope.isEmpty else { return 0 }
      let generation = loadRelayStateUnlocked()["serverAccountGeneration"] as? String ?? ""
      return deleteOwnerScopeUnlocked(
        scope,
        accountGeneration: generation,
        requestedAt: nil
      ).deletedCount
    }
  }

  private func deleteOwnerScopeUnlocked(
    _ scope: String,
    accountGeneration: String,
    requestedAt: Double?
  ) -> HermesOwnerScopeDeletionResult {
    guard !scope.isEmpty else {
      return HermesOwnerScopeDeletionResult(
        deletedCount: 0,
        deletedWasCurrent: false,
        accountGeneration: accountGeneration,
        lifecycleEpoch: accountGenerationUnlocked(),
        outcome: .failed
      )
    }
    var state = loadRelayStateUnlocked()
    let currentGeneration = state["accountGeneration"] as? Int ?? 0
    let currentAccountGeneration = state["serverAccountGeneration"] as? String ?? ""
    let generationStartedAt = state["accountGenerationStartedAt"] as? Double ?? 0
    let previouslyDeletedScopes = Set(state["deletedOwnerScopes"] as? [String] ?? [])
    if let requestedAt, requestedAt < generationStartedAt {
      return HermesOwnerScopeDeletionResult(
        deletedCount: 0,
        deletedWasCurrent: false,
        accountGeneration: accountGeneration,
        lifecycleEpoch: currentGeneration,
        outcome: previouslyDeletedScopes.contains(scope) ? .applied : .rejectedStale
      )
    }
    let deletingCurrentScope = (state["ownerScope"] as? String) == scope
      && currentAccountGeneration == accountGeneration
    let events = loadUnlocked()
    let remaining = events.filter { event in
      let eventScope = event["owner_scope"] as? String ?? ""
      return eventScope != scope && !(deletingCurrentScope && eventScope.isEmpty)
    }
    if remaining.count != events.count {
      do {
        try persistUnlocked(remaining)
      } catch {
        return HermesOwnerScopeDeletionResult(
          deletedCount: 0,
          deletedWasCurrent: false,
          accountGeneration: accountGeneration,
          lifecycleEpoch: currentGeneration,
          outcome: .failed
        )
      }
    }
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
      state["accountGenerationStartedAt"] = Date().timeIntervalSince1970 * 1000
      state["ownerScope"] = ""
      state["serverAccountGeneration"] = ""
      state["pendingRelayWakes"] = []
      state["collectionSuspended"] = true
      try? FileManager.default.removeItem(at: legacyURL)
    }
    var deletedScopes = Set(state["deletedOwnerScopes"] as? [String] ?? [])
    deletedScopes.insert(scope)
    state["deletedOwnerScopes"] = Array(deletedScopes).sorted()
    state["updatedAt"] = Date().timeIntervalSince1970 * 1000
    guard persistRelayStateUnlocked(state) else {
      return HermesOwnerScopeDeletionResult(
        deletedCount: 0,
        deletedWasCurrent: false,
        accountGeneration: accountGeneration,
        lifecycleEpoch: currentGeneration,
        outcome: .failed
      )
    }
    return HermesOwnerScopeDeletionResult(
      deletedCount: events.count - remaining.count,
      deletedWasCurrent: deletingCurrentScope,
      accountGeneration: accountGeneration,
      lifecycleEpoch: state["accountGeneration"] as? Int ?? 0,
      outcome: .applied
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
    if let cachedEvents { return cachedEvents }
    guard FileManager.default.fileExists(atPath: eventsURL.path) else {
      cachedEvents = []
      cachedEventIDs = []
      cachedMaxSequence = 0
      cachedEncryptedBytes = 0
      return []
    }
    guard let data = try? Data(contentsOf: eventsURL) else { return [] }
    if data.isEmpty {
      cachedEvents = []
      cachedEventIDs = []
      cachedMaxSequence = 0
      cachedEncryptedBytes = 0
      return []
    }
    var events: [[String: Any]] = []
    var corruptLines = Data()
    var rewroteCorruptQueue = false
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
    if !corruptLines.isEmpty {
      do {
        try quarantineCorruptLinesUnlocked(corruptLines)
        try persistUnlocked(events)
        rewroteCorruptQueue = true
      } catch {
        // Keep the original queue intact. A later read retries quarantine and rewrite.
      }
    }
    let sorted = events.sorted {
      ($0["sequence"] as? Int ?? 0) < ($1["sequence"] as? Int ?? 0)
    }
    cachedEvents = sorted
    cachedEventIDs = Set(sorted.compactMap { $0["id"] as? String })
    cachedMaxSequence = sorted.compactMap { $0["sequence"] as? Int }.max() ?? 0
    if !rewroteCorruptQueue { cachedEncryptedBytes = data.count }
    return sorted
  }

  private func makeEventUnlocked(
    type: String,
    payload: [String: Any],
    occurredAt: Date,
    sourceDeviceID: String?,
    eventID: String?,
    sequenceOverride: Int? = nil,
    relayStateOverride: [String: Any]? = nil
  ) -> [String: Any] {
    let sequence: Int
    if let sequenceOverride {
      sequence = sequenceOverride
    } else {
      if cachedEvents == nil { _ = loadUnlocked() }
      sequence = max(
        UserDefaults.standard.integer(forKey: sequenceKey),
        cachedMaxSequence
      ) + 1
      UserDefaults.standard.set(sequence, forKey: sequenceKey)
      UserDefaults.standard.synchronize()
    }
    let relayState = relayStateOverride ?? loadRelayStateUnlocked()
    let identifier = (eventID?.isEmpty == false ? eventID : nil)
      ?? UUID().uuidString.lowercased()
    return [
      "id": String(identifier.prefix(256)),
      "kind": String(type.prefix(128)),
      "owner_scope": relayState["ownerScope"] as? String ?? "",
      "account_generation": relayState["serverAccountGeneration"] as? String ?? "",
      "lifecycle_epoch": relayState["accountGeneration"] as? Int ?? 0,
      "payload": payload,
      "sequence": sequence,
      "outbox_state": "pending",
      "source_device_id": sourceDeviceID ?? installationIdentifier,
      "timestamp": occurredAt.timeIntervalSince1970 * 1000,
    ]
  }

  @discardableResult
  private func appendUnlocked(_ event: [String: Any]) -> Bool {
    appendBatchUnlocked([event])
  }

  @discardableResult
  private func appendBatchUnlocked(_ events: [[String: Any]]) -> Bool {
    guard !events.isEmpty else { return true }
    if cachedEvents == nil { _ = loadUnlocked() }
    guard (cachedEvents?.count ?? 0) + events.count <= maximumEventCount else { return false }
    var data = Data()
    for event in events {
      guard JSONSerialization.isValidJSONObject(event),
            let clear = try? JSONSerialization.data(withJSONObject: event),
            let sealed = try? HermesSecureKeychain.seal(clear) else {
        return false
      }
      data.append(sealed.base64EncodedData())
      data.append(0x0a)
    }
    guard cachedEncryptedBytes + data.count <= maximumEncryptedBytes else { return false }
    do {
      let created = !FileManager.default.fileExists(atPath: eventsURL.path)
      if created && !FileManager.default.createFile(atPath: eventsURL.path, contents: nil) {
        throw HermesSecureStoreError.persistenceFailed
      }
      if created { try applyFileProtection(to: eventsURL) }
      let handle = try FileHandle(forWritingTo: eventsURL)
      defer { try? handle.close() }
      try handle.seekToEnd()
      try handle.write(contentsOf: data)
      try handle.synchronize()
      try applyFileProtection(to: eventsURL)
      if created { try synchronizeDirectoryUnlocked(eventsURL.deletingLastPathComponent()) }
      let minimumNewSequence = events.compactMap { $0["sequence"] as? Int }.min() ?? 0
      if minimumNewSequence >= cachedMaxSequence {
        cachedEvents?.append(contentsOf: events)
      } else {
        cachedEvents = ((cachedEvents ?? []) + events).sorted {
          ($0["sequence"] as? Int ?? 0) < ($1["sequence"] as? Int ?? 0)
        }
      }
      cachedEventIDs.formUnion(events.compactMap { $0["id"] as? String })
      cachedMaxSequence = max(
        cachedMaxSequence,
        events.compactMap { $0["sequence"] as? Int }.max() ?? 0
      )
      cachedEncryptedBytes += data.count
      return true
    } catch {
      return false
    }
  }

  private func persistUnlocked(_ events: [[String: Any]]) throws {
    var data = Data()
    for event in events {
      guard JSONSerialization.isValidJSONObject(event),
            let clear = try? JSONSerialization.data(withJSONObject: event),
            let sealed = try? HermesSecureKeychain.seal(clear) else {
        throw HermesSecureStoreError.invalidEvent
      }
      data.append(sealed.base64EncodedData())
      data.append(0x0a)
    }
    try durableReplaceUnlocked(data, at: eventsURL)
    cachedEvents = events
    cachedEventIDs = Set(events.compactMap { $0["id"] as? String })
    cachedMaxSequence = events.compactMap { $0["sequence"] as? Int }.max() ?? 0
    cachedEncryptedBytes = data.count
  }

  private func loadRelayStateUnlocked() -> [String: Any] {
    if let cachedRelayState { return cachedRelayState }
    guard let sealed = try? Data(contentsOf: relayStateURL),
          let clear = try? HermesSecureKeychain.open(sealed),
          let object = try? JSONSerialization.jsonObject(with: clear),
          let state = object as? [String: Any] else { return [:] }
    cachedRelayState = state
    return state
  }

  private func isCollectionSuspendedUnlocked() -> Bool {
    loadRelayStateUnlocked()["collectionSuspended"] as? Bool ?? false
  }

  private func accountGenerationUnlocked() -> Int {
    loadRelayStateUnlocked()["accountGeneration"] as? Int ?? 0
  }

  @discardableResult
  private func persistRelayStateUnlocked(_ state: [String: Any]) -> Bool {
    guard JSONSerialization.isValidJSONObject(state),
          let clear = try? JSONSerialization.data(withJSONObject: state),
          let sealed = try? HermesSecureKeychain.seal(clear) else { return false }
    do {
      try sealed.write(
        to: relayStateURL,
        options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
      )
      try applyFileProtection(to: relayStateURL)
      cachedRelayState = state
      return true
    } catch {
      // Keep the last durable state cached; the caller can retry its mutation.
      return false
    }
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

  private func quarantineCorruptLinesUnlocked(_ data: Data) throws {
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let url = eventsURL.deletingLastPathComponent().appendingPathComponent(
      "pending-events-corrupt-\(digest.prefix(20)).encjsonl"
    )
    if !FileManager.default.fileExists(atPath: url.path) {
      try durableReplaceUnlocked(data, at: url)
    }
  }

  private func durableReplaceUnlocked(_ data: Data, at target: URL) throws {
    let directory = target.deletingLastPathComponent()
    let temporary = directory.appendingPathComponent(".\(target.lastPathComponent).\(UUID().uuidString).tmp")
    guard FileManager.default.createFile(atPath: temporary.path, contents: nil) else {
      throw HermesSecureStoreError.persistenceFailed
    }
    do {
      try applyFileProtection(to: temporary)
      let handle = try FileHandle(forWritingTo: temporary)
      do {
        try handle.write(contentsOf: data)
        try handle.synchronize()
        try handle.close()
      } catch {
        try? handle.close()
        throw error
      }
      if FileManager.default.fileExists(atPath: target.path) {
        _ = try FileManager.default.replaceItemAt(
          target,
          withItemAt: temporary,
          backupItemName: nil,
          options: []
        )
      } else {
        try FileManager.default.moveItem(at: temporary, to: target)
      }
      try applyFileProtection(to: target)
      try synchronizeDirectoryUnlocked(directory)
    } catch {
      try? FileManager.default.removeItem(at: temporary)
      throw error
    }
  }

  private func synchronizeDirectoryUnlocked(_ directory: URL) throws {
    let descriptor = Darwin.open(directory.path, O_RDONLY)
    guard descriptor >= 0 else { throw HermesSecureStoreError.persistenceFailed }
    defer { Darwin.close(descriptor) }
    guard Darwin.fsync(descriptor) == 0 else {
      throw HermesSecureStoreError.persistenceFailed
    }
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
  let accountGeneration: String
  let lifecycleEpoch: Int
  let outcome: HermesOwnerScopeDeletionOutcome
}

struct HermesOwnerIdentity: Equatable {
  let ownerScope: String
  let accountGeneration: String

  var isBound: Bool {
    !ownerScope.isEmpty && !accountGeneration.isEmpty
  }
}

enum HermesOwnerScopeDeletionOutcome: Equatable {
  case applied
  case rejectedStale
  case failed
}

struct HermesCollectorGenerationToken: Equatable, Sendable {
  let ownerScope: String
  let serverAccountGeneration: String
  let lifecycleEpoch: Int
  let startedAtMilliseconds: Double

  var accountUUID: String {
    Self.accountUUID(for: ownerScope)
  }

  var ownerID: String {
    let components = ownerScope.split(separator: "|", omittingEmptySubsequences: false)
    guard components.count >= 3 else { return "" }
    return String(components[components.count - 2])
  }

  func accepts(ownerID candidate: String, accountGeneration: String) -> Bool {
    !ownerID.isEmpty
      && ownerID.caseInsensitiveCompare(candidate.trimmingCharacters(in: .whitespacesAndNewlines))
        == .orderedSame
      && serverAccountGeneration == accountGeneration.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var regionNamespace: String {
    "app.hermes.\(Self.digest(ownerScope)).\(Self.digest(serverAccountGeneration)).\(lifecycleEpoch)"
  }

  func accepts(_ date: Date, futureSkew: TimeInterval = 60) -> Bool {
    let milliseconds = date.timeIntervalSince1970 * 1000
    return milliseconds.isFinite
      && milliseconds >= startedAtMilliseconds
      && date.timeIntervalSinceNow <= futureSkew
  }

  static func accountUUID(for ownerScope: String) -> String {
    let hex = SHA256.hash(data: Data(ownerScope.utf8))
      .map { String(format: "%02x", $0) }
      .joined()
    return "\(hex.prefix(8))-\(hex.dropFirst(8).prefix(4))-\(hex.dropFirst(12).prefix(4))-\(hex.dropFirst(16).prefix(4))-\(hex.dropFirst(20).prefix(12))"
  }

  private static func digest(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8))
      .prefix(8)
      .map { String(format: "%02x", $0) }
      .joined()
  }
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
