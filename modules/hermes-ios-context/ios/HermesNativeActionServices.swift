import Foundation
import AVFoundation
import Contacts
import CoreImage
import MediaPlayer
import Photos
import UIKit
import Vision

#if canImport(CoreBluetooth)
import CoreBluetooth
#endif

#if canImport(CoreNFC)
import CoreNFC

final class HermesNFCService: NSObject, NFCNDEFReaderSessionDelegate {
  static let shared = HermesNFCService()
  private var session: NFCNDEFReaderSession?
  private var continuation: CheckedContinuation<[String: Any], Error>?

  private override init() {}

  func scan() async throws -> [String: Any] {
    guard NFCNDEFReaderSession.readingAvailable else {
      throw HermesNativeActionError.unavailable("nfc-reader-session")
    }
    guard continuation == nil else {
      throw HermesNativeActionError.unavailable("nfc-reader-busy")
    }
    return try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      let session = NFCNDEFReaderSession(delegate: self, queue: .main, invalidateAfterFirstRead: true)
      session.alertMessage = "Hold your iPhone near an NFC tag."
      self.session = session
      session.begin()
    }
  }

  func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
    self.session = nil
    let continuation = self.continuation
    self.continuation = nil
    continuation?.resume(throwing: error)
  }

  func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
    let records = messages.flatMap { $0.records }.map { record in
      [
        "type": String(decoding: record.type, as: UTF8.self),
        "identifier": String(decoding: record.identifier, as: UTF8.self),
        "payload": record.payload.base64EncodedString(),
        "payloadText": String(decoding: record.payload, as: UTF8.self),
      ]
    }
    session.alertMessage = "Tag read."
    session.invalidate()
    self.session = nil
    let continuation = self.continuation
    self.continuation = nil
    continuation?.resume(returning: ["records": records])
  }
}
#endif

#if canImport(HomeKit)
import HomeKit
#endif

enum HermesNativeActionError: LocalizedError {
  case authorizationRequired(String)
  case unavailable(String)
  case invalidInput(String)

  var errorDescription: String? {
    switch self {
    case .authorizationRequired(let capability):
      return "\(capability) permission is required."
    case .unavailable(let capability):
      return "\(capability) is unavailable on this device or build."
    case .invalidInput(let field):
      return "\(field) is invalid."
    }
  }
}

enum HermesContactsService {
  static func authorization() -> String {
    switch CNContactStore.authorizationStatus(for: .contacts) {
    case .authorized: return "authorized"
    case .limited: return "limited"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  static func requestAuthorization() async throws -> String {
    let store = CNContactStore()
    let granted = try await store.requestAccess(for: .contacts)
    return granted ? "authorized" : authorization()
  }

  static func search(query: String?, limit: Int) throws -> [[String: Any]] {
    guard authorization() == "authorized" || authorization() == "limited" else {
      throw HermesNativeActionError.authorizationRequired("contacts")
    }
    let normalizedQuery = query?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    let cappedLimit = min(max(limit, 1), 100)
    let keys: [CNKeyDescriptor] = [
      CNContactIdentifierKey as NSString,
      CNContactGivenNameKey as NSString,
      CNContactFamilyNameKey as NSString,
      CNContactOrganizationNameKey as NSString,
      CNContactPhoneNumbersKey as NSString,
      CNContactEmailAddressesKey as NSString,
    ]
    let request = CNFetchRequest(keysToFetch: keys)
    var result: [[String: Any]] = []
    try CNContactStore().enumerateContacts(with: request) { contact, stop in
      if !normalizedQuery.isEmpty {
        let haystack = [
          contact.givenName,
          contact.familyName,
          contact.organizationName,
          contact.phoneNumbers.map { $0.value.stringValue }.joined(separator: " "),
          contact.emailAddresses.map { String($0.value) }.joined(separator: " "),
        ].joined(separator: " ").lowercased()
        guard haystack.contains(normalizedQuery) else { return }
      }
      result.append(serialize(contact))
      if result.count >= cappedLimit { stop.pointee = true }
    }
    return result
  }

  static func create(
    givenName: String,
    familyName: String?,
    organization: String?,
    phone: String?,
    email: String?
  ) throws -> [String: Any] {
    guard authorization() == "authorized" || authorization() == "limited" else {
      throw HermesNativeActionError.authorizationRequired("contacts")
    }
    guard !givenName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw HermesNativeActionError.invalidInput("givenName")
    }
    let contact = CNMutableContact()
    contact.givenName = givenName.trimmingCharacters(in: .whitespacesAndNewlines)
    contact.familyName = familyName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    contact.organizationName = organization?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if let phone, !phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))]
    }
    if let email, !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      contact.emailAddresses = [CNLabeledValue(label: CNLabelHome, value: email as NSString)]
    }
    let store = CNContactStore()
    let save = CNSaveRequest()
    save.add(contact, toContainerWithIdentifier: nil)
    try store.execute(save)
    return serialize(contact)
  }

  private static func serialize(_ contact: CNContact) -> [String: Any] {
    [
      "id": contact.identifier,
      "givenName": contact.givenName,
      "familyName": contact.familyName,
      "organization": contact.organizationName,
      "phones": contact.phoneNumbers.map { $0.value.stringValue },
      "emails": contact.emailAddresses.map { String($0.value) },
    ]
  }
}

