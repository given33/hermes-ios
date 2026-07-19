import Foundation

final class HermesPermissionCollectionGate {
  static let shared = HermesPermissionCollectionGate()

  private let defaults = UserDefaults.standard
  private let generationKey = "app.hermes.permissions.ready-generation"
  private let readyKey = "app.hermes.permissions.ready"
  private let scopeKey = "app.hermes.permissions.ready-scope"

  private init() {}

  func prepare(ownerScope: String) {
    let scope = ownerScope.trimmingCharacters(in: .whitespacesAndNewlines)
    guard defaults.string(forKey: scopeKey) == scope,
          defaults.integer(forKey: generationKey) == HermesContextEventQueue.shared.accountGeneration else {
      defaults.set(false, forKey: readyKey)
      return
    }
  }

  func setReady(_ ready: Bool, ownerScope: String) {
    let scope = ownerScope.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !scope.isEmpty else {
      defaults.set(false, forKey: readyKey)
      return
    }
    defaults.set(scope, forKey: scopeKey)
    defaults.set(HermesContextEventQueue.shared.accountGeneration, forKey: generationKey)
    defaults.set(ready, forKey: readyKey)
  }

  var isReadyForCurrentOwner: Bool {
    guard defaults.bool(forKey: readyKey),
          let scope = defaults.string(forKey: scopeKey),
          defaults.integer(forKey: generationKey) == HermesContextEventQueue.shared.accountGeneration else {
      return false
    }
    return HermesContextEventQueue.shared.isCurrentOwnerScope(scope)
  }
}
