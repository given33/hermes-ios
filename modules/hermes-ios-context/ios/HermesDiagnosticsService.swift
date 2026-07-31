import Foundation

#if canImport(MetricKit)
import MetricKit

final class HermesDiagnosticsService: NSObject, MXMetricManagerSubscriber {
  static let shared = HermesDiagnosticsService()
  private static let maxPayloadBytes = 512 * 1024
  private let lock = NSLock()
  private var started = false
  private var metricsReceived = 0
  private var diagnosticsReceived = 0

  private override init() { super.init() }

  func start() {
    lock.lock()
    guard !started else { lock.unlock(); return }
    started = true
    lock.unlock()
    MXMetricManager.shared.add(self)
  }

  func stop() {
    lock.lock()
    guard started else { lock.unlock(); return }
    started = false
    lock.unlock()
    MXMetricManager.shared.remove(self)
  }

  func status() -> [String: Any] {
    lock.lock()
    defer { lock.unlock() }
    return [
      "available": true,
      "started": started,
      "metricsReceived": metricsReceived,
      "diagnosticsReceived": diagnosticsReceived,
    ]
  }

  func didReceive(_ payloads: [MXMetricPayload]) {
    lock.lock()
    metricsReceived += payloads.count
    lock.unlock()
    for payload in payloads {
      var event: [String: Any] = [
        "kind": "metric",
        "begin": payload.timeStampBegin.timeIntervalSince1970 * 1000,
        "end": payload.timeStampEnd.timeIntervalSince1970 * 1000,
      ]
      Self.attachJSONRepresentation(payload.jsonRepresentation(), to: &event)
      _ = HermesContextEventQueue.shared.enqueue(type: "ios-diagnostics", payload: event)
    }
  }

  func didReceive(_ payloads: [MXDiagnosticPayload]) {
    lock.lock()
    diagnosticsReceived += payloads.count
    lock.unlock()
    for payload in payloads {
      var event: [String: Any] = [
        "kind": "diagnostic",
        "begin": payload.timeStampBegin.timeIntervalSince1970 * 1000,
        "end": payload.timeStampEnd.timeIntervalSince1970 * 1000,
      ]
      Self.attachJSONRepresentation(payload.jsonRepresentation(), to: &event)
      _ = HermesContextEventQueue.shared.enqueue(type: "ios-diagnostics", payload: event)
    }
  }

  private static func attachJSONRepresentation(_ data: Data, to event: inout [String: Any]) {
    guard data.count <= maxPayloadBytes,
          let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
      event["payloadBytes"] = data.count
      event["payloadTruncated"] = true
      return
    }
    event["payload"] = object
  }
}
#else

final class HermesDiagnosticsService {
  static let shared = HermesDiagnosticsService()
  func start() {}
  func stop() {}
  func status() -> [String: Any] { ["available": false, "started": false] }
}
#endif
