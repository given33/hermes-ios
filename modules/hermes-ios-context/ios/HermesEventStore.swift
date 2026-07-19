import EventKit
import Foundation

final class HermesEventStore {
  static let shared = HermesEventStore()

  private let store = EKEventStore()

  func calendarAuthorizationStatus() -> String {
    Self.authorization(EKEventStore.authorizationStatus(for: .event))
  }

  func reminderAuthorizationStatus() -> String {
    Self.authorization(EKEventStore.authorizationStatus(for: .reminder))
  }

  func requestCalendarAuthorization() async -> String {
    do {
      let granted = try await store.requestFullAccessToEvents()
      return granted ? "authorized" : "denied"
    } catch {
      return "denied"
    }
  }

  func requestReminderAuthorization() async -> String {
    do {
      let granted = try await store.requestFullAccessToReminders()
      return granted ? "authorized" : "denied"
    } catch {
      return "denied"
    }
  }

  func calendarEvents(start: Date, end: Date) -> [[String: Any]] {
    guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { return [] }
    let predicate = store.predicateForEvents(withStart: min(start, end), end: max(start, end), calendars: nil)
    return store.events(matching: predicate).map { event in
      return [
        "calendar": event.calendar.title,
        "end": event.endDate.timeIntervalSince1970 * 1000,
        "id": event.eventIdentifier ?? "",
        "location": hermesNullable(event.location),
        "start": event.startDate.timeIntervalSince1970 * 1000,
        "title": event.title ?? "",
      ]
    }
  }

  func createCalendarEvent(_ input: HermesCalendarEventInput) throws -> String {
    try createCalendarEvent(input, commandURL: nil)
  }

  func createCalendarEventForCommand(
    _ input: HermesCalendarEventInput,
    commandID: String
  ) throws -> String {
    guard let commandURL = Self.commandURL(commandID) else {
      throw HermesEventError.commandIDRequired
    }
    let start = Date(timeIntervalSince1970: input.start / 1000)
    let end = Date(timeIntervalSince1970: input.end / 1000)
    let predicate = store.predicateForEvents(
      withStart: min(start, end).addingTimeInterval(-1),
      end: max(start, end).addingTimeInterval(1),
      calendars: nil
    )
    if let existing = store.events(matching: predicate).first(where: { $0.url == commandURL }) {
      return existing.eventIdentifier ?? existing.calendarItemIdentifier
    }
    return try createCalendarEvent(input, commandURL: commandURL)
  }

  private func createCalendarEvent(
    _ input: HermesCalendarEventInput,
    commandURL: URL?
  ) throws -> String {
    guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
      throw HermesEventError.calendarPermissionRequired
    }
    let event = EKEvent(eventStore: store)
    event.calendar = store.defaultCalendarForNewEvents
    event.title = input.title
    event.startDate = Date(timeIntervalSince1970: input.start / 1000)
    event.endDate = Date(timeIntervalSince1970: input.end / 1000)
    event.location = input.location
    event.notes = input.notes
    event.url = commandURL
    try store.save(event, span: .thisEvent, commit: true)
    return event.eventIdentifier ?? ""
  }

  func reminders(completed: Bool?) async -> [[String: Any]] {
    guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { return [] }
    let predicate: NSPredicate
    if completed == true {
      predicate = store.predicateForCompletedReminders(
        withCompletionDateStarting: nil,
        ending: nil,
        calendars: nil
      )
    } else if completed == false {
      predicate = store.predicateForIncompleteReminders(
        withDueDateStarting: nil,
        ending: nil,
        calendars: nil
      )
    } else {
      predicate = store.predicateForReminders(in: nil)
    }
    let values: [EKReminder] = await withCheckedContinuation { continuation in
      store.fetchReminders(matching: predicate) { reminders in
        continuation.resume(returning: reminders ?? [])
      }
    }
    return values.map { reminder in
      let dueMilliseconds = Self.date(from: reminder.dueDateComponents)
        .map { $0.timeIntervalSince1970 * 1000 }
      return [
        "completed": reminder.isCompleted,
        "due": hermesNullable(dueMilliseconds),
        "id": reminder.calendarItemIdentifier,
        "list": reminder.calendar.title,
        "title": reminder.title ?? "",
      ]
    }
  }

  func createReminder(_ input: HermesReminderInput) throws -> String {
    try createReminder(input, commandURL: nil)
  }

  func createReminderForCommand(
    _ input: HermesReminderInput,
    commandID: String
  ) async throws -> String {
    guard let commandURL = Self.commandURL(commandID) else {
      throw HermesEventError.commandIDRequired
    }
    if let existing = await reminder(with: commandURL) {
      return existing.calendarItemIdentifier
    }
    return try createReminder(input, commandURL: commandURL)
  }

  private func createReminder(
    _ input: HermesReminderInput,
    commandURL: URL?
  ) throws -> String {
    guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
      throw HermesEventError.reminderPermissionRequired
    }
    let reminder = EKReminder(eventStore: store)
    reminder.calendar = store.defaultCalendarForNewReminders()
    reminder.title = input.title
    reminder.notes = input.notes
    reminder.url = commandURL
    if let due = input.due {
      reminder.dueDateComponents = Calendar.current.dateComponents(
        [.year, .month, .day, .hour, .minute, .second, .timeZone],
        from: Date(timeIntervalSince1970: due / 1000)
      )
    }
    try store.save(reminder, commit: true)
    return reminder.calendarItemIdentifier
  }

  private func reminder(with commandURL: URL) async -> EKReminder? {
    let predicate = store.predicateForReminders(in: nil)
    return await withCheckedContinuation { continuation in
      store.fetchReminders(matching: predicate) { reminders in
        continuation.resume(returning: reminders?.first(where: { $0.url == commandURL }))
      }
    }
  }

  private static func commandURL(_ commandID: String) -> URL? {
    let normalized = commandID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return nil }
    var components = URLComponents()
    components.scheme = "hermes-agent"
    components.host = "device-command"
    components.path = "/\(normalized)"
    return components.url
  }

  private static func date(from components: DateComponents?) -> Date? {
    guard let components else { return nil }
    return components.calendar?.date(from: components) ?? Calendar.current.date(from: components)
  }

  private static func authorization(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .authorized, .fullAccess: return "authorized"
    case .writeOnly: return "limited"
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    case .denied: return "denied"
    @unknown default: return "unavailable"
    }
  }
}

private enum HermesEventError: LocalizedError {
  case calendarPermissionRequired
  case commandIDRequired
  case reminderPermissionRequired

  var errorDescription: String? {
    switch self {
    case .calendarPermissionRequired: return "Calendar full access is required."
    case .commandIDRequired: return "A device command id is required."
    case .reminderPermissionRequired: return "Reminders full access is required."
    }
  }
}
