import CoreLocation
import ExpoModulesCore
import UIKit

public final class HermesIOSContextAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  private static let activeAtKey = "app.hermes.screen-time.active-at"

  public func subscriberDidRegister() {
    HermesBackgroundService.shared.register()
    resumePowerMonitoringIfEligible()
    resumeLocationIfEligible()
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    Self.recordScreenState("active")
    HermesScreenTimeService.shared.consumeExtensionEvents()
    HermesBackgroundService.shared.schedule()
    resumePowerMonitoringIfEligible()
    resumeLocationIfEligible()
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    Self.recordScreenState("background")
    HermesScreenTimeService.shared.consumeExtensionEvents()
    HermesBackgroundService.shared.schedule()
    resumeLocationIfEligible()
  }

  public func applicationWillResignActive(_ application: UIApplication) {
    Self.recordScreenState("inactive")
  }

  public func applicationWillTerminate(_ application: UIApplication) {
    HermesDeviceService.shared.stopMonitoringPowerChanges()
  }

  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    if let ownerScope = Self.accountDeletionOwnerScope(userInfo) {
      _ = HermesAccountLifecycle.deleteOwnerScope(ownerScope)
      completionHandler(.newData)
      return
    }
    guard !HermesContextEventQueue.shared.isCollectionSuspended else {
      completionHandler(.noData)
      return
    }
    HermesContextEventQueue.shared.enqueue(type: "apns-wake", payload: [
      "receivedAt": Date().timeIntervalSince1970 * 1000,
      "userInfo": userInfo.reduce(into: [String: Any]()) { result, entry in
        result[String(describing: entry.key)] = hermesJSONSafe(entry.value)
      },
    ])
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
      defaults.set(now, forKey: activeAtKey)
    } else if activeAt > 0 {
      payload["foregroundDurationSeconds"] = max(0, (now - activeAt) / 1000)
      if state == "background" { defaults.removeObject(forKey: activeAtKey) }
    }
    HermesContextEventQueue.shared.enqueue(type: "screen-time", payload: payload)
  }

  private static func accountDeletionOwnerScope(
    _ userInfo: [AnyHashable: Any]
  ) -> String? {
    guard let hermes = userInfo["hermes"] as? [String: Any],
          hermes["category"] as? String == "account-deletion",
          let data = hermes["data"] as? [String: Any],
          data["action"] as? String == "delete-account-data",
          let ownerScope = data["owner_scope"] as? String else {
      return nil
    }
    let normalized = ownerScope.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.isEmpty ? nil : normalized
  }
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
