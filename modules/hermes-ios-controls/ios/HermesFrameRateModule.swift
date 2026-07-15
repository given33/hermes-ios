import ExpoModulesCore
import ObjectiveC.runtime
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
  private var didInstallDisplayLinkPolicy = false

  func start() {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in
        self?.start()
      }
      return
    }

    screenMaximumFramesPerSecond = UIScreen.main.maximumFramesPerSecond
    installDisplayLinkPolicyIfNeeded()

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
    return [
      "screenMaximumFramesPerSecond": current.screenMaximumFramesPerSecond,
      "requestedFramesPerSecond": current.requestedFramesPerSecond,
      "measuredCallbacksPerSecond": current.measuredCallbacksPerSecond,
      "displayLinkActive": current.displayLinkActive,
      "displayLinkPolicyInstalled": current.displayLinkPolicyInstalled,
      "lowPowerMode": current.lowPowerMode,
      "thermalState": current.thermalState,
      "lastCallbackTimestamp": current.lastCallbackTimestamp,
    ]
  }

  func snapshot() -> HermesFrameRateSnapshot {
    HermesFrameRateSnapshot(
      screenMaximumFramesPerSecond: screenMaximumFramesPerSecond,
      requestedFramesPerSecond: screenMaximumFramesPerSecond >= 120 ? 120 : screenMaximumFramesPerSecond,
      measuredCallbacksPerSecond: measuredCallbacksPerSecond,
      displayLinkActive: displayLink != nil,
      displayLinkPolicyInstalled: didInstallDisplayLinkPolicy,
      lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
      thermalState: ProcessInfo.processInfo.thermalState.rawValue,
      lastCallbackTimestamp: lastCallbackTimestamp
    )
  }

  @objc private func frameRequested(_ link: CADisplayLink) {
    let timestamp = link.timestamp
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

  private func installDisplayLinkPolicyIfNeeded() {
    guard !didInstallDisplayLinkPolicy else { return }
    guard
      let original = class_getInstanceMethod(
        CADisplayLink.self,
        #selector(CADisplayLink.add(to:forMode:))
      ),
      let replacement = class_getInstanceMethod(
        CADisplayLink.self,
        #selector(CADisplayLink.hermes_add(to:forMode:))
      )
    else {
      return
    }
    method_exchangeImplementations(original, replacement)
    didInstallDisplayLinkPolicy = true
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

private extension CADisplayLink {
  @objc dynamic func hermes_add(to runLoop: RunLoop, forMode mode: RunLoop.Mode) {
    HermesFrameRateController.shared.configure(self)
    hermes_add(to: runLoop, forMode: mode)
  }
}
