import EventKit
import Foundation

final class HermesEventStore {
  static let shared = HermesEventStore()

  private let store = EKEventStore()

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
    guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
      throw HermesEventError.reminderPermissionRequired
    }
    let reminder = EKReminder(eventStore: store)
    reminder.calendar = store.defaultCalendarForNewReminders()
    reminder.title = input.title
    reminder.notes = input.notes
    if let due = input.due {
      reminder.dueDateComponents = Calendar.current.dateComponents(
        [.year, .month, .day, .hour, .minute, .second, .timeZone],
        from: Date(timeIntervalSince1970: due / 1000)
      )
    }
    try store.save(reminder, commit: true)
    return reminder.calendarItemIdentifier
  }

  private static func date(from components: DateComponents?) -> Date? {
    guard let components else { return nil }
    return components.calendar?.date(from: components) ?? Calendar.current.date(from: components)
  }
}

private enum HermesEventError: LocalizedError {
  case calendarPermissionRequired
  case reminderPermissionRequired

  var errorDescription: String? {
    switch self {
    case .calendarPermissionRequired: return "Calendar full access is required."
    case .reminderPermissionRequired: return "Reminders full access is required."
    }
  }
}