enum HermesPhotosService {
  static func authorization() -> String {
    switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
    case .authorized: return "authorized"
    case .limited: return "limited"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  static func requestAuthorization() async -> String {
    let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    switch status {
    case .authorized: return "authorized"
    case .limited: return "limited"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  static func search(query: String?, start: Double?, end: Double?, limit: Int) throws -> [[String: Any]] {
    guard authorization() == "authorized" || authorization() == "limited" else {
      throw HermesNativeActionError.authorizationRequired("photos")
    }
    let normalizedQuery = query?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    let options = PHFetchOptions()
    var predicates: [NSPredicate] = []
    if let start { predicates.append(NSPredicate(format: "creationDate >= %@", Date(timeIntervalSince1970: start / 1000) as NSDate)) }
    if let end { predicates.append(NSPredicate(format: "creationDate <= %@", Date(timeIntervalSince1970: end / 1000) as NSDate)) }
    if !predicates.isEmpty { options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates) }
    options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    let assets = PHAsset.fetchAssets(with: .image, options: options)
    let cappedLimit = min(max(limit, 1), 100)
    var result: [[String: Any]] = []
    assets.enumerateObjects { asset, _, stop in
      guard result.count < cappedLimit else { stop.pointee = true; return }
      let resources = PHAssetResource.assetResources(for: asset)
      let filename = resources.first?.originalFilename ?? ""
      if !normalizedQuery.isEmpty && !filename.lowercased().contains(normalizedQuery) { return }
      result.append([
        "id": asset.localIdentifier,
        "filename": filename,
        "createdAt": (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
        "width": asset.pixelWidth,
        "height": asset.pixelHeight,
        "favorite": asset.isFavorite,
        "location": asset.location.map { ["latitude": $0.coordinate.latitude, "longitude": $0.coordinate.longitude] } as Any,
      ])
    }
    return result
  }

  static func recognizeText(
    imageURL: String,
    recognitionLevel: String?,
    languages: [String]?
  ) throws -> [String: Any] {
    let normalizedURL = imageURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: normalizedURL), url.isFileURL,
          FileManager.default.fileExists(atPath: url.path) else {
      throw HermesNativeActionError.invalidInput("imageURL")
    }
    guard let image = CIImage(contentsOf: url) else {
      throw HermesNativeActionError.invalidInput("imageURL")
    }
    var recognized: [[String: Any]] = []
    let request = VNRecognizeTextRequest { request, error in
      guard error == nil,
            let observations = request.results as? [VNRecognizedTextObservation] else { return }
      recognized = observations.compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        return [
          "text": candidate.string,
          "confidence": candidate.confidence,
          "boundingBox": [
            "x": observation.boundingBox.origin.x,
            "y": observation.boundingBox.origin.y,
            "width": observation.boundingBox.size.width,
            "height": observation.boundingBox.size.height,
          ],
        ]
      }
    }
    request.recognitionLevel = recognitionLevel?.lowercased() == "fast" ? .fast : .accurate
    request.usesLanguageCorrection = true
    if let languages, !languages.isEmpty {
      request.recognitionLanguages = Array(languages.prefix(8))
    }
    try VNImageRequestHandler(ciImage: image, options: [:]).perform([request])
    return [
      "text": recognized.map { $0["text"] as? String ?? "" }.joined(separator: "\n"),
      "items": recognized,
      "imageURL": normalizedURL,
    ]
  }
}

enum HermesMediaService {
  static func authorization() -> String {
    switch MPMediaLibrary.authorizationStatus() {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  static func requestAuthorization() async -> String {
    let status = await withCheckedContinuation { continuation in
      MPMediaLibrary.requestAuthorization { continuation.resume(returning: $0) }
    }
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  static func snapshot() -> [String: Any] {
    let player = MPMusicPlayerController.systemMusicPlayer
    var result: [String: Any] = [
      "playbackState": playbackState(player.playbackState),
      "volume": player.volume,
    ]
    if let item = player.nowPlayingItem {
      result["title"] = item.title ?? ""
      result["artist"] = item.artist ?? ""
      result["album"] = item.albumTitle ?? ""
      result["duration"] = item.playbackDuration
    }
    return result
  }

  static func control(_ action: String) throws -> [String: Any] {
    let player = MPMusicPlayerController.systemMusicPlayer
    switch action.lowercased() {
    case "play", "resume": player.play()
    case "pause": player.pause()
    case "next", "skip-next": player.skipToNextItem()
    case "previous", "skip-previous": player.skipToPreviousItem()
    case "stop": player.stop()
    default: throw HermesNativeActionError.invalidInput("action")
    }
    return snapshot()
  }

  private static func playbackState(_ state: MPMusicPlaybackState) -> String {
    switch state {
    case .playing: return "playing"
    case .paused: return "paused"
    case .interrupted: return "interrupted"
    case .stopped: return "stopped"
    @unknown default: return "unknown"
    }
  }
}

final class HermesQRScannerService: NSObject, AVCaptureMetadataOutputObjectsDelegate {
  static let shared = HermesQRScannerService()
  private var session: AVCaptureSession?
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private weak var controller: UIViewController?
  private var continuation: CheckedContinuation<[String: Any], Error>?

  private override init() {}

  func scan() async throws -> [String: Any] {
    guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      throw HermesNativeActionError.authorizationRequired("camera")
    }
    guard continuation == nil else {
      throw HermesNativeActionError.unavailable("camera-scanner-busy")
    }
    return try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      DispatchQueue.main.async { [weak self] in self?.presentScanner() }
    }
  }

  private func presentScanner() {
    guard let presenter = Self.topViewController() else {
      finish(error: HermesNativeActionError.unavailable("camera-scanner"))
      return
    }
    let captureSession = AVCaptureSession()
    guard let device = AVCaptureDevice.default(for: .video),
          let input = try? AVCaptureDeviceInput(device: device),
          captureSession.canAddInput(input) else {
      finish(error: HermesNativeActionError.unavailable("camera-scanner"))
      return
    }
    captureSession.addInput(input)
    let output = AVCaptureMetadataOutput()
    guard captureSession.canAddOutput(output) else {
      finish(error: HermesNativeActionError.unavailable("camera-scanner"))
      return
    }
    captureSession.addOutput(output)
    output.setMetadataObjectsDelegate(self, queue: .main)
    output.metadataObjectTypes = [.qr, .ean8, .ean13, .code128, .code39, .dataMatrix, .pdf417, .aztec]
    let scanner = HermesQRScannerViewController()
    scanner.onCancel = { [weak self] in
      self?.finish(error: CancellationError())
    }
    scanner.view.backgroundColor = .black
    let preview = AVCaptureVideoPreviewLayer(session: captureSession)
    preview.videoGravity = .resizeAspectFill
    preview.frame = UIScreen.main.bounds
    scanner.view.layer.addSublayer(preview)
    presenter.present(scanner, animated: true) { captureSession.startRunning() }
    session = captureSession
    previewLayer = preview
    controller = scanner
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
          let value = object.stringValue, !value.isEmpty else { return }
    finish(result: ["value": value, "type": object.type.rawValue])
  }

  private func finish(result: [String: Any]? = nil, error: Error? = nil) {
    session?.stopRunning()
    session = nil
    previewLayer = nil
    let controller = self.controller
    self.controller = nil
    controller?.dismiss(animated: true)
    let continuation = self.continuation
    self.continuation = nil
    if let error { continuation?.resume(throwing: error) }
    else { continuation?.resume(returning: result ?? [:]) }
  }

  private static func topViewController() -> UIViewController? {
    let window = UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.keyWindow }
      .first
    var current = window?.rootViewController
    while let next = current?.presentedViewController { current = next }
    return current
  }
}

private final class HermesQRScannerViewController: UIViewController {
  var onCancel: (() -> Void)?

