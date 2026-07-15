import ExpoModulesCore
import QuartzCore
import UIKit

public final class HermesFrameRateModule: Module {
  private let controller = HermesFrameRateController()

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
  }
}

private final class HermesFrameRateController: NSObject {
  private var displayLink: CADisplayLink?

  func start() {
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(frameRequested))
    let maximum = UIScreen.main.maximumFramesPerSecond
    link.preferredFramesPerSecond = maximum
    if #available(iOS 15.0, *) {
      let maximumRate = Float(maximum)
      link.preferredFrameRateRange = CAFrameRateRange(
        minimum: maximumRate,
        maximum: maximumRate,
        preferred: maximumRate
      )
    }
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  func stop() {
    displayLink?.invalidate()
    displayLink = nil
  }

  @objc private func frameRequested() {}
}
