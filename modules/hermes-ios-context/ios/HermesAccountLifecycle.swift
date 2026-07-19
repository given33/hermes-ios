import Foundation

enum HermesAccountLifecycle {
  private static let lifecycleLock = NSLock()

  @discardableResult
  static func activateOwnerScope(_ ownerScope: String) -> Int {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    let generation = HermesContextEventQueue.shared.activateOwnerScope(ownerScope)
    HermesScreenTimeService.shared.setAccountGeneration(generation)
    HermesWatchService.shared.activateAccountGeneration(generation)
    HermesDeviceService.shared.startMonitoringPowerChanges()
    return generation
  }

  @discardableResult
  static func deleteOwnerScope(_ ownerScope: String) -> Int {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    let queue = HermesContextEventQueue.shared
    let deletion = queue.deleteOwnerScope(ownerScope)
    guard deletion.deletedWasCurrent else { return deletion.deletedCount }

    HermesLocationService.shared.resetAccountState()
    HermesMotionService.shared.resetAccountState()
    HermesDeviceService.shared.stopMonitoringPowerChanges()
    HermesScreenTimeService.shared.stopAllMonitoring(
      accountGeneration: deletion.accountGeneration
    )
    HermesBackgroundService.shared.cancelScheduledTasks()
    HermesWatchService.shared.resetAccountState(
      accountGeneration: deletion.accountGeneration
    )
    UserDefaults.standard.removeObject(forKey: "app.hermes.screen-time.active-at")
    Task {
      guard queue.accountGeneration == deletion.accountGeneration else { return }
      _ = await HermesWatchService.shared.send(payload: [
        "accountGeneration": deletion.accountGeneration,
        "action": "stop-active-relay",
      ])
      guard queue.accountGeneration == deletion.accountGeneration else { return }
      await HermesLiveActivityService.shared.endAll()
    }
    return deletion.deletedCount
  }
}
