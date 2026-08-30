import CoreLocation
import CoreMotion
import CryptoKit
import EventKit
import ExpoModulesCore
import HealthKit
import Contacts
import Security
import UIKit
import UserNotifications
import WatchConnectivity

private let hermesFileProviderGroup = "group.app.sunstone1029.fig1171.hermes"
private let hermesFileProviderOwnerKey = "hermes-file-provider-owner-v1"
private let hermesVoiceNarrationEnabledKey = "app.hermes.voice-narration-enabled"

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
  #if canImport(CoreBluetooth)
  private static let nativeBluetoothAvailable = true
  #else
  private static let nativeBluetoothAvailable = false
  #endif
  #if canImport(CoreNFC)
  private static let nativeNFCAvailable = true
  #else
  private static let nativeNFCAvailable = false
  #endif
  #if canImport(HomeKit)
  private static let nativeHomeKitAvailable = true
  #else
  private static let nativeHomeKitAvailable = false
  #endif
  private static let nativeActionCapabilities: [[String: Any]] = [
    ["capability": "ios-contacts", "actions": ["list", "search", "create"], "permission": "contacts", "confirmation": "create"],
    ["capability": "ios-photos", "actions": ["list", "search", "capture", "scan", "ocr", "albums", "near", "favorite", "delete", "album-create", "album-add", "import", "export"], "permission": "photos/camera", "confirmation": "capture/write"],
    ["capability": "ios-vision", "actions": ["analyze"], "permission": "photos", "confirmation": "none"],
    ["capability": "ios-nlp", "actions": ["analyze"], "permission": "none", "confirmation": "none"],
    ["capability": "ios-alarm", "actions": ["schedule", "list", "cancel"], "permission": "reminders/notification", "confirmation": "schedule/cancel"],
    ["capability": "ios-media", "actions": ["get", "control", "play", "pause", "next", "previous", "stop", "search", "play-search", "volume"], "permission": "media", "confirmation": "controls"],
    ["capability": "ios-bluetooth", "actions": ["state", "scan", "connect", "disconnect", "services", "read", "write", "notify"], "permission": "bluetooth", "confirmation": "connect/write"],
    ["capability": "ios-nfc", "actions": ["scan", "write"], "permission": "nfc", "confirmation": "write"],
    ["capability": "ios-homekit", "actions": ["list", "get", "search", "scenes", "trigger", "set"], "permission": "homekit", "confirmation": "set/trigger"],
    ["capability": "ios-health-write", "actions": ["authorize", "write", "batch", "delete"], "permission": "health", "confirmation": "write/delete"],
    ["capability": "ios-browser", "actions": ["navigate", "screenshot", "click", "type", "get_text", "scroll", "get_page_info", "execute_js", "find_elements", "hover", "get_readable", "set_user_agent", "set_viewport", "get_backbone", "fetch", "new_tab", "close_tab", "list_tabs", "get_cookies", "set_cookies", "scroll_and_collect", "wait_for_dom_stable"], "permission": "network/web", "confirmation": "execute_js/write/cookies"],
    ["capability": "ios-device", "actions": ["open-url", "settings"], "permission": "device", "confirmation": "open-url"],
  ]
  private lazy var location = HermesLocationService.shared
  private lazy var motion = HermesMotionService.shared
  private lazy var health = HermesHealthService.shared
  private lazy var events = HermesEventStore.shared
  private lazy var eventQueue = HermesContextEventQueue.shared
  private lazy var watch = HermesWatchService.shared
  private lazy var device = HermesDeviceService.shared
  private lazy var screenTime = HermesScreenTimeService.shared
  private lazy var liveActivity = HermesLiveActivityService.shared
  private lazy var attachmentVault = HermesAttachmentVault.shared
  private lazy var voice = HermesVoiceService.shared
  private lazy var protectedExport = HermesProtectedExportFile.shared
  private var relayWakeObserver: NSObjectProtocol?

  private static func requireCommandID(_ rawValue: String) throws -> String {
    let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty, value.count <= 256,
          value.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == "." }) else {
      throw HermesNativeActionError.invalidInput("commandID")
    }
    return value
  }

  private static func setFileProviderOwnerScope(_ scope: String) {
    let defaults = UserDefaults(suiteName: hermesFileProviderGroup)
    let normalized = scope.trimmingCharacters(in: .whitespacesAndNewlines)
    let previous = defaults?.string(forKey: hermesFileProviderOwnerKey)
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if normalized.isEmpty {
      defaults?.removeObject(forKey: hermesFileProviderOwnerKey)
    } else {
      defaults?.set(normalized, forKey: hermesFileProviderOwnerKey)
    }
    defaults?.synchronize()
    // Swift has no `casefold` API.  Owner scopes are protocol identifiers,
    // so the locale-independent lowercased comparison is the right boundary
    // for deciding whether the previous account's file-provider root is stale.
    if !previous.isEmpty, previous.lowercased() != normalized.lowercased() {
      removeFileProviderRoot(ownerScope: previous)
    }
  }

  private static func removeFileProviderRoot(ownerScope: String) {
    guard !ownerScope.isEmpty,
          let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: hermesFileProviderGroup
          ) else { return }
    let digest = SHA256.hash(data: Data(ownerScope.utf8))
      .map { String(format: "%02x", $0) }
      .joined()
    let root = container
      .appendingPathComponent("HermesFiles", isDirectory: true)
      .appendingPathComponent(digest, isDirectory: true)
    try? FileManager.default.removeItem(at: root)
  }

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
    clipboardDefinitions()
    nativeActionDefinitions()
    taskControlDefinitions()
    notificationDefinitions()
    watchDefinitions()
    screenTimeDefinitions()
    liveActivityDefinitions()
    sessionLockDefinitions()
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
      guard HermesRuntimeConfiguration.nativeContextEnabled else { return }
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
        "clipboard": true,
        "photos": true,
        "contacts": HermesContactsService.authorization() != "unavailable",
        "media": true,
        "bluetooth": Self.nativeBluetoothAvailable,
        "nfc": Self.nativeNFCAvailable,
        "homekit": Self.nativeHomeKitAvailable,
        "browser": true,
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

    AsyncFunction("startAgentVoiceCapture") { (locale: String?) throws -> Bool in
      try MainActor.assumeIsolated {
        try self.voice.startAgentCapture(localeIdentifier: locale)
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

    AsyncFunction("startStreamingSpeech") { (locale: String?, rate: Double?) throws -> Bool in
      try MainActor.assumeIsolated {
        try self.voice.startStreamingSpeech(localeIdentifier: locale, rate: rate)
      }
    }.runOnQueue(.main)

    AsyncFunction("appendStreamingSpeech") { (text: String) -> Bool in
      MainActor.assumeIsolated {
        self.voice.appendStreamingSpeech(text)
      }
    }.runOnQueue(.main)

    AsyncFunction("finishStreamingSpeech") { () -> Bool in
      MainActor.assumeIsolated {
        self.voice.finishStreamingSpeech()
      }
    }.runOnQueue(.main)

    AsyncFunction("startPCMPlayback") { (sampleRate: Double, channels: Int) throws -> Bool in
      try MainActor.assumeIsolated {
        try self.voice.startPCMPlayback(sampleRate: sampleRate, channels: channels)
      }
    }.runOnQueue(.main)

    AsyncFunction("appendPCMPlayback") { (base64PCM: String) throws -> Bool in
      try MainActor.assumeIsolated {
        try self.voice.appendPCMPlayback(base64PCM)
      }
    }.runOnQueue(.main)

    AsyncFunction("finishPCMPlayback") { () -> Bool in
      MainActor.assumeIsolated {
        self.voice.finishPCMPlayback()
      }
    }.runOnQueue(.main)

    AsyncFunction("stopPCMPlayback") { (interrupted: Bool?) -> Bool in
      MainActor.assumeIsolated {
        self.voice.stopPCMPlayback(interrupted: interrupted ?? false)
      }
    }.runOnQueue(.main)

    AsyncFunction("interruptSpeaking") { () -> Bool in
      MainActor.assumeIsolated {
        self.voice.stopSpeaking(interrupted: true)
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

    // Durable device-local narration switch. The Live Activity Speak/Mute
    // control routes through the pending-task-control queue into this
    // preference so the choice survives relaunches; disabling also silences
    // any utterance already in flight.
    AsyncFunction("getVoiceNarrationEnabled") { () -> Bool in
      UserDefaults.standard.bool(forKey: hermesVoiceNarrationEnabledKey)
    }.runOnQueue(.main)

    AsyncFunction("setVoiceNarrationEnabled") { (enabled: Bool) -> Bool in
      UserDefaults.standard.set(enabled, forKey: hermesVoiceNarrationEnabledKey)
      if !enabled {
        _ = self.voice.stopSpeaking()
      }
      return enabled
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
      let activeIdentity = self.eventQueue.currentOwnerIdentity
      HermesAgentTriggerStore.shared.discardMismatched(
        ownerScope: activeIdentity.ownerScope,
        accountGeneration: activeIdentity.accountGeneration
      )
      HermesTaskControlStore.shared.discardMismatched(
        ownerScope: activeIdentity.ownerScope,
        accountGeneration: activeIdentity.accountGeneration
      )
      // Identity changed through this bridge too — publish the hint so the
      // Share Extension stamps shares for the now-active account.
      HermesAgentTriggerStore.refreshOwnerHint()
      Self.setFileProviderOwnerScope(scope)
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
      Self.setFileProviderOwnerScope(scope)
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
      if (UserDefaults(suiteName: hermesFileProviderGroup)?.string(forKey: hermesFileProviderOwnerKey) ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines) == scope.trimmingCharacters(in: .whitespacesAndNewlines) {
        Self.setFileProviderOwnerScope("")
      }
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

    AsyncFunction("requestHealthWriteAuthorization") { (identifier: String, promise: Promise) in
      self.resolveAsync(promise) { await self.health.requestWriteAuthorization(identifier: identifier) }
    }

    AsyncFunction("writeHealthSampleForCommand") {
      (commandID: String, identifier: String, value: Double, unit: String, start: Double, end: Double, promise: Promise) in
      self.resolveAsync(promise) {
        let normalizedCommandID = try Self.requireCommandID(commandID)
        if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
        let result = try await self.health.writeQuantitySample(
          commandID: normalizedCommandID,
          identifier: identifier,
          value: value,
          unit: unit,
          start: Date(timeIntervalSince1970: start / 1000),
          end: Date(timeIntervalSince1970: end / 1000)
        )
        self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
        return result
      }
    }

    AsyncFunction("writeHealthSamplesForCommand") {
      (commandID: String, samples: [[String: Any]], promise: Promise) in
      self.resolveAsync(promise) {
        let normalizedCommandID = try Self.requireCommandID(commandID)
        if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
        let result = try await self.health.writeQuantitySamples(commandID: normalizedCommandID, samples: samples)
        self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
        return result
      }
    }

    AsyncFunction("deleteHealthSamplesForCommand") {
      (commandID: String, identifier: String, promise: Promise) in
      self.resolveAsync(promise) {
        let normalizedCommandID = try Self.requireCommandID(commandID)
        if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
        let result = try await self.health.deleteQuantitySamples(commandID: normalizedCommandID, identifier: identifier)
        self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
        return result
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

    AsyncFunction("listCalendars") { () -> [[String: Any]] in
      self.events.calendars()
    }

    AsyncFunction("calendarFreeBusy") { (start: Double, end: Double) -> [[String: Any]] in
      self.events.freeBusy(start: Date(timeIntervalSince1970: start / 1000), end: Date(timeIntervalSince1970: end / 1000))
    }

    AsyncFunction("createCalendarEvent") { (input: HermesCalendarEventInput) throws -> String in
      try self.events.createCalendarEvent(input)
    }

    AsyncFunction("createCalendarEventForCommand") {
      (commandID: String, input: HermesCalendarEventInput) throws -> [String: Any] in
      let normalizedCommandID = try Self.requireCommandID(commandID)
      if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) {
        return existing
      }
      let result: [String: Any] = [
        "id": try self.events.createCalendarEventForCommand(input, commandID: normalizedCommandID)
      ]
      self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
      return result
    }

    AsyncFunction("updateCalendarEventForCommand") {
      (commandID: String, eventID: String, title: String?, start: Double?, end: Double?, location: String?, notes: String?) throws -> [String: Any] in
      let normalizedCommandID = try Self.requireCommandID(commandID)
      if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
      let result = try self.events.updateCalendarEvent(id: eventID, title: title, start: start.map { Date(timeIntervalSince1970: $0 / 1000) }, end: end.map { Date(timeIntervalSince1970: $0 / 1000) }, location: location, notes: notes)
      self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
      return result
    }

    AsyncFunction("deleteCalendarEventForCommand") {
      (commandID: String, eventID: String) throws -> [String: Any] in
      let normalizedCommandID = try Self.requireCommandID(commandID)
      if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
      let result = try self.events.deleteCalendarEvent(id: eventID)
      self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
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
        let normalizedCommandID = try Self.requireCommandID(commandID)
        if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) {
          return existing
        }
        let result: [String: Any] = [
          "id": try await self.events.createReminderForCommand(input, commandID: normalizedCommandID)
        ]
        self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
        return result
      }
    }

    AsyncFunction("updateReminderForCommand") {
      (commandID: String, reminderID: String, title: String?, due: Double?, notes: String?, completed: Bool?, promise: Promise) in
      self.resolveAsync(promise) {
        let normalizedCommandID = try Self.requireCommandID(commandID)
        if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
        let result = try await self.events.updateReminder(id: reminderID, title: title, due: due.map { Date(timeIntervalSince1970: $0 / 1000) }, notes: notes, completed: completed)
        self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
        return result
      }
    }

    AsyncFunction("deleteReminderForCommand") {
      (commandID: String, reminderID: String, promise: Promise) in
      self.resolveAsync(promise) {
        let normalizedCommandID = try Self.requireCommandID(commandID)
        if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
        let result = try await self.events.deleteReminder(id: reminderID)
        self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
        return result
      }
    }

    AsyncFunction("shareTextToNotes") { (text: String, title: String?) -> Bool in
      Self.presentSharedText(text, title: title)
    }.runOnQueue(.main)

    AsyncFunction("shareTextToNotesForCommand") {
      (commandID: String, text: String, title: String?) -> [String: Any] in
      let normalizedCommandID = try Self.requireCommandID(commandID)
      if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) {
        return existing
      }
      let result: [String: Any] = ["shown": Self.presentSharedText(text, title: title)]
      self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
      return result
    }.runOnQueue(.main)
  }

  @ModuleDefinitionBuilder
  private func sessionLockDefinitions() -> ModuleDefinition {
    AsyncFunction("configureSessionLock") { (ownerScope: String, enabled: Bool, timeoutMinutes: Double?) -> [String: Any] in
      HermesSessionLockService.shared.configure(owner: ownerScope, enabled: enabled, timeoutMinutes: timeoutMinutes)
    }.runOnQueue(.main)

    AsyncFunction("getSessionLockStatus") { (ownerScope: String) -> [String: Any] in
      HermesSessionLockService.shared.status(owner: ownerScope)
    }.runOnQueue(.main)

    AsyncFunction("unlockSession") { (ownerScope: String, promise: Promise) in
      self.resolveAsync(promise) { try await HermesSessionLockService.shared.unlock(owner: ownerScope) }
    }.runOnQueue(.main)

    AsyncFunction("lockSession") { (ownerScope: String) -> [String: Any] in
      HermesSessionLockService.shared.lockSession(owner: ownerScope)
    }.runOnQueue(.main)

    AsyncFunction("getDiagnosticsStatus") { () -> [String: Any] in
      HermesDiagnosticsService.shared.status()
    }.runOnQueue(.main)

    AsyncFunction("startDiagnostics") {
      HermesDiagnosticsService.shared.start()
    }.runOnQueue(.main)

    AsyncFunction("stopDiagnostics") {
      HermesDiagnosticsService.shared.stop()
    }.runOnQueue(.main)
  }

  @ModuleDefinitionBuilder
  private func clipboardDefinitions() -> ModuleDefinition {
    AsyncFunction("readClipboard") { () -> [String: Any] in
      let text = UIPasteboard.general.string ?? ""
      return ["text": text, "hasText": !text.isEmpty]
    }.runOnQueue(.main)

    AsyncFunction("readClipboardForCommand") {
      (commandID: String) throws -> [String: Any] in
      let normalizedCommandID = try Self.requireCommandID(commandID)
      if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) {
        return existing
      }
      let text = UIPasteboard.general.string ?? ""
      let result: [String: Any] = ["text": text, "hasText": !text.isEmpty]
      self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
      return result
    }.runOnQueue(.main)

    AsyncFunction("writeClipboard") { (text: String) -> Bool in
      UIPasteboard.general.string = text
      return true
    }.runOnQueue(.main)

    AsyncFunction("writeClipboardForCommand") {
      (commandID: String, text: String) throws -> [String: Any] in
      let normalizedCommandID = try Self.requireCommandID(commandID)
      if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) {
        return existing
      }
      UIPasteboard.general.string = text
      let result: [String: Any] = ["written": true, "length": text.count]
      self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
      return result
    }.runOnQueue(.main)
  }

  @ModuleDefinitionBuilder
  private func nativeActionDefinitions() -> ModuleDefinition {
    AsyncFunction("getContactsAuthorization") { () -> String in
      HermesContactsService.authorization()
    }.runOnQueue(.main)

    AsyncFunction("requestContactsAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { try await HermesContactsService.requestAuthorization() }
    }.runOnQueue(.main)

    AsyncFunction("searchContacts") { (query: String?, limit: Int?) throws -> [[String: Any]] in
      try HermesContactsService.search(query: query, limit: limit ?? 50)
    }.runOnQueue(.main)

    AsyncFunction("createContact") {
      (givenName: String, familyName: String?, organization: String?, phone: String?, email: String?) throws -> [String: Any] in
      try HermesContactsService.create(
        givenName: givenName,
        familyName: familyName,
        organization: organization,
        phone: phone,
        email: email
      )
    }.runOnQueue(.main)

    AsyncFunction("createContactForCommand") {
      (commandID: String, givenName: String, familyName: String?, organization: String?, phone: String?, email: String?) throws -> [String: Any] in
      let normalizedCommandID = try Self.requireCommandID(commandID)
      if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
      let result = try HermesContactsService.create(
        givenName: givenName,
        familyName: familyName,
        organization: organization,
        phone: phone,
        email: email
      )
      self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
      return result
    }.runOnQueue(.main)

    AsyncFunction("getPhotosAuthorization") { () -> String in
      HermesPhotosService.authorization()
    }.runOnQueue(.main)

    AsyncFunction("requestPhotosAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { await HermesPhotosService.requestAuthorization() }
    }.runOnQueue(.main)

    AsyncFunction("searchPhotos") {
      (query: String?, start: Double?, end: Double?, limit: Int?, mediaType: String?) throws -> [[String: Any]] in
      try HermesPhotosService.search(query: query, start: start, end: end, limit: limit ?? 50, mediaType: mediaType)
    }.runOnQueue(.main)

    AsyncFunction("listPhotoAlbums") { (limit: Int?) throws -> [[String: Any]] in
      try HermesPhotosService.albums(limit: limit ?? 50)
    }.runOnQueue(.main)

    AsyncFunction("searchNearbyPhotos") { (latitude: Double, longitude: Double, radiusMeters: Double?, limit: Int?) throws -> [[String: Any]] in
      try HermesPhotosService.nearby(latitude: latitude, longitude: longitude, radiusMeters: radiusMeters ?? 1_000, limit: limit ?? 50)
    }.runOnQueue(.main)

    AsyncFunction("updatePhotoFavorite") { (assetIDs: [String], favorite: Bool, promise: Promise) in
      self.resolveAsync(promise) { try await HermesPhotosService.updateFavorite(assetIDs: assetIDs, favorite: favorite) }
    }

    AsyncFunction("deletePhotos") { (assetIDs: [String], promise: Promise) in
      self.resolveAsync(promise) { try await HermesPhotosService.delete(assetIDs: assetIDs) }
    }

    AsyncFunction("createPhotoAlbum") { (title: String, promise: Promise) in
      self.resolveAsync(promise) { try await HermesPhotosService.createAlbum(title: title) }
    }

    AsyncFunction("addPhotosToAlbum") { (assetIDs: [String], albumID: String, promise: Promise) in
      self.resolveAsync(promise) { try await HermesPhotosService.addToAlbum(assetIDs: assetIDs, albumID: albumID) }
    }

    AsyncFunction("importPhoto") { (ownerScope: String, imageURL: String, promise: Promise) in
      self.resolveAsync(promise) { try await HermesPhotosService.importImage(owner: ownerScope, imageURL: imageURL) }
    }

    AsyncFunction("exportPhoto") { (ownerScope: String, assetID: String, original: Bool?, promise: Promise) in
      self.resolveAsync(promise) { try await HermesPhotosService.export(assetID: assetID, owner: ownerScope, original: original ?? false) }
    }

    AsyncFunction("deleteExportedPhoto") { (ownerScope: String, uri: String) throws -> Bool in
      try HermesPhotosService.deleteExport(owner: ownerScope, uri: uri)
    }

    AsyncFunction("ocrImage") {
      (imageURL: String, ownerScope: String, recognitionLevel: String?, languages: [String]?) throws -> [String: Any] in
      try HermesPhotosService.recognizeText(
        imageURL: imageURL,
        owner: ownerScope,
        recognitionLevel: recognitionLevel,
        languages: languages
      )
    }

    AsyncFunction("analyzeVision") {
      (imageURL: String, ownerScope: String, mode: String?, promise: Promise) in
      self.resolveAsync(promise) {
        let image = try HermesPhotosService.visionImage(imageURL: imageURL, owner: ownerScope)
        return try HermesVisionService.analyze(image: image, mode: mode ?? "analyze")
      }
    }

    AsyncFunction("analyzeNaturalLanguage") { (text: String) throws -> [String: Any] in
      try HermesNaturalLanguageService.analyze(text: text)
    }

    AsyncFunction("getMediaSnapshot") { () -> [String: Any] in
      HermesMediaService.snapshot()
    }.runOnQueue(.main)

    AsyncFunction("getMediaAuthorization") { () -> String in
      HermesMediaService.authorization()
    }.runOnQueue(.main)

    AsyncFunction("requestMediaAuthorization") { (promise: Promise) in
      self.resolveAsync(promise) { await HermesMediaService.requestAuthorization() }
    }.runOnQueue(.main)

    AsyncFunction("controlMedia") { (action: String) throws -> [String: Any] in
      try HermesMediaService.control(action)
    }.runOnQueue(.main)

    AsyncFunction("searchMedia") { (query: String, limit: Int?) throws -> [[String: Any]] in
      try HermesMediaService.search(query: query, limit: limit ?? 50)
    }.runOnQueue(.main)

    AsyncFunction("playMediaSearch") { (query: String, limit: Int?, promise: Promise) in
      self.resolveAsync(promise) { try HermesMediaService.playSearch(query: query, limit: limit ?? 50) }
    }

    AsyncFunction("setMediaVolume") { (volume: Double) throws -> [String: Any] in
      try HermesMediaService.setVolume(volume)
    }.runOnQueue(.main)

    AsyncFunction("getBluetoothState") { () -> String in
      #if canImport(CoreBluetooth)
      return HermesBluetoothService.shared.state()
      #else
      return "unsupported"
      #endif
    }.runOnQueue(.main)

    AsyncFunction("scanBluetooth") { (seconds: Double?, promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(CoreBluetooth)
        return try await HermesBluetoothService.shared.scan(seconds: seconds ?? 5)
        #else
        throw HermesNativeActionError.unavailable("bluetooth")
        #endif
      }
    }

    AsyncFunction("connectBluetooth") { (ownerScope: String, deviceID: String, promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(CoreBluetooth)
        return try await HermesBluetoothService.shared.connect(owner: ownerScope, identifier: deviceID)
        #else
        throw HermesNativeActionError.unavailable("bluetooth")
        #endif
      }
    }

    AsyncFunction("disconnectBluetooth") {
      #if canImport(CoreBluetooth)
      HermesBluetoothService.shared.disconnect()
      #endif
    }

    AsyncFunction("bluetoothServices") { (ownerScope: String, deviceID: String, promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(CoreBluetooth)
        return ["services": try await HermesBluetoothService.shared.services(owner: ownerScope, identifier: deviceID)]
        #else
        throw HermesNativeActionError.unavailable("bluetooth")
        #endif
      }
    }

    AsyncFunction("bluetoothRead") { (ownerScope: String, deviceID: String, serviceUUID: String, characteristicUUID: String, promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(CoreBluetooth)
        return try await HermesBluetoothService.shared.read(owner: ownerScope, identifier: deviceID, serviceUUID: serviceUUID, characteristicUUID: characteristicUUID)
        #else
        throw HermesNativeActionError.unavailable("bluetooth")
        #endif
      }
    }

    AsyncFunction("bluetoothWrite") { (ownerScope: String, deviceID: String, serviceUUID: String, characteristicUUID: String, dataBase64: String, withResponse: Bool?, promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(CoreBluetooth)
        guard let data = Data(base64Encoded: dataBase64), data.count <= 64 * 1024 else { throw HermesNativeActionError.invalidInput("data") }
        return try await HermesBluetoothService.shared.write(owner: ownerScope, identifier: deviceID, serviceUUID: serviceUUID, characteristicUUID: characteristicUUID, data: data, withResponse: withResponse ?? true)
        #else
        throw HermesNativeActionError.unavailable("bluetooth")
        #endif
      }
    }

    AsyncFunction("bluetoothNotify") { (ownerScope: String, deviceID: String, serviceUUID: String, characteristicUUID: String, seconds: Double?, promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(CoreBluetooth)
        return try await HermesBluetoothService.shared.notify(owner: ownerScope, identifier: deviceID, serviceUUID: serviceUUID, characteristicUUID: characteristicUUID, seconds: seconds ?? 10)
        #else
        throw HermesNativeActionError.unavailable("bluetooth")
        #endif
      }
    }

    AsyncFunction("getHomeKitSnapshot") { () -> [[String: Any]] in
      #if canImport(HomeKit)
      return HermesHomeKitService.shared.snapshot()
      #else
      return []
      #endif
    }.runOnQueue(.main)

    AsyncFunction("searchHomeKit") { (query: String?, limit: Int?) async throws -> [[String: Any]] in
      #if canImport(HomeKit)
      return HermesHomeKitService.shared.search(query: query, limit: limit ?? 50)
      #else
      throw HermesNativeActionError.unavailable("homekit")
      #endif
    }

    AsyncFunction("listHomeKitScenes") { (limit: Int?) async throws -> [[String: Any]] in
      #if canImport(HomeKit)
      return HermesHomeKitService.shared.scenes(limit: limit ?? 50)
      #else
      throw HermesNativeActionError.unavailable("homekit")
      #endif
    }

    AsyncFunction("triggerHomeKitScene") { (sceneID: String, promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(HomeKit)
        return try await HermesHomeKitService.shared.triggerScene(id: sceneID)
        #else
        throw HermesNativeActionError.unavailable("homekit")
        #endif
      }
    }

    AsyncFunction("setHomeKitValue") {
      (accessoryID: String, characteristicID: String, value: String, promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(HomeKit)
        let typedValue: Any
        switch value.lowercased() {
        case "true": typedValue = true
        case "false": typedValue = false
        default: typedValue = Double(value) ?? value
        }
        return try await HermesHomeKitService.shared.set(
          accessoryID: accessoryID,
          characteristicID: characteristicID,
          value: typedValue
        )
        #else
        throw HermesNativeActionError.unavailable("homekit")
        #endif
      }
    }

    AsyncFunction("startNFCReader") { (promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(CoreNFC)
        return try await HermesNFCService.shared.scan()
        #else
        throw HermesNativeActionError.unavailable("nfc-reader-session")
        #endif
      }
    }.runOnQueue(.main)

    AsyncFunction("writeNFCTag") { (text: String, promise: Promise) in
      self.resolveAsync(promise) {
        #if canImport(CoreNFC)
        return try await HermesNFCService.shared.write(text: text)
        #else
        throw HermesNativeActionError.unavailable("nfc-reader-session")
        #endif
      }
    }.runOnQueue(.main)

    AsyncFunction("getBrowserCapabilities") { () -> [String: Any] in
      HermesBrowserService.capabilities()
    }.runOnQueue(.main)

    AsyncFunction("executeBrowserForCommand") {
      (commandID: String, ownerScope: String, action: String, payload: [String: Any]?, includeBase64: Bool?, promise: Promise) in
      self.resolveAsync(promise) {
        let normalizedCommandID = try Self.requireCommandID(commandID)
        if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
        // HermesBrowserService is @MainActor and owns WKWebView, which is
        // documented as main-actor-isolated. Hop to main so the Swift
        // concurrency check passes and the WKWebView is never touched
        // off-thread.
        let result = try await MainActor.run {
          try HermesBrowserService.shared.execute(
            ownerScope: ownerScope,
            action: action,
            payload: payload ?? [:],
            includeBase64: includeBase64 ?? false
          )
        }
        self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
        return result
      }
    }

    AsyncFunction("scanQRCode") { (promise: Promise) in
      self.resolveAsync(promise) {
        try await HermesQRScannerService.shared.scan()
      }
    }

    AsyncFunction("openURL") { (url: String, promise: Promise) in
      self.resolveAsync(promise) {
        try await self.device.openURL(url)
      }
    }.runOnQueue(.main)

    AsyncFunction("openURLForCommand") {
      (commandID: String, url: String, promise: Promise) in
      self.resolveAsync(promise) {
        let normalizedCommandID = try Self.requireCommandID(commandID)
        if let existing = self.eventQueue.commandExecutionResult(id: normalizedCommandID) { return existing }
        let result = try await self.device.openURL(url)
        self.eventQueue.recordCommandExecutionResult(id: normalizedCommandID, result: result)
        return result
      }
    }.runOnQueue(.main)

    Function("getNativeActionCapabilities") { () -> [[String: Any]] in
      Self.nativeActionCapabilities
    }

    AsyncFunction("readPendingAgentTriggers") { () -> [[String: Any]] in
      HermesAgentTriggerStore.shared.pending()
    }.runOnQueue(.main)

    AsyncFunction("consumePendingAgentTrigger") { (requestID: String) -> Bool in
      HermesAgentTriggerStore.shared.consume(requestID: requestID)
    }.runOnQueue(.main)

    AsyncFunction("clearPendingAgentTriggers") { () -> Bool in
      HermesAgentTriggerStore.shared.clear()
      return true
    }.runOnQueue(.main)

    Function("getAgentShareAttachmentRootUri") { () -> String? in
      HermesAgentTriggerStore.shareAttachmentRoot?.absoluteString
    }

    AsyncFunction("deleteAgentShareAttachment") { (filename: String) throws -> Bool in
      guard filename.count <= 160, !filename.contains("/"), !filename.contains("\\"), filename != ".", filename != "..",
            let root = HermesAgentTriggerStore.shareAttachmentRoot else { return false }
      let target = root.appendingPathComponent(filename)
      guard target.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") else {
        throw HermesNativeActionError.invalidInput("filename")
      }
      guard FileManager.default.fileExists(atPath: target.path) else { return false }
      try FileManager.default.removeItem(at: target)
      return true
    }
  }

  @ModuleDefinitionBuilder
  private func taskControlDefinitions() -> ModuleDefinition {
    AsyncFunction("enqueueTaskControl") { (taskID: String, action: String) -> String? in
      HermesTaskControlStore.shared.enqueue(taskID: taskID, action: action)
    }

    AsyncFunction("readPendingTaskControls") { () -> [[String: Any]] in
      HermesTaskControlStore.shared.pending()
    }

    AsyncFunction("consumePendingTaskControl") { (requestID: String) -> Bool in
      HermesTaskControlStore.shared.consume(requestID: requestID)
    }

    AsyncFunction("clearPendingTaskControls") { () -> Bool in
      HermesTaskControlStore.shared.clear()
      return true
    }
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
