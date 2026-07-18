import Foundation
import UIKit

final class HermesDeviceService {
  static let shared = HermesDeviceService()

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
