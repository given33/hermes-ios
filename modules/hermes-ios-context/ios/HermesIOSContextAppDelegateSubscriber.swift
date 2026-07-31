import CoreLocation
import CryptoKit
import ExpoModulesCore
import UIKit

public final class HermesIOSContextAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  private static let plaintextPreviewDirectory = "hermes-plaintext-previews-v1"
  private static let activeAtKey = "app.hermes.screen-time.active-at"
  private static let activeOwnerScopeKey = "app.hermes.screen-time.active-owner-scope"
  private static let activeAccountGenerationKey = "app.hermes.screen-time.active-account-generation"
  private static let activeLifecycleEpochKey = "app.hermes.screen-time.active-lifecycle-epoch"

  public func subscriberDidRegister() {
    Self.purgePlaintextPreviewCache()
    Self.configureQuickActions()
    HermesDiagnosticsService.shared.start()
    HermesBackgroundService.shared.register()
    resumePowerMonitoringIfEligible()
    resumeLocationIfEligible()
    _ = HermesHealthService.shared.resumeBackgroundCollection()
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    Self.recordScreenState("active")
    Self.configureQuickActions()
    HermesScreenTimeService.shared.consumeExtensionEvents()
    HermesBackgroundService.shared.schedule()
    resumePowerMonitoringIfEligible()
    resumeLocationIfEligible()
    _ = HermesHealthService.shared.resumeBackgroundCollection()
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    Self.recordScreenState("background")
    HermesSessionLockService.shared.applicationDidEnterBackground()
    HermesScreenTimeService.shared.consumeExtensionEvents()
    HermesBackgroundService.shared.schedule()
    resumeLocationIfEligible()
  }

  public func applicationWillResignActive(_ application: UIApplication) {
    Self.recordScreenState("inactive")
    HermesSessionLockService.shared.applicationDidEnterBackground()
  }

  public func applicationWillTerminate(_ application: UIApplication) {
    Self.recordScreenState("terminated")
    Self.purgePlaintextPreviewCache()
    HermesDeviceService.shared.stopMonitoringPowerChanges()
  }

  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    let accepted: Bool
    switch shortcutItem.type {
    case "app.hermes.quick.new-task":
      accepted = HermesAgentTriggerStore.shared.enqueue(kind: "quick-task", content: "Start a new Hermes task") != nil
    case "app.hermes.quick.voice-task":
      accepted = HermesAgentTriggerStore.shared.enqueue(kind: "voice-start", content: "Start a voice task") != nil
    case "app.hermes.quick.camera-task":
      accepted = HermesAgentTriggerStore.shared.enqueue(kind: "camera-task", content: "Take a photo and send it to Hermes for analysis") != nil
    default:
      accepted = false
    }
    completionHandler(accepted)
  }

  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    if let tombstone = Self.accountDeletionTombstone(userInfo) {
      let deletion = HermesAccountLifecycle.deleteOwnerScope(
        tombstone.ownerScope,
        accountGeneration: tombstone.accountGeneration,
        requestedAt: tombstone.requestedAt
      )
      switch deletion.outcome {
      case .applied:
        do {
          _ = try HermesAttachmentVault.shared.deleteKey(owner: tombstone.ownerScope)
          completionHandler(.newData)
        } catch {
          completionHandler(.failed)
        }
      case .rejectedStale:
        completionHandler(.noData)
      case .failed:
        completionHandler(.failed)
      }
      return
    }
    guard !HermesContextEventQueue.shared.isCollectionSuspended else {
      completionHandler(.noData)
      return
    }
    guard let fence = Self.notificationFence(userInfo),
          let token = HermesContextEventQueue.shared.currentCollectorGenerationToken(),
          token.accepts(ownerID: fence.ownerID, accountGeneration: fence.accountGeneration) else {
      completionHandler(.noData)
      return
    }
    let persisted = HermesContextEventQueue.shared.enqueue(type: "apns-wake", payload: [
      "receivedAt": Date().timeIntervalSince1970 * 1000,
      "eventKey": fence.eventKey,
      "userInfo": userInfo.reduce(into: [String: Any]()) { result, entry in
        result[String(describing: entry.key)] = hermesJSONSafe(entry.value)
      },
    ], accountGeneration: token.lifecycleEpoch, eventID: Self.apnsEventID(fence))
    guard persisted else {
      completionHandler(.failed)
      return
    }
    HermesBackgroundService.shared.schedule()
    HermesBackgroundService.shared.notifyRelayWake(reason: "remote-notification") { success in
      completionHandler(success ? .newData : .failed)
    }
  }

  public func application(
    _ application: UIApplication,
    performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    guard !HermesContextEventQueue.shared.isCollectionSuspended else {
      completionHandler(.noData)
      return
    }
    HermesBackgroundService.shared.schedule()
    HermesBackgroundService.shared.notifyRelayWake(reason: "background-fetch") { success in
      completionHandler(success ? .newData : .failed)
    }
    Task {
      _ = await HermesLocationService.shared.requestCurrent()
      _ = HermesDeviceService.shared.recordSnapshot()
    }
  }

  private func resumeLocationIfEligible() {
    guard !HermesContextEventQueue.shared.isCollectionSuspended else { return }
    guard HermesPermissionCollectionGate.shared.isReadyForCurrentOwner else { return }
    guard CLLocationManager().authorizationStatus == .authorizedAlways else { return }
    DispatchQueue.main.async {
      HermesLocationService.shared.start()
    }
  }

  private func resumePowerMonitoringIfEligible() {
    guard !HermesContextEventQueue.shared.isCollectionSuspended else { return }
    guard HermesContextEventQueue.shared.hasCurrentOwner else { return }
    HermesDeviceService.shared.startMonitoringPowerChanges()
  }

  private static func recordScreenState(_ state: String) {
    let now = Date().timeIntervalSince1970 * 1000
    let defaults = UserDefaults.standard
    let activeAt = defaults.double(forKey: activeAtKey)
    var payload: [String: Any] = [
      "state": state,
      "timestamp": now,
    ]
    if state == "active" {
      resetForegroundSessionForCurrentOwnerIfActive(startedAt: now)
    } else if activeAt > 0 {
      let storedOwnerScope = defaults.string(forKey: activeOwnerScopeKey) ?? ""
      let storedAccountGeneration = defaults.string(forKey: activeAccountGenerationKey) ?? ""
      let storedLifecycleEpoch = defaults.integer(forKey: activeLifecycleEpochKey)
      clearForegroundSession()
      if let token = HermesContextEventQueue.shared.currentCollectorGenerationToken(),
         token.ownerScope == storedOwnerScope,
         token.serverAccountGeneration == storedAccountGeneration,
         token.lifecycleEpoch == storedLifecycleEpoch {
        payload["foregroundDurationSeconds"] = max(0, (now - activeAt) / 1000)
      }
    }
    HermesContextEventQueue.shared.enqueue(type: "screen-time", payload: payload)
  }

  static func resetForegroundSessionForCurrentOwnerIfActive(
    startedAt: Double = Date().timeIntervalSince1970 * 1000
  ) {
    clearForegroundSession()
    guard UIApplication.shared.applicationState == .active,
          let token = HermesContextEventQueue.shared.currentCollectorGenerationToken() else {
      return
    }
    let defaults = UserDefaults.standard
    defaults.set(startedAt, forKey: activeAtKey)
    defaults.set(token.ownerScope, forKey: activeOwnerScopeKey)
    defaults.set(token.serverAccountGeneration, forKey: activeAccountGenerationKey)
    defaults.set(token.lifecycleEpoch, forKey: activeLifecycleEpochKey)
  }

  static func clearForegroundSession() {
    let defaults = UserDefaults.standard
    defaults.removeObject(forKey: activeAtKey)
    defaults.removeObject(forKey: activeOwnerScopeKey)
    defaults.removeObject(forKey: activeAccountGenerationKey)
    defaults.removeObject(forKey: activeLifecycleEpochKey)
  }

  private static func purgePlaintextPreviewCache() {
    guard let cacheDirectory = FileManager.default.urls(
      for: .cachesDirectory,
      in: .userDomainMask
    ).first else { return }
    let previewDirectory = cacheDirectory.appendingPathComponent(
      plaintextPreviewDirectory,
      isDirectory: true
    )
    try? FileManager.default.removeItem(at: previewDirectory)
  }

  private static func configureQuickActions() {
    UIApplication.shared.shortcutItems = [
      UIApplicationShortcutItem(
        type: "app.hermes.quick.new-task",
        localizedTitle: "New Hermes task",
        localizedSubtitle: "Start a fresh agent task",
        icon: UIApplicationShortcutIcon(systemImageName: "plus.message"),
        userInfo: nil
      ),
      UIApplicationShortcutItem(
        type: "app.hermes.quick.voice-task",
        localizedTitle: "Voice task",
        localizedSubtitle: "Record and send to Hermes",
        icon: UIApplicationShortcutIcon(systemImageName: "mic.fill"),
        userInfo: nil
      ),
      UIApplicationShortcutItem(
        type: "app.hermes.quick.camera-task",
        localizedTitle: "Camera task",
        localizedSubtitle: "Capture and analyze a photo",
        icon: UIApplicationShortcutIcon(systemImageName: "camera.fill"),
        userInfo: nil
      ),
    ]
  }

  private static func accountDeletionTombstone(
    _ userInfo: [AnyHashable: Any]
  ) -> (ownerScope: String, accountGeneration: String, requestedAt: Double)? {
    guard let hermes = userInfo["hermes"] as? [String: Any],
          hermes["category"] as? String == "account-deletion",
          let data = hermes["data"] as? [String: Any],
          data["action"] as? String == "delete-account-data",
          let ownerScope = data["owner_scope"] as? String,
          let accountGeneration = data["account_generation"] as? String,
          let requestedAt = normalizedEpochMilliseconds(data["requested_at"]),
          let validUntil = normalizedEpochMilliseconds(data["valid_until"]),
          requestedAt <= validUntil,
          validUntil > Date().timeIntervalSince1970 * 1000 else {
      return nil
    }
    let normalized = ownerScope.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedGeneration = accountGeneration.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.isEmpty || normalizedGeneration.isEmpty
      ? nil
      : (normalized, normalizedGeneration, requestedAt)
  }

  private static func notificationFence(
    _ userInfo: [AnyHashable: Any]
  ) -> (ownerID: String, accountGeneration: String, eventKey: String)? {
    guard let hermes = userInfo["hermes"] as? [String: Any],
          let ownerID = boundedAPNSIdentifier(hermes["owner_id"]),
          let accountGeneration = boundedAPNSIdentifier(hermes["account_generation"]),
          let eventKey = boundedAPNSIdentifier(hermes["event_key"]) else {
      return nil
    }
    if let data = hermes["data"] as? [String: Any],
       data["valid_until"] != nil,
       let validUntil = normalizedEpochMilliseconds(data["valid_until"]),
       validUntil <= Date().timeIntervalSince1970 * 1000 {
      return nil
    }
    return (ownerID, accountGeneration, eventKey)
  }

  private static func apnsEventID(
    _ fence: (ownerID: String, accountGeneration: String, eventKey: String)
  ) -> String {
    let source = "\(fence.ownerID)\0\(fence.accountGeneration)\0\(fence.eventKey)"
    let digest = SHA256.hash(data: Data(source.utf8))
      .map { String(format: "%02x", $0) }
      .joined()
    return "apns-wake:\(digest)"
  }
}

private func boundedAPNSIdentifier(_ value: Any?) -> String? {
  guard let value = value as? String else { return nil }
  let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !normalized.isEmpty,
        normalized.count <= 256,
        normalized.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value != 127 }) else {
    return nil
  }
  return normalized
}

private func normalizedEpochMilliseconds(_ value: Any?) -> Double? {
  let number: Double
  if let value = value as? NSNumber {
    number = value.doubleValue
  } else if let value = value as? Double {
    number = value
  } else if let value = value as? Int {
    number = Double(value)
  } else {
    return nil
  }
  guard number.isFinite, number > 0 else { return nil }
  return number > 10_000_000_000 ? number : number * 1000
}

private func hermesJSONSafe(_ value: Any) -> Any {
  if value is NSNull || value is String || value is NSNumber { return value }
  if let dictionary = value as? [AnyHashable: Any] {
    return dictionary.reduce(into: [String: Any]()) { result, entry in
      result[String(describing: entry.key)] = hermesJSONSafe(entry.value)
    }
  }
  if let array = value as? [Any] { return array.map(hermesJSONSafe) }
  return String(describing: value)
}
