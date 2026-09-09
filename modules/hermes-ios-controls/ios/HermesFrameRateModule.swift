import ExpoModulesCore
import QuartzCore
import UIKit

public final class HermesFrameRateModule: Module {
  private let controller = HermesFrameRateController.shared

  public func definition() -> ModuleDefinition {
    Name("HermesFrameRate")

    OnCreate {
      controller.start()
    }
    OnAppBecomesActive {
      controller.start()
    }
    OnAppEntersForeground {
      controller.start()
    }
    OnAppEntersBackground {
      controller.stop()
    }
    OnDestroy {
      controller.stop()
    }

    Function("start") {
      controller.start()
    }
    Function("stop") {
      controller.stop()
    }
    AsyncFunction("getDiagnostics") {
      controller.diagnostics()
    }.runOnQueue(.main)
    AsyncFunction("resetDiagnostics") {
      controller.resetDiagnostics()
    }.runOnQueue(.main)
  }
}

/// Starts before React Native so every display link, including RN's JS link,
/// inherits the ProMotion range instead of being created with a 60Hz default.
public final class HermesFrameRateAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func subscriberDidRegister() {
    HermesFrameRateController.shared.start()
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    HermesFrameRateController.shared.start()
  }

  public func applicationWillEnterForeground(_ application: UIApplication) {
    HermesFrameRateController.shared.start()
  }

  public func applicationWillResignActive(_ application: UIApplication) {
    HermesFrameRateController.shared.stop()
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    HermesFrameRateController.shared.stop()
  }
}

final class HermesFrameRateController: NSObject {
  static let shared = HermesFrameRateController()

  private var displayLink: CADisplayLink?
  private var screenMaximumFramesPerSecond = 60
  private var callbackWindowStart: CFTimeInterval = 0
  private var callbackCount = 0
  private var measuredCallbacksPerSecond = 0.0
  private var lastCallbackTimestamp: CFTimeInterval = 0
  private var frameIntervalsMs: [Double] = []
  private var sampleCursor = 0
  private var measuredFrameCount = 0
  private var delayedFrameCount = 0
  private var over50MsCount = 0
  private var maximumIntervalMs = 0.0
  private var previousExpectedInterval: CFTimeInterval = 0

  func resetDiagnostics() {
    frameIntervalsMs.removeAll(keepingCapacity: true)
    sampleCursor = 0
    measuredFrameCount = 0
    delayedFrameCount = 0
    over50MsCount = 0
    maximumIntervalMs = 0
    lastCallbackTimestamp = 0
    previousExpectedInterval = 0
  }
  func start() {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in
        self?.start()
      }
      return
    }

    screenMaximumFramesPerSecond = UIScreen.main.maximumFramesPerSecond

    let link: CADisplayLink
    if let displayLink {
      link = displayLink
    } else {
      link = CADisplayLink(target: self, selector: #selector(frameRequested(_:)))
      displayLink = link
    }
    configure(link)
    if link.isPaused {
      link.isPaused = false
    }
    if link.timestamp == 0 {
      link.add(to: RunLoop.main, forMode: .common)
    }
  }

  func stop() {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in
        self?.stop()
      }
      return
    }
    displayLink?.isPaused = true
    displayLink?.invalidate()
    displayLink = nil
    callbackWindowStart = 0
    callbackCount = 0
    measuredCallbacksPerSecond = 0
    lastCallbackTimestamp = 0
    previousExpectedInterval = 0
  }

  func configure(_ link: CADisplayLink) {
    let target = screenMaximumFramesPerSecond >= 120 ? 120 : screenMaximumFramesPerSecond
    link.preferredFramesPerSecond = target
    if #available(iOS 15.0, *) {
      let targetRate = Float(target)
      link.preferredFrameRateRange = CAFrameRateRange(
        minimum: targetRate,
        maximum: targetRate,
        preferred: targetRate
      )
    }
  }

  func diagnostics() -> [String: Any] {
    guard Thread.isMainThread else {
      return DispatchQueue.main.sync {
        diagnostics()
      }
    }
    let current = snapshot()
    let sortedIntervals = frameIntervalsMs.sorted()
    let p95 = sortedIntervals.isEmpty ? 0 : sortedIntervals[min(sortedIntervals.count - 1, Int(Double(sortedIntervals.count) * 0.95))]
    return [
      "screenMaximumFramesPerSecond": current.screenMaximumFramesPerSecond,
      "requestedFramesPerSecond": current.requestedFramesPerSecond,
      "measuredCallbacksPerSecond": current.measuredCallbacksPerSecond,
      "displayLinkActive": current.displayLinkActive,
      "displayLinkPolicyInstalled": current.displayLinkPolicyInstalled,
      "lowPowerMode": current.lowPowerMode,
      "thermalState": current.thermalState,
      "lastCallbackTimestamp": current.lastCallbackTimestamp,
      "measuredFrameCount": measuredFrameCount,
      "delayedFrameCount": delayedFrameCount,
      "over50MsCount": over50MsCount,
      "maximumIntervalMs": maximumIntervalMs,
      "recentP95IntervalMs": p95,
      "recentSampleCount": frameIntervalsMs.count,
    ]
  }

  func snapshot() -> HermesFrameRateSnapshot {
    HermesFrameRateSnapshot(
      screenMaximumFramesPerSecond: screenMaximumFramesPerSecond,
      requestedFramesPerSecond: screenMaximumFramesPerSecond >= 120 ? 120 : screenMaximumFramesPerSecond,
      measuredCallbacksPerSecond: measuredCallbacksPerSecond,
      displayLinkActive: displayLink != nil,
      displayLinkPolicyInstalled: false,
      lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
      thermalState: ProcessInfo.processInfo.thermalState.rawValue,
      lastCallbackTimestamp: lastCallbackTimestamp
    )
  }

  @objc private func frameRequested(_ link: CADisplayLink) {
    let timestamp = link.timestamp
    if lastCallbackTimestamp > 0 {
      let interval = timestamp - lastCallbackTimestamp
      let milliseconds = interval * 1000
      measuredFrameCount += 1
      maximumIntervalMs = max(maximumIntervalMs, milliseconds)
      if milliseconds > 50 { over50MsCount += 1 }
      // Compare with the previous scheduled interval, not an assumed 120 Hz:
      // iOS can change the display cadence under thermal/power constraints.
      if previousExpectedInterval > 0 && interval > previousExpectedInterval * 1.5 {
        delayedFrameCount += 1
      }
      if frameIntervalsMs.count < 600 { frameIntervalsMs.append(milliseconds) }
      else {
        frameIntervalsMs[sampleCursor] = milliseconds
        sampleCursor = (sampleCursor + 1) % 600
      }
    }
    previousExpectedInterval = max(0, link.targetTimestamp - timestamp)
    if callbackWindowStart == 0 {
      callbackWindowStart = timestamp
      callbackCount = 0
    }
    callbackCount += 1
    lastCallbackTimestamp = timestamp
    let elapsed = timestamp - callbackWindowStart
    if elapsed >= 1 {
      measuredCallbacksPerSecond = Double(callbackCount) / elapsed
      callbackWindowStart = timestamp
      callbackCount = 0
    }
  }

}

struct HermesFrameRateSnapshot {
  let screenMaximumFramesPerSecond: Int
  let requestedFramesPerSecond: Int
  let measuredCallbacksPerSecond: Double
  let displayLinkActive: Bool
  let displayLinkPolicyInstalled: Bool
  let lowPowerMode: Bool
  let thermalState: Int
  let lastCallbackTimestamp: CFTimeInterval
}