  override func viewDidLoad() {
    super.viewDidLoad()
    let close = UIButton(type: .system)
    close.setTitle("Cancel", for: .normal)
    close.setTitleColor(.white, for: .normal)
    close.backgroundColor = UIColor.black.withAlphaComponent(0.65)
    close.layer.cornerRadius = 10
    close.contentEdgeInsets = UIEdgeInsets(top: 8, left: 14, bottom: 8, right: 14)
    close.addTarget(self, action: #selector(cancelScan), for: .touchUpInside)
    close.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(close)
    NSLayoutConstraint.activate([
      close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
      close.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
    ])
  }

  @objc private func cancelScan() {
    onCancel?()
  }
}

#if canImport(CoreBluetooth)
final class HermesBluetoothService: NSObject, CBCentralManagerDelegate {
  static let shared = HermesBluetoothService()
  private var manager: CBCentralManager!
  private var scanContinuation: CheckedContinuation<[[String: Any]], Error>?
  private var scanResults: [[String: Any]] = []
  private var scanTask: Task<Void, Never>?
  private var stateWaiters: [CheckedContinuation<CBCentralManagerState, Never>] = []

  private override init() {
    super.init()
    manager = CBCentralManager(delegate: self, queue: .main)
  }

  func state() -> String { bluetoothState(manager.state) }

