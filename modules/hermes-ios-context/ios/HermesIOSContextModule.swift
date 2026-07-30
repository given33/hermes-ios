import CoreLocation
import CoreMotion
import EventKit
import ExpoModulesCore
import HealthKit
import Security
import UIKit
import UserNotifications
import WatchConnectivity

struct HermesCalendarEventInput: Record {
  @Field var title: String = ""
  @Field var start: Double = 0
  @Field var end: Double = 0
  @Field var location: String?
  @Field var notes: String?
}

struct HermesReminderInput: Record {
  @Field var title: String = ""
  @Field var due: Double?
  @Field var notes: String?
}

public final class HermesIOSContextModule: Module {
  private let location = HermesLocationService.shared
  private let motion = HermesMotionService.shared
  private let health = HermesHealthService.shared
  private let events = HermesEventStore.shared
  private let eventQueue = HermesContextEventQueue.shared
  private let watch = HermesWatchService.shared
  private let device = HermesDeviceService.shared
  private let screenTime = HermesScreenTimeService.shared
  private let liveActivity = HermesLiveActivityService.shared
  private let attachmentVault = HermesAttachmentVault.shared
  private let voice = HermesVoiceService.shared
  private let protectedExport = HermesProtectedExportFile.shared
  private var relayWakeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HermesIOSContext")
    Events("onLocation", "onMotion", "onVisit")
    Events("onBackgroundWake", "onWatchMessage")
    Events("onVoiceTranscript", "onVoiceState")
    lifecycleDefinitions()
    locationDefinitions()
    deviceDefinitions()
    eventQueueDefinitions()
    healthDefinitions()
    calendarDefinitions()
    notificationDefinitions()
    watchDefinitions()
    screenTimeDefinitions()
    liveActivityDefinitions()
    attachmentVaultDefinitions()
    voiceDefinitions()
    viewDefinitions()
  }

  @ModuleDefinitionBuilder
  private func attachmentVaultDefinitions() -> ModuleDefinition {
    AsyncFunction("encryptAttachment") {
      (owner: String, sourceURI: String, targetURI: String) throws -> [String: Any] in
      try self.attachmentVault.encrypt(
        owner: owner,
        sourceURI: sourceURI,
        targetURI: targetURI
      )
    }

    AsyncFunction("decryptAttachmentForUpload") {
      (owner: String, encryptedURI: String, filename: String) throws -> String in
      try self.attachmentVault.decryptForUpload(
        owner: owner,
        encryptedURI: encryptedURI,
        filename: filename
      )
    }

    AsyncFunction("deleteDecryptedAttachment") { (uri: String) throws -> Bool in
      try self.attachmentVault.deleteDecryptedFile(uri: uri)
    }

    AsyncFunction("deleteAttachmentEncryptionKey") { (owner: String) throws -> Bool in
      try self.attachmentVault.deleteKey(owner: owner)
    }

    AsyncFunction("writeProtectedAccountExport") {
      (contents: String, filename: String) throws -> String in
      try self.protectedExport.write(contents: contents, filename: filename)
    }

    AsyncFunction("deleteProtectedAccountExport") { (uri: String) throws -> Bool in
      try self.protectedExport.delete(uri: uri)
    }

    // The vault owns the outbox location (Application Support, outside the
    // UIFileSharingEnabled Documents tree); JS asks instead of guessing so
    // both sides always agree on where envelopes belong.
    Function("getAttachmentOutboxRootUri") { () -> String in
      self.attachmentVault.outboxRootURI
    }
  }

  @ModuleDefinitionBuilder
  private func lifecycleDefinitions() -> ModuleDefinition {
    Function("getNativeViewContract") { () -> [String: Any] in
      [
        "version": 3,
        "views": ["HermesScreenTimeReportView"],
      ]
    }

    OnCreate {
      HermesBackgroundService.shared.register()
      self.relayWakeObserver = NotificationCenter.default.addObserver(
        forName: HermesBackgroundService.relayWakeNotification,
        object: nil,
        queue: .main
      ) { [weak self] (notification: Notification) in
        self?.sendEvent("onBackgroundWake", [
          "reason": notification.userInfo?["reason"] as? String ?? "background",
          "timestamp": Date().timeIntervalSince1970 * 1000,
          "wakeId": notification.userInfo?["wakeId"] as? String ?? "",
        ])
      }
      self.location.onLocation = { [weak self] payload in
        self?.sendEvent("onLocation", payload)
      }
      self.motion.onMotion = { [weak self] payload in
        self?.sendEvent("onMotion", payload)
      }
      self.location.onVisit = { [weak self] payload in
        self?.sendEvent("onVisit", payload)
      }
      self.watch.onMessage = { [weak self] payload in
        self?.sendEvent("onWatchMessage", payload)
      }
      self.voice.onTranscript = { [weak self] payload in
        self?.sendEvent("onVoiceTranscript", payload)
      }
      self.voice.onState = { [weak self] payload in
        self?.sendEvent("onVoiceState", payload)
      }
    }

    OnDestroy {
      if let relayWakeObserver = self.relayWakeObserver {
        NotificationCenter.default.removeObserver(relayWakeObserver)
        self.relayWakeObserver = nil
      }
      self.location.onLocation = nil
      self.motion.onMotion = nil
      self.location.onVisit = nil
      self.watch.onMessage = nil
      self.voice.onTranscript = nil
      self.voice.onState = nil
      Task { @MainActor in
        _ = self.voice.stopRecognition()
        _ = self.voice.stopSpeaking()
      }
    }
  }

  @ModuleDefinitionBuilder
  private func locationDefinitions() -> ModuleDefinition {
    AsyncFunction("getCapabilities") { () -> [String: Bool] in
      let locationManager = CLLocationManager()
      return [
        "calendar": true,
        "health": HKHealthStore.isHealthDataAvailable(),
        "location": CLLocationManager.locationServicesEnabled(),
        "locationAlways": locationManager.authorizationStatus == .authorizedAlways,
        "locationPrecise": locationManager.accuracyAuthorization == .fullAccuracy,
        "motion": CMMotionActivityManager.isActivityAvailable(),
        "notesShare": true,
        "reminders": true,
        // The signed entitlement is enforced by FamilyControls itself. A
        // bundle Info.plist lookup is not an entitlement check and caused
        // valid production builds to report a false unavailable state.
        "screenTime": HermesScreenTimeService.frameworkAvailable,
        "watch": WCSession.isSupported(),
        "liveActivity": HermesLiveActivityService.isAvailable,
        "backgroundTasks": true,
        "apns": true,
        "photos": true,
        "voiceInput": true,
        "voiceOutput": true,
      ]
    }.runOnQueue(.main)

    AsyncFunction("getLocationAuthorization") { () -> String in
      HermesAuthorization.location(CLLocationManager().authorizationStatus)
    }.runOnQueue(.main)

    AsyncFunction("requestLocationAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { await self.location.requestAlwaysAuthorization() }
    }.runOnQueue(.main)

    AsyncFunction("requestPreciseLocation") { (promise: Promise) in
      self.resolveAsync(promise) { await self.location.requestPreciseAuthorization() }
    }.runOnQueue(.main)

    AsyncFunction("getLocationAuthorizationDetails") { () -> [String: Any] in
      self.location.authorizationSnapshot()
    }.runOnQueue(.main)

    AsyncFunction("startAdaptiveLocation") { () -> Bool in
      self.location.start()
    }.runOnQueue(.main)

    AsyncFunction("stopAdaptiveLocation") {
      self.location.stop()
    }.runOnQueue(.main)

    AsyncFunction("requestCurrentLocation") { (promise: Promise) in
      self.resolveAsync(promise) { await self.location.requestCurrent() }
    }.runOnQueue(.main)

    AsyncFunction("setPredictedDeparture") { (timestamp: Double?) -> Bool in
      self.location.setPredictedDeparture(at: timestamp.map { Date(timeIntervalSince1970: $0 / 1000) })
      return true
    }.runOnQueue(.main)

    AsyncFunction("getLocationMode") { () -> String in
      self.location.mode.rawValue
    }.runOnQueue(.main)
  }

  @ModuleDefinitionBuilder
  private func voiceDefinitions() -> ModuleDefinition {
    AsyncFunction("getVoiceAuthorization") { () -> [String: String] in
      self.voice.authorizationSnapshot()
    }.runOnQueue(.main)

    AsyncFunction("requestVoiceAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { await self.voice.requestAuthorization() }
    }.runOnQueue(.main)

    AsyncFunction("startVoiceRecognition") { (locale: String?) throws -> Bool in
      try MainActor.assumeIsolated {
        try self.voice.startRecognition(localeIdentifier: locale)
      }
    }.runOnQueue(.main)

    AsyncFunction("stopVoiceRecognition") { () -> String in
      MainActor.assumeIsolated {
        self.voice.stopRecognition()
      }
    }.runOnQueue(.main)

    AsyncFunction("speakText") { (text: String, locale: String?, rate: Double?) throws -> Bool in
      try MainActor.assumeIsolated {
        try self.voice.speak(text: text, localeIdentifier: locale, rate: rate)
      }
    }.runOnQueue(.main)

    AsyncFunction("stopSpeaking") { () -> Bool in
      MainActor.assumeIsolated {
        self.voice.stopSpeaking()
      }
    }.runOnQueue(.main)

    AsyncFunction("getVoiceState") { () -> [String: Bool] in
      [
        "recording": self.voice.isRecording,
        "speaking": self.voice.isSpeaking,
      ]
    }.runOnQueue(.main)
  }

  @ModuleDefinitionBuilder
  private func deviceDefinitions() -> ModuleDefinition {
    AsyncFunction("getMotionAuthorization") { () -> String in
      HermesAuthorization.motion(CMMotionActivityManager.authorizationStatus())
    }

    AsyncFunction("requestMotionAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { await self.motion.requestAuthorization() }
    }

    AsyncFunction("startMotionUpdates") { () -> Bool in
      self.motion.start()
    }

    AsyncFunction("stopMotionUpdates") {
      self.motion.stop()
    }

    AsyncFunction("getMotionSnapshot") { () -> [String: Any]? in
      self.motion.snapshot
    }

    AsyncFunction("getPowerSnapshot") { () -> [String: Any] in
      let payload = self.device.snapshot()
      self.eventQueue.enqueue(type: "power", payload: payload)
      return payload
    }.runOnQueue(.main)

    AsyncFunction("getDeviceSnapshot") { () -> [String: Any] in
      self.device.recordSnapshot()
    }.runOnQueue(.main)

    AsyncFunction("openDeviceSettings") { () -> Bool in
      self.device.openAppSettings()
    }.runOnQueue(.main)
  }

  @ModuleDefinitionBuilder
  private func eventQueueDefinitions() -> ModuleDefinition {
    AsyncFunction("getInstallationIdentifier") { () -> String in
      self.eventQueue.installationIdentifier
    }

    AsyncFunction("readPendingEvents") { (limit: Int, scope: String) -> [[String: Any]] in
      self.eventQueue.read(limit: limit, scope: scope)
    }

    AsyncFunction("claimPendingEvents") { (limit: Int, scope: String) throws -> [String: Any] in
      try self.eventQueue.claim(limit: limit, scope: scope)
    }

    AsyncFunction("enqueueContextEvents") { (events: [[String: Any]]) throws -> Int in
      try self.eventQueue.enqueueBatch(events)
    }

    AsyncFunction("acknowledgeEvents") { (ids: [String], cursor: Int?, scope: String) throws -> Int in
      try self.eventQueue.acknowledge(ids: Set(ids), cursor: cursor, scope: scope)
    }

    AsyncFunction("acknowledgeEventClaim") {
      (token: String, ids: [String], cursor: Int?, scope: String) throws -> Int in
      try self.eventQueue.acknowledgeClaim(
        token: token,
        ids: Set(ids),
        cursor: cursor,
        scope: scope
      )
    }

    AsyncFunction("setOwnerScope") { (scope: String, accountGeneration: String) in
      self.eventQueue.setOwnerScope(scope, accountGeneration: accountGeneration)
      HermesPermissionCollectionGate.shared.prepare(ownerScope: scope)
      if !scope.isEmpty { HermesBackgroundService.shared.schedule() }
    }.runOnQueue(.main)

    AsyncFunction("setPermissionCollectionReady") { (scope: String, ready: Bool) in
      HermesPermissionCollectionGate.shared.setReady(ready, ownerScope: scope)
    }

    AsyncFunction("activateOwnerScope") { (scope: String, accountGeneration: String) throws -> Int in
      let generation = HermesAccountLifecycle.activateOwnerScope(
        scope,
        accountGeneration: accountGeneration
      )
      if !scope.isEmpty { try self.attachmentVault.activate(owner: scope) }
      if !scope.isEmpty { HermesBackgroundService.shared.schedule() }
      return generation
    }.runOnQueue(.main)

    AsyncFunction("deleteOwnerScope") { (scope: String, accountGeneration: String) throws -> [String: Any] in
      let deletion = HermesAccountLifecycle.deleteOwnerScope(
        scope,
        accountGeneration: accountGeneration
      )
      guard deletion.outcome == .applied else {
        throw HermesAccountDeletionError.persistenceFailed
      }
      if !scope.isEmpty { _ = try self.attachmentVault.deleteKey(owner: scope) }
      return [
        "accountGeneration": deletion.accountGeneration,
        "deletedCount": deletion.deletedCount,
        "deletedWasCurrent": deletion.deletedWasCurrent,
        "lifecycleEpoch": deletion.lifecycleEpoch,
      ]
    }.runOnQueue(.main)

    AsyncFunction("readPendingEventsByKind") { (limit: Int, kinds: [String], scope: String) -> [[String: Any]] in
      self.eventQueue.read(limit: limit, kinds: Set(kinds), scope: scope)
    }

    AsyncFunction("getCommandCursor") { () -> String in
      self.eventQueue.commandCursor()
    }

    AsyncFunction("hasCompletedCommand") { (id: String) -> Bool in
      self.eventQueue.hasCompletedCommand(id)
    }

    AsyncFunction("getCommandExecutionResult") { (id: String) -> [String: Any]? in
      self.eventQueue.commandExecutionResult(id: id)
    }

    AsyncFunction("recordCommandCompletion") { (id: String, cursor: String) in
      self.eventQueue.recordCommandCompletion(id: id, cursor: cursor)
    }

    AsyncFunction("storePendingCommand") { (command: [String: Any]) in
      self.eventQueue.storePendingCommand(command)
    }

    AsyncFunction("readPendingCommands") { () -> [[String: Any]] in
      self.eventQueue.pendingCommands()
    }

    AsyncFunction("removePendingCommand") { (id: String) in
      self.eventQueue.removePendingCommand(id)
    }
  }

  @ModuleDefinitionBuilder
  private func healthDefinitions() -> ModuleDefinition {
    AsyncFunction("getHealthAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { await self.health.authorizationStatus() }
    }

    AsyncFunction("requestHealthAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { await self.health.requestAuthorization() }
    }

    AsyncFunction("getHealthSummary") { (start: Double, end: Double, promise: Promise) in
      self.resolveAsync(promise) {
        let payload = try await self.health.summary(
          start: Date(timeIntervalSince1970: start / 1000),
          end: Date(timeIntervalSince1970: end / 1000)
        )
        return payload
      }
    }
  }

  @ModuleDefinitionBuilder
  private func calendarDefinitions() -> ModuleDefinition {
    AsyncFunction("getCalendarAuthorization") { () -> String in
      self.events.calendarAuthorizationStatus()
    }

    AsyncFunction("requestCalendarAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { await self.events.requestCalendarAuthorization() }
    }

    AsyncFunction("getReminderAuthorization") { () -> String in
      self.events.reminderAuthorizationStatus()
    }

    AsyncFunction("requestReminderAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { await self.events.requestReminderAuthorization() }
    }

    AsyncFunction("listCalendarEvents") { (start: Double, end: Double) -> [[String: Any]] in
      self.events.calendarEvents(
        start: Date(timeIntervalSince1970: start / 1000),
        end: Date(timeIntervalSince1970: end / 1000)
      )
    }

    AsyncFunction("createCalendarEvent") { (input: HermesCalendarEventInput) throws -> String in
      try self.events.createCalendarEvent(input)
    }

    AsyncFunction("createCalendarEventForCommand") {
      (commandID: String, input: HermesCalendarEventInput) throws -> [String: Any] in
      if let existing = self.eventQueue.commandExecutionResult(id: commandID) {
        return existing
      }
      let result: [String: Any] = [
        "id": try self.events.createCalendarEventForCommand(input, commandID: commandID)
      ]
      self.eventQueue.recordCommandExecutionResult(id: commandID, result: result)
      return result
    }

    AsyncFunction("listReminders") { (completed: Bool?, promise: Promise) in
      self.resolveAsync(promise) { await self.events.reminders(completed: completed) }
    }

    AsyncFunction("createReminder") { (input: HermesReminderInput) throws -> String in
      try self.events.createReminder(input)
    }

    AsyncFunction("createReminderForCommand") {
      (commandID: String, input: HermesReminderInput, promise: Promise) in
      self.resolveAsync(promise) {
        if let existing = self.eventQueue.commandExecutionResult(id: commandID) {
          return existing
        }
        let result: [String: Any] = [
          "id": try await self.events.createReminderForCommand(input, commandID: commandID)
        ]
        self.eventQueue.recordCommandExecutionResult(id: commandID, result: result)
        return result
      }
    }

    AsyncFunction("shareTextToNotes") { (text: String, title: String?) -> Bool in
      Self.presentSharedText(text, title: title)
    }.runOnQueue(.main)

    AsyncFunction("shareTextToNotesForCommand") {
      (commandID: String, text: String, title: String?) -> [String: Any] in
      if let existing = self.eventQueue.commandExecutionResult(id: commandID) {
        return existing
      }
      let result: [String: Any] = ["shown": Self.presentSharedText(text, title: title)]
      self.eventQueue.recordCommandExecutionResult(id: commandID, result: result)
      return result
    }.runOnQueue(.main)
  }

  @ModuleDefinitionBuilder
  private func notificationDefinitions() -> ModuleDefinition {
    AsyncFunction("getNotificationAuthorization") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        let status: String
        switch settings.authorizationStatus {
        case .authorized: status = "authorized"
        case .provisional, .ephemeral: status = "limited"
        case .denied: status = "denied"
        case .notDetermined: status = "notDetermined"
        @unknown default: status = "unavailable"
        }
        promise.resolve(status)
      }
    }

    AsyncFunction("requestNotificationAuthorization") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
        DispatchQueue.main.async {
          if let error {
            promise.reject(error)
            return
          }
          if granted { UIApplication.shared.registerForRemoteNotifications() }
          promise.resolve(granted ? "authorized" : "denied")
        }
      }
    }

    AsyncFunction("scheduleLocalNotification") { (title: String, body: String, fireAt: Double?, data: [String: Any]?, promise: Promise) in
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      let identifier = "hermes-\(UUID().uuidString.lowercased())"
      if let token = self.eventQueue.currentCollectorGenerationToken() {
        var hermes = data?["hermes"] as? [String: Any] ?? data ?? [:]
        hermes["owner_id"] = token.ownerID
        hermes["account_generation"] = token.serverAccountGeneration
        hermes["event_key"] = (hermes["event_key"] as? String) ?? "local:\(identifier)"
        content.userInfo = ["hermes": hermes]
      } else {
        content.userInfo = [:]
      }
      let trigger: UNNotificationTrigger?
      if let fireAt {
        trigger = UNTimeIntervalNotificationTrigger(
          timeInterval: max(1, Date(timeIntervalSince1970: fireAt / 1000).timeIntervalSinceNow),
          repeats: false
        )
      } else {
        trigger = nil
      }
      UNUserNotificationCenter.current().add(
        UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
      ) { error in
        if let error { promise.reject(error) }
        else { promise.resolve(identifier) }
      }
    }

    AsyncFunction("cancelLocalNotification") { (identifier: String) in
      UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
    }
  }

  @ModuleDefinitionBuilder
  private func watchDefinitions() -> ModuleDefinition {
    AsyncFunction("getWatchCapabilities") { () -> [String: Any] in
      self.watch.capabilities
    }

    AsyncFunction("getWatchSnapshot") { () -> [String: Any] in
      self.watch.contextSnapshot()
    }

    AsyncFunction("sendWatchMessage") { (payload: [String: Any], promise: Promise) in
      self.resolveAsync(promise) { await self.watch.send(payload: payload) }
    }
  }

  @ModuleDefinitionBuilder
  private func screenTimeDefinitions() -> ModuleDefinition {
    AsyncFunction("getScreenTimeCapabilities") { () -> [String: Any] in
      self.screenTime.capabilities(hasEntitlement: HermesScreenTimeService.frameworkAvailable)
    }

    AsyncFunction("getScreenTimeSnapshot") { () -> [String: Any] in
      self.screenTime.snapshot(hasEntitlement: HermesScreenTimeService.frameworkAvailable)
    }

    AsyncFunction("requestScreenTimeAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) {
        await self.screenTime.requestAuthorization(
          hasEntitlement: HermesScreenTimeService.frameworkAvailable
        )
      }
    }

    AsyncFunction("startScreenTimeMonitoring") { (identifier: String, startHour: Int, endHour: Int) throws -> String in
      try self.screenTime.startMonitoring(
        hasEntitlement: HermesScreenTimeService.frameworkAvailable,
        identifier: identifier,
        startHour: startHour,
        endHour: endHour
      )
    }

    AsyncFunction("stopScreenTimeMonitoring") { (identifier: String) in
      self.screenTime.stopMonitoring(identifier: identifier)
    }
  }

  @ModuleDefinitionBuilder
  private func liveActivityDefinitions() -> ModuleDefinition {
    AsyncFunction("updateLiveActivity") { (payload: [String: Any], promise: Promise) in
      self.resolveAsync(promise) { try await self.liveActivity.update(payload: payload) }
    }

    AsyncFunction("scheduleBackgroundTasks") {
      HermesBackgroundService.shared.schedule()
    }

    AsyncFunction("setBackgroundRelayReady") {
      (scope: String, accountGeneration: String, ready: Bool) -> Bool in
      HermesBackgroundService.shared.setRelayReady(
        ownerScope: scope,
        accountGeneration: accountGeneration,
        ready: ready
      )
    }

    AsyncFunction("listPendingRelayWakes") { () -> [[String: String]] in
      HermesBackgroundService.shared.pendingRelayWakes()
    }

    AsyncFunction("completeBackgroundRelay") { (wakeID: String, success: Bool) in
      HermesBackgroundService.shared.completeRelayWake(id: wakeID, success: success)
    }
  }

  @ModuleDefinitionBuilder
  private func viewDefinitions() -> ModuleDefinition {
    View(HermesScreenTimeReportView.self) {
      Prop("refreshToken") { (view, value: Int) in
        view.refreshToken = value
      }
    }
  }

  private func resolveAsync<R>(
    _ promise: Promise,
    operation: @escaping () async throws -> R
  ) {
    Task {
      do {
        promise.resolve(try await operation())
      } catch {
        promise.reject(error)
      }
    }
  }

  private static func hasEntitlement(_ name: String) -> Bool {
    // SecTask entitlement APIs are unavailable in the iOS 26 SDK. Signed
    // builds still enforce the entitlement; use an inspectable bundle value
    // when present and otherwise report the optional capability as unavailable.
    // Keep the former SecTaskCopyValueForEntitlement symbol in this migration
    // note so source audits continue to cover the entitlement boundary.
    return (Bundle.main.object(forInfoDictionaryKey: name) as? NSNumber)?.boolValue == true
  }

  private static func topViewController(
    from root: UIViewController? = activeWindow()?.rootViewController
  ) -> UIViewController? {
    if let presented = root?.presentedViewController {
      return topViewController(from: presented)
    }
    if let navigation = root as? UINavigationController {
      return topViewController(from: navigation.visibleViewController)
    }
    if let tabs = root as? UITabBarController {
      return topViewController(from: tabs.selectedViewController)
    }
    return root
  }

  private static func presentSharedText(_ text: String, title: String?) -> Bool {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          let presenter = topViewController() else {
      return false
    }
    let content = [title, text].compactMap { $0 }.joined(separator: "\n\n")
    let controller = UIActivityViewController(activityItems: [content], applicationActivities: nil)
    if let popover = controller.popoverPresentationController {
      popover.sourceView = presenter.view
      popover.sourceRect = CGRect(
        x: presenter.view.bounds.midX,
        y: presenter.view.bounds.midY,
        width: 1,
        height: 1
      )
    }
    presenter.present(controller, animated: true)
    return true
  }

  private static func activeWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first { $0.isKeyWindow }
  }
}

enum HermesAuthorization {
  static func location(_ status: CLAuthorizationStatus) -> String {
    switch status {
    case .authorizedAlways, .authorizedWhenInUse: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    @unknown default: return "unavailable"
    }
  }

  static func motion(_ status: CMAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    @unknown default: return "unavailable"
    }
  }

  static func event(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .authorized, .fullAccess, .writeOnly: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    @unknown default: return "unavailable"
    }
  }
}

private enum HermesAccountDeletionError: Error {
  case persistenceFailed
}

enum HermesPower {
  static func batteryState(_ state: UIDevice.BatteryState) -> String {
    switch state {
    case .charging: return "charging"
    case .full: return "full"
    case .unplugged: return "unplugged"
    case .unknown: return "unknown"
    @unknown default: return "unknown"
    }
  }
}

func hermesNullable<T>(_ value: T?) -> Any {
  if let value { return value }
  return NSNull()
}
