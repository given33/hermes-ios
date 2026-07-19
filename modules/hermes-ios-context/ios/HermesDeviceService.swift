import Foundation
import UIKit

final class HermesDeviceService {
  static let shared = HermesDeviceService()

  private var powerObservers: [NSObjectProtocol] = []

  func startMonitoringPowerChanges() {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in self?.startMonitoringPowerChanges() }
      return
    }
    guard powerObservers.isEmpty else { return }

    UIDevice.current.isBatteryMonitoringEnabled = true
    let center = NotificationCenter.default
    let notifications: [(Notification.Name, String)] = [
      (UIDevice.batteryStateDidChangeNotification, "battery-state"),
      (UIDevice.batteryLevelDidChangeNotification, "battery-level"),
      (Notification.Name.NSProcessInfoPowerStateDidChange, "low-power-mode"),
    ]
    powerObservers = notifications.map { name, reason in
      center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.recordPowerChange(reason: reason)
      }
    }
  }

  func stopMonitoringPowerChanges() {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in self?.stopMonitoringPowerChanges() }
      return
    }
    let center = NotificationCenter.default
    powerObservers.forEach { center.removeObserver($0) }
    powerObservers.removeAll()
    UIDevice.current.isBatteryMonitoringEnabled = false
  }

  func snapshot() -> [String: Any] {
    let device = UIDevice.current
    device.isBatteryMonitoringEnabled = true
    var payload: [String: Any] = [
      "batteryLevel": hermesNullable(device.batteryLevel < 0 ? nil : Double(device.batteryLevel)),
      "batteryState": HermesPower.batteryState(device.batteryState),
      "deviceName": device.name,
      "deviceModel": device.model,
      "deviceType": device.userInterfaceIdiom == .pad ? "ipad" : "iphone",
      "isProtectedDataAvailable": UIApplication.shared.isProtectedDataAvailable,
      "locale": Locale.autoupdatingCurrent.identifier,
      "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
      "osName": device.systemName,
      "osVersion": device.systemVersion,
      "screenBrightness": UIScreen.main.brightness,
      "thermalState": thermalState(ProcessInfo.processInfo.thermalState),
      "timeZone": TimeZone.autoupdatingCurrent.identifier,
      "userInterfaceStyle": UIScreen.main.traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
    ]
    if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
      payload["appVersion"] = version
    }
    if let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String {
      payload["appBuild"] = build
    }
    if let values = try? URL(fileURLWithPath: NSHomeDirectory()).resourceValues(
      forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey]
    ) {
      payload["availableDiskBytes"] = hermesNullable(values.volumeAvailableCapacityForImportantUsage)
      payload["totalDiskBytes"] = hermesNullable(values.volumeTotalCapacity)
    }
    return payload
  }

  func recordSnapshot() -> [String: Any] {
    let payload = snapshot()
    HermesContextEventQueue.shared.enqueue(type: "device", payload: payload)
    return payload
  }

  @discardableResult
  func recordPowerChange(reason: String) -> [String: Any] {
    var payload = snapshot()
    payload["changeReason"] = reason
    payload["observedAt"] = Date().timeIntervalSince1970 * 1000
    HermesContextEventQueue.shared.enqueue(type: "power", payload: payload)
    HermesContextEventQueue.shared.enqueue(type: "device", payload: payload)
    return payload
  }

  func openAppSettings() -> Bool {
    guard let url = URL(string: UIApplication.openSettingsURLString),
          UIApplication.shared.canOpenURL(url) else { return false }
    UIApplication.shared.open(url)
    return true
  }

  private func thermalState(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }
}
