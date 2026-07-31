import Foundation
import LocalAuthentication

final class HermesSessionLockService {
  static let shared = HermesSessionLockService()

  private let lock = NSLock()
  private var ownerScope = ""
  private var enabled = false
  private var locked = false
  private var timeout: TimeInterval = 5 * 60
  private var lastUnlockAt: Date?

  private init() {}

  func configure(owner: String, enabled requestedEnabled: Bool, timeoutMinutes: Double?) -> [String: Any] {
    let normalized = owner.trimmingCharacters(in: .whitespacesAndNewlines)
    lock.lock()
    defer { lock.unlock() }
    if ownerScope != normalized {
      ownerScope = normalized
      lastUnlockAt = nil
      locked = false
    }
    enabled = requestedEnabled
    if let timeoutMinutes, timeoutMinutes.isFinite {
      timeout = min(max(timeoutMinutes * 60, 60), 24 * 60 * 60)
    }
    if !enabled { locked = false }
    return statusUnlocked()
  }

  func status(owner: String) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    guard ownerScope == owner.trimmingCharacters(in: .whitespacesAndNewlines) else {
      return ["enabled": false, "locked": false, "available": false]
    }
    expireIfNeeded()
    return statusUnlocked()
  }

  func lockSession(owner: String) -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    guard ownerScope == owner.trimmingCharacters(in: .whitespacesAndNewlines), enabled else {
      return statusUnlocked()
    }
    locked = true
    lastUnlockAt = nil
    return statusUnlocked()
  }

  func unlock(owner: String) async throws -> [String: Any] {
    let normalized = owner.trimmingCharacters(in: .whitespacesAndNewlines)
    lock.lock()
    guard ownerScope == normalized, enabled else {
      lock.unlock()
      return ["enabled": false, "locked": false, "unlocked": false]
    }
    lock.unlock()
    let context = LAContext()
    context.localizedCancelTitle = "Use password"
    let reason = "Unlock Hermes to view this session"
    let success = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
      context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, error in
        if let error { continuation.resume(throwing: error) }
        else { continuation.resume(returning: success) }
      }
    }
    guard success else { throw HermesSessionLockError.rejected }
    lock.lock()
    defer { lock.unlock() }
    guard ownerScope == normalized else { throw HermesSessionLockError.staleOwner }
    locked = false
    lastUnlockAt = Date()
    return statusUnlocked()
  }

  func applicationDidEnterBackground() {
    lock.lock()
    defer { lock.unlock() }
    if enabled && !ownerScope.isEmpty {
      locked = true
      lastUnlockAt = nil
    }
  }

  private func expireIfNeeded() {
    if enabled, let lastUnlockAt, Date().timeIntervalSince(lastUnlockAt) > timeout {
      locked = true
      self.lastUnlockAt = nil
    }
  }

  private func statusUnlocked() -> [String: Any] {
    [
      "enabled": enabled,
      "locked": enabled && locked,
      "available": true,
      "timeoutSeconds": timeout,
    ]
  }
}

private enum HermesSessionLockError: LocalizedError {
  case rejected
  case staleOwner

  var errorDescription: String? {
    switch self {
    case .rejected: return "Hermes session unlock was rejected."
    case .staleOwner: return "Hermes session owner changed while unlocking."
    }
  }
}
