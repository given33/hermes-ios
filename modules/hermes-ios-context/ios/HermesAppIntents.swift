import AppIntents
import Foundation

struct HermesRefreshContextIntent: AppIntent {
  static var title: LocalizedStringResource = "Refresh Hermes context"
  static var description = IntentDescription("Collect a current location and device context snapshot.")
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    guard HermesPermissionCollectionGate.shared.isReadyForCurrentOwner else { return .result() }
    _ = await HermesLocationService.shared.requestCurrent()
    _ = HermesDeviceService.shared.recordSnapshot()
    return .result()
  }
}

struct HermesCurrentLocationIntent: AppIntent {
  static var title: LocalizedStringResource = "Get Hermes location"
  static var description = IntentDescription("Refresh the current iPhone location for Hermes.")
  static var openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    guard HermesPermissionCollectionGate.shared.isReadyForCurrentOwner else { return .result() }
    _ = await HermesLocationService.shared.requestCurrent()
    return .result()
  }
}
