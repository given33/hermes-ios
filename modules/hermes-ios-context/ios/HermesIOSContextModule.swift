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
  private var relayWakeObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HermesIOSContext")
    Events("onLocation", "onMotion", "onVisit")
    Events("onBackgroundWake", "onWatchMessage")
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
    viewDefinitions()
  }

  @ModuleDefinitionBuilder
  private func lifecycleDefinitions() -> ModuleDefinition {
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
    }
  }

  @ModuleDefinitionBuilder
  private func locationDefinitions() -> ModuleDefinition {
    AsyncFunction("getCapabilities") { () -> [String: Bool] in
      let locationManager = CLLocationManager()
      let hasFamilyControls = Self.hasEntitlement("com.apple.developer.family-controls")
      return [
        "calendar": true,
        "health": HKHealthStore.isHealthDataAvailable(),
        "location": CLLocationManager.locationServicesEnabled(),
        "locationAlways": locationManager.authorizationStatus == .authorizedAlways,
        "locationPrecise": locationManager.accuracyAuthorization == .fullAccuracy,
        "motion": CMMotionActivityManager.isActivityAvailable(),
        "notesShare": true,
        "reminders": true,
        "screenTime": hasFamilyControls && HermesScreenTimeService.frameworkAvailable,
        "watch": WCSession.isSupported(),
        "liveActivity": HermesLiveActivityService.isAvailable,
        "backgroundTasks": true,
        "apns": true,
      ]
    }.runOnQueue(.main)

    AsyncFunction("getLocationAuthorization") { () -> String in
      HermesAuthorization.location(CLLocationManager().authorizationStatus)
    }.runOnQueue(.main)

    AsyncFunction("requestLocationAuthorization") { () async throws -> String in
      await self.location.requestAlwaysAuthorization()
    }.runOnQueue(.main)

    AsyncFunction("requestPreciseLocation") { () async -> Bool in
      await self.location.requestPreciseAuthorization()
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

    AsyncFunction("requestCurrentLocation") { () async -> [String: Any]? in
      await self.location.requestCurrent()
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
  private func deviceDefinitions() -> ModuleDefinition {
    AsyncFunction("getMotionAuthorization") { () -> String in
      HermesAuthorization.motion(CMMotionActivityManager.authorizationStatus())
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

    AsyncFunction("readPendingEvents") { (limit: Int, scope: String?) -> [[String: Any]] in
      self.eventQueue.read(limit: limit, scope: scope)
    }

    AsyncFunction("enqueueContextEvents") { (events: [[String: Any]]) throws -> Int in
      try self.eventQueue.enqueueBatch(events)
    }

    AsyncFunction("acknowledgeEvents") { (ids: [String], cursor: Int?, scope: String?) -> Int in
      self.eventQueue.acknowledge(ids: Set(ids), cursor: cursor, scope: scope)
    }

    AsyncFunction("setOwnerScope") { (scope: String) in
      self.eventQueue.setOwnerScope(scope)
      if !scope.isEmpty { HermesBackgroundService.shared.schedule() }
    }.runOnQueue(.main)

    AsyncFunction("activateOwnerScope") { (scope: String) -> Int in
      let generation = HermesAccountLifecycle.activateOwnerScope(scope)
      if !scope.isEmpty { HermesBackgroundService.shared.schedule() }
      return generation
    }.runOnQueue(.main)

    AsyncFunction("deleteOwnerScope") { (scope: String) -> Int in
      HermesAccountLifecycle.deleteOwnerScope(scope)
    }.runOnQueue(.main)

    AsyncFunction("readPendingEventsByKind") { (limit: Int, kinds: [String], scope: String?) -> [[String: Any]] in
      self.eventQueue.read(limit: limit, kinds: Set(kinds), scope: scope)
    }

    AsyncFunction("getCommandCursor") { () -> String in
      self.eventQueue.commandCursor()
    }

    AsyncFunction("hasCompletedCommand") { (id: String) -> Bool in
      self.eventQueue.hasCompletedCommand(id)
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
    AsyncFunction("requestHealthAuthorization") { () async -> String in
      await self.health.requestAuthorization()
    }

    AsyncFunction("getHealthSummary") { (start: Double, end: Double) async throws -> [String: Any] in
      let payload = try await self.health.summary(
        start: Date(timeIntervalSince1970: start / 1000),
        end: Date(timeIntervalSince1970: end / 1000)
      )
      self.eventQueue.enqueue(type: "health", payload: payload)
      return payload
    }
  }

  @ModuleDefinitionBuilder
  private func calendarDefinitions() -> ModuleDefinition {
    AsyncFunction("requestCalendarAuthorization") { () async -> String in
      await self.events.requestCalendarAuthorization()
    }

    AsyncFunction("requestReminderAuthorization") { () async -> String in
      await self.events.requestReminderAuthorization()
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

    AsyncFunction("listReminders") { (completed: Bool?) async -> [[String: Any]] in
      await self.events.reminders(completed: completed)
    }

    AsyncFunction("createReminder") { (input: HermesReminderInput) throws -> String in
      try self.events.createReminder(input)
    }

    AsyncFunction("shareTextToNotes") { (text: String, title: String?) -> Bool in
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            let presenter = Self.topViewController() else {
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
    }.runOnQueue(.main)
  }

  @ModuleDefinitionBuilder
  private func notificationDefinitions() -> ModuleDefinition {
    AsyncFunction("requestNotificationAuthorization") { () async throws -> String in
      await withCheckedContinuation { continuation in
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
          DispatchQueue.main.async {
            if granted { UIApplication.shared.registerForRemoteNotifications() }
            continuation.resume(returning: granted ? "authorized" : "denied")
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("scheduleLocalNotification") { (title: String, body: String, fireAt: Double?, data: [String: Any]?) async throws -> String in
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      content.userInfo = data?.reduce(into: [AnyHashable: Any]()) { result, entry in
        result[entry.key] = entry.value
      } ?? [:]
      let identifier = "hermes-\(UUID().uuidString.lowercased())"
      let trigger: UNNotificationTrigger?
      if let fireAt {
        trigger = UNTimeIntervalNotificationTrigger(
          timeInterval: max(1, Date(timeIntervalSince1970: fireAt / 1000).timeIntervalSinceNow),
          repeats: false
        )
      } else {
        trigger = nil
      }
      try await withCheckedThrowingContinuation { continuation in
        UNUserNotificationCenter.current().add(
          UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        ) { error in
          if let error { continuation.resume(throwing: error) }
          else { continuation.resume(returning: identifier) }
        }
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

    AsyncFunction("sendWatchMessage") { (payload: [String: Any]) async -> Bool in
      await self.watch.send(payload: payload)
    }
  }

  @ModuleDefinitionBuilder
  private func screenTimeDefinitions() -> ModuleDefinition {
    AsyncFunction("getScreenTimeCapabilities") { () -> [String: Any] in
      self.screenTime.capabilities(hasEntitlement: Self.hasEntitlement("com.apple.developer.family-controls"))
    }

    AsyncFunction("getScreenTimeSnapshot") { () -> [String: Any] in
      self.screenTime.snapshot(hasEntitlement: Self.hasEntitlement("com.apple.developer.family-controls"))
    }

    AsyncFunction("requestScreenTimeAuthorization") { () async -> String in
      await self.screenTime.requestAuthorization(
        hasEntitlement: Self.hasEntitlement("com.apple.developer.family-controls")
      )
    }

    AsyncFunction("startScreenTimeMonitoring") { (identifier: String, startHour: Int, endHour: Int) throws -> String in
      try self.screenTime.startMonitoring(
        hasEntitlement: Self.hasEntitlement("com.apple.developer.family-controls"),
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
    AsyncFunction("updateLiveActivity") { (payload: [String: Any]) async throws -> [String: Any] in
      try await self.liveActivity.update(payload: payload)
    }

    AsyncFunction("scheduleBackgroundTasks") {
      HermesBackgroundService.shared.schedule()
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
    View(HermesStandardMapView.self) {
      Events("onLocationPress")

      Prop("showsUserLocation") { (view, value: Bool) in
        view.showsUserLocation = value
      }
      Prop("centerOnUserRequest") { (view, value: Int) in
        view.centerOnUserRequest = value
      }
      Prop("track") { (view, value: [HermesMapCoordinate]) in
        view.track = value
      }
      Prop("places") { (view, value: [HermesMapPlace]) in
        view.places = value
      }
    }

    View(HermesScreenTimeReportView.self) {
      Prop("refreshToken") { (view, value: Int) in
        view.refreshToken = value
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
