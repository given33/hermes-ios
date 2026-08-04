import Foundation

enum HermesRuntimeConfiguration {
  static var nativeContextEnabled: Bool {
    Bundle.main.object(forInfoDictionaryKey: "HermesResignCompatible") as? Bool != true
  }
}
