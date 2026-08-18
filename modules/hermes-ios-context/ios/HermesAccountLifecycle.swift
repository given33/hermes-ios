import Foundation

enum HermesAccountLifecycle {
  private static let lifecycleLock = NSLock()

  @discardableResult
  static func activateOwnerScope(
    _ ownerScope: String,
    accountGeneration: String
  ) -> Int {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    let generation = HermesContextEventQueue.shared.activateOwnerScope(
      ownerScope,
      accountGeneration: accountGeneration
    )
    let activeIdentity = HermesContextEventQueue.shared.currentOwnerIdentity
    HermesAgentTriggerStore.shared.discardMismatched(
      ownerScope: activeIdentity.ownerScope,
      accountGeneration: activeIdentity.accountGeneration
    )
    // Publish the now-active identity so out-of-process producers (Share
    // Extension) stamp account-bound queue entries at write time.
    HermesAgentTriggerStore.refreshOwnerHint()
    HermesTaskControlStore.shared.discardMismatched(
      ownerScope: activeIdentity.ownerScope,
      accountGeneration: activeIdentity.accountGeneration
    )
    HermesIOSContextAppDelegateSubscriber.resetForegroundSessionForCurrentOwnerIfActive()
    if let token = HermesContextEventQueue.shared.currentCollectorGenerationToken() {
      HermesLocationService.shared.activateAccountGeneration(token)
      HermesMotionService.shared.activateAccountGeneration(token)
      HermesHealthService.shared.activateAccountGeneration(token)
    }
    HermesScreenTimeService.shared.setAccountGeneration(
      generation,
      serverAccountGeneration: accountGeneration
    )
    if let token = HermesContextEventQueue.shared.currentCollectorGenerationToken() {
      HermesWatchService.shared.activateAccountGeneration(token)
    }
    HermesDeviceService.shared.startMonitoringPowerChanges()
    return generation
  }

  static func captureCollectorGeneration() -> HermesCollectorGenerationToken? {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    return HermesContextEventQueue.shared.currentCollectorGenerationToken()
  }

  @discardableResult
  static func performIfCurrentCollectorGeneration(
    _ token: HermesCollectorGenerationToken,
    _ operation: () -> Void
  ) -> Bool {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    guard HermesContextEventQueue.shared.isCurrentCollectorGenerationToken(token) else {
      return false
    }
    operation()
    return true
  }

  @discardableResult
  static func deleteOwnerScope(
    _ ownerScope: String,
    accountGeneration: String,
    requestedAt: Double? = nil
  ) -> HermesOwnerScopeDeletionResult {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    let queue = HermesContextEventQueue.shared
    let deletion = queue.deleteOwnerScope(
      ownerScope,
      accountGeneration: accountGeneration,
      requestedAt: requestedAt
    )
    guard deletion.deletedWasCurrent else { return deletion }

    // App Intents and Live Activity controls are account-scoped durable work.
    // Delete them with the owner boundary so a later login cannot replay an
    // old session ID under a new account.
    HermesAgentTriggerStore.shared.clear()
    HermesTaskControlStore.shared.clear()

    HermesLocationService.shared.resetAccountState()
    HermesMotionService.shared.resetAccountState()
    HermesHealthService.shared.resetAccountState()
    HermesDeviceService.shared.stopMonitoringPowerChanges()
    HermesScreenTimeService.shared.stopAllMonitoring(
      accountGeneration: deletion.lifecycleEpoch
    )
    HermesBackgroundService.shared.cancelScheduledTasks()
    HermesWatchService.shared.resetAccountState(
      ownerScope: ownerScope,
      accountGeneration: deletion.lifecycleEpoch,
      serverAccountGeneration: deletion.accountGeneration
    )
    HermesIOSContextAppDelegateSubscriber.clearForegroundSession()
    Task {
      guard queue.accountGeneration == deletion.lifecycleEpoch else { return }
      _ = await HermesWatchService.shared.send(payload: [
        "accountGeneration": deletion.lifecycleEpoch,
        "account_generation": deletion.accountGeneration,
        "action": "reset-account-generation",
        "controlIssuedAt": Date().timeIntervalSince1970 * 1000,
      ])
      guard queue.accountGeneration == deletion.lifecycleEpoch else { return }
      await HermesLiveActivityService.shared.endAll()
    }
    return deletion
  }
}