  func scan(seconds: Double) async throws -> [[String: Any]] {
    if scanContinuation != nil || scanTask != nil {
      finishScan()
    }
    let currentState = manager.state
    let resolvedState: CBCentralManagerState
    if currentState == .unknown || currentState == .resetting {
      resolvedState = await withCheckedContinuation { continuation in
        stateWaiters.append(continuation)
        // CoreBluetooth can publish the initial state between the first read
        // and delegate callback. Re-check after registering the waiter so a
        // fast state transition cannot leave the command suspended forever.
        let stateAfterRegistration = manager.state
        if stateAfterRegistration != .unknown && stateAfterRegistration != .resetting {
          let waiters = stateWaiters
          stateWaiters.removeAll()
          waiters.forEach { $0.resume(returning: stateAfterRegistration) }
        }
      }
    } else {
      resolvedState = currentState
    }
    guard resolvedState == .poweredOn else { throw HermesNativeActionError.unavailable("bluetooth") }
    scanResults = []
    manager.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        scanContinuation = continuation
        scanTask = Task { [weak self] in
          let nanoseconds = UInt64(max(1, min(seconds, 15)) * 1_000_000_000)
          try? await Task.sleep(nanoseconds: nanoseconds)
          guard !Task.isCancelled else { return }
          self?.finishScan()
        }
      }
    } onCancel: { [weak self] in
      self?.finishScan()
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard !stateWaiters.isEmpty else { return }
    let waiters = stateWaiters
    stateWaiters.removeAll()
    waiters.forEach { $0.resume(returning: central.state) }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard scanResults.first(where: { $0["id"] as? String == peripheral.identifier.uuidString }) == nil else { return }
    scanResults.append(["id": peripheral.identifier.uuidString, "name": peripheral.name ?? "", "rssi": RSSI.intValue])
  }

  private func finishScan() {
    manager.stopScan()
    scanTask?.cancel()
    scanTask = nil
    let continuation = scanContinuation
    scanContinuation = nil
    continuation?.resume(returning: scanResults)
  }

  private func bluetoothState(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "poweredOn"
    case .poweredOff: return "poweredOff"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .resetting: return "resetting"
    case .unknown: return "unknown"
    @unknown default: return "unknown"
    }
  }
}
#endif

#if canImport(HomeKit)
final class HermesHomeKitService: NSObject, HMHomeManagerDelegate {
  static let shared = HermesHomeKitService()
  private let manager = HMHomeManager()
  private override init() {
    super.init()
    manager.delegate = self
  }
  func snapshot() -> [[String: Any]] {
    manager.homes.map { home in
      [
        "id": home.uniqueIdentifier.uuidString,
        "name": home.name,
        "primary": home.isPrimary,
        "accessories": home.accessories.map { accessory in
          [
            "id": accessory.uniqueIdentifier.uuidString,
            "name": accessory.name,
            "reachable": accessory.isReachable,
            "services": accessory.services.map { service in
              [
                "id": service.uniqueIdentifier.uuidString,
                "name": service.name,
                "type": service.serviceType,
                "characteristics": service.characteristics.map { characteristic in
                  [
                    "id": characteristic.uniqueIdentifier.uuidString,
                    "name": characteristic.localizedDescription,
                    "type": characteristic.characteristicType,
                    "value": characteristic.value ?? NSNull(),
                    "writable": characteristic.properties.contains(.write),
                  ]
                },
              ]
            },
          ]
        },
      ]
    }
  }

  func set(accessoryID: String, characteristicID: String, value: Any) async throws -> [String: Any] {
    guard let characteristic = manager.homes
      .flatMap({ $0.accessories })
      .first(where: { $0.uniqueIdentifier.uuidString == accessoryID })?
      .services
      .flatMap({ $0.characteristics })
      .first(where: { $0.uniqueIdentifier.uuidString == characteristicID }) else {
      throw HermesNativeActionError.invalidInput("HomeKit characteristic")
    }
    let writeValue: Any
    if let value = value as? Bool { writeValue = value }
    else if let value = value as? NSNumber { writeValue = value }
    else if let value = value as? String { writeValue = value }
    else { throw HermesNativeActionError.invalidInput("value") }
    try await withCheckedThrowingContinuation { continuation in
      characteristic.writeValue(writeValue) { error in
        if let error { continuation.resume(throwing: error) }
        else { continuation.resume(returning: ()) }
      }
    }
    return ["accessoryID": accessoryID, "characteristicID": characteristicID, "written": true]
  }

  func homeManagerDidUpdateHomes(_ manager: HMHomeManager) {}
}
#endif
