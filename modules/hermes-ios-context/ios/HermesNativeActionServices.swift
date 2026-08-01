import Foundation
import AVFoundation
import Contacts
import CoreImage
import CoreLocation
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
  private var writeMessage: NFCNDEFMessage?

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

  func write(text: String) async throws -> [String: Any] {
    guard NFCNDEFReaderSession.readingAvailable else {
      throw HermesNativeActionError.unavailable("nfc-reader-session")
    }
    guard continuation == nil else { throw HermesNativeActionError.unavailable("nfc-reader-busy") }
    let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty, normalized.count <= 4_000 else {
      throw HermesNativeActionError.invalidInput("text")
    }
    let language = Data("en".utf8)
    var payload = Data([0x02, UInt8(language.count)])
    payload.append(language)
    payload.append(Data(normalized.utf8))
    writeMessage = NFCNDEFMessage(records: [NFCNDEFPayload(format: .nfcWellKnown, type: Data("T".utf8), identifier: Data(), payload: payload)])
    return try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      let session = NFCNDEFReaderSession(delegate: self, queue: .main, invalidateAfterFirstRead: true)
      session.alertMessage = "Hold your iPhone near an NFC tag to write."
      self.session = session
      session.begin()
    }
  }

  func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
    self.session = nil
    writeMessage = nil
    let continuation = self.continuation
    self.continuation = nil
    continuation?.resume(throwing: error)
  }

  func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
    guard writeMessage == nil else { return }
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

  func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
    guard let tag = tags.first, let message = writeMessage else { return }
    session.connect(to: tag) { [weak self] error in
      guard let self else { return }
      if let error { self.finishWrite(error: error); return }
      tag.queryNDEFStatus { status, _, error in
        if let error { self.finishWrite(error: error); return }
        guard status == .readWrite else { self.finishWrite(error: HermesNativeActionError.unavailable("nfc-tag-read-only")); return }
        tag.writeNDEF(message) { error in
          if let error { self.finishWrite(error: error) }
          else { self.finishWrite(result: ["written": true, "recordCount": message.records.count]) }
        }
      }
    }
  }

  private func finishWrite(result: [String: Any]? = nil, error: Error? = nil) {
    session?.alertMessage = error == nil ? "Tag written." : "Unable to write tag."
    session?.invalidate()
    session = nil
    writeMessage = nil
    let pending = continuation
    continuation = nil
    if let error { pending?.resume(throwing: error) }
    else { pending?.resume(returning: result ?? [:]) }
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
    let request = CNContactFetchRequest(keysToFetch: keys)
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

  static func search(query: String?, start: Double?, end: Double?, limit: Int, mediaType: String? = nil) throws -> [[String: Any]] {
    guard authorization() == "authorized" || authorization() == "limited" else {
      throw HermesNativeActionError.authorizationRequired("photos")
    }
    let normalizedQuery = query?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    let options = PHFetchOptions()
    var predicates: [NSPredicate] = []
    if let start { predicates.append(NSPredicate(format: "creationDate >= %@", Date(timeIntervalSince1970: start / 1000) as NSDate)) }
    if let end { predicates.append(NSPredicate(format: "creationDate <= %@", Date(timeIntervalSince1970: end / 1000) as NSDate)) }
    if let start, let end, end < start { throw HermesNativeActionError.invalidInput("dateRange") }
    if !predicates.isEmpty { options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates) }
    options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    let requestedType = mediaType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let mediaTypes: [PHAssetMediaType]
    switch requestedType {
    case nil, "":
      // An omitted media type means the agent asked for the complete photo
      // library, not an image-only shortcut. Fetch both asset classes and
      // merge them below so creation-date ordering remains deterministic.
      mediaTypes = [.image, .video]
    case "image":
      mediaTypes = [.image]
    case "video":
      mediaTypes = [.video]
    default:
      throw HermesNativeActionError.invalidInput("mediaType")
    }
    var assets: [PHAsset] = []
    for mediaType in mediaTypes {
      let fetched = PHAsset.fetchAssets(with: mediaType, options: options)
      fetched.enumerateObjects { asset, _, _ in assets.append(asset) }
    }
    assets.sort {
      ($0.creationDate ?? .distantPast) > ($1.creationDate ?? .distantPast)
    }
    let cappedLimit = min(max(limit, 1), 100)
    var result: [[String: Any]] = []
    for asset in assets {
      guard result.count < cappedLimit else { break }
      let resources = PHAssetResource.assetResources(for: asset)
      let filename = resources.first?.originalFilename ?? ""
      if !normalizedQuery.isEmpty && !filename.lowercased().contains(normalizedQuery) { continue }
      result.append([
        "id": asset.localIdentifier,
        "filename": filename,
        "createdAt": (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
        "width": asset.pixelWidth,
        "height": asset.pixelHeight,
        "mediaType": asset.mediaType == .video ? "video" : "image",
        "favorite": asset.isFavorite,
        "location": asset.location.map { ["latitude": $0.coordinate.latitude, "longitude": $0.coordinate.longitude] } as Any,
      ])
    }
    return result
  }

  static func albums(limit: Int) throws -> [[String: Any]] {
    guard authorization() == "authorized" || authorization() == "limited" else {
      throw HermesNativeActionError.authorizationRequired("photos")
    }
    let cappedLimit = min(max(limit, 1), 100)
    var result: [[String: Any]] = []
    let collections = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
    collections.enumerateObjects { collection, _, stop in
      guard result.count < cappedLimit else { stop.pointee = true; return }
      let assets = PHAsset.fetchAssets(in: collection, options: nil)
      result.append([
        "id": collection.localIdentifier,
        "title": collection.localizedTitle ?? "",
        "assetCount": assets.count,
        "kind": "album",
      ])
    }
    return result
  }

  static func nearby(latitude: Double, longitude: Double, radiusMeters: Double, limit: Int) throws -> [[String: Any]] {
    guard authorization() == "authorized" || authorization() == "limited" else {
      throw HermesNativeActionError.authorizationRequired("photos")
    }
    guard latitude.isFinite, longitude.isFinite, radiusMeters.isFinite,
          abs(latitude) <= 90, abs(longitude) <= 180, radiusMeters > 0 else {
      throw HermesNativeActionError.invalidInput("location")
    }
    var assets: [PHAsset] = []
    for mediaType in [PHAssetMediaType.image, .video] {
      let fetched = PHAsset.fetchAssets(with: mediaType, options: nil)
      fetched.enumerateObjects { asset, _, _ in assets.append(asset) }
    }
    assets.sort {
      let left = $0.creationDate ?? .distantPast
      let right = $1.creationDate ?? .distantPast
      return left > right
    }
    let cappedLimit = min(max(limit, 1), 100)
    let origin = CLLocation(latitude: latitude, longitude: longitude)
    var result: [[String: Any]] = []
    for asset in assets {
      guard result.count < cappedLimit else { break }
      guard let location = asset.location, origin.distance(from: location) <= radiusMeters else { continue }
      let filename = PHAssetResource.assetResources(for: asset).first?.originalFilename ?? ""
      result.append([
        "id": asset.localIdentifier,
        "filename": filename,
        "createdAt": (asset.creationDate?.timeIntervalSince1970 ?? 0) * 1000,
        "mediaType": asset.mediaType == .video ? "video" : "image",
        "latitude": location.coordinate.latitude,
        "longitude": location.coordinate.longitude,
        "distanceMeters": origin.distance(from: location),
      ])
    }
    return result
  }

  static func updateFavorite(assetIDs: [String], favorite: Bool) async throws -> [String: Any] {
    guard authorization() == "authorized" else {
      throw HermesNativeActionError.authorizationRequired("photos-write")
    }
    let ids = Array(Set(assetIDs.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).prefix(100)
    guard !ids.isEmpty else { throw HermesNativeActionError.invalidInput("assetIDs") }
    let assets = PHAsset.fetchAssets(withLocalIdentifiers: Array(ids), options: nil)
    try await performChanges {
      assets.enumerateObjects { asset, _, _ in
        PHAssetChangeRequest(for: asset).isFavorite = favorite
      }
    }
    return ["updated": assets.count, "favorite": favorite]
  }

  static func delete(assetIDs: [String]) async throws -> [String: Any] {
    guard authorization() == "authorized" else {
      throw HermesNativeActionError.authorizationRequired("photos-write")
    }
    let ids = Array(Set(assetIDs.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).prefix(100)
    guard !ids.isEmpty else { throw HermesNativeActionError.invalidInput("assetIDs") }
    let assets = PHAsset.fetchAssets(withLocalIdentifiers: Array(ids), options: nil)
    try await performChanges { PHAssetChangeRequest.deleteAssets(assets) }
    return ["deleted": assets.count]
  }

  static func createAlbum(title: String) async throws -> [String: Any] {
    guard authorization() == "authorized" else {
      throw HermesNativeActionError.authorizationRequired("photos-write")
    }
    let normalized = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty, normalized.count <= 120 else {
      throw HermesNativeActionError.invalidInput("title")
    }
    var identifier: String?
    try await performChanges {
      let request = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: normalized)
      identifier = request.placeholderForCreatedAssetCollection.localIdentifier
    }
    return ["id": identifier ?? "", "title": normalized]
  }

  static func addToAlbum(assetIDs: [String], albumID: String) async throws -> [String: Any] {
    guard authorization() == "authorized" else {
      throw HermesNativeActionError.authorizationRequired("photos-write")
    }
    let normalizedAlbum = albumID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedAlbum.isEmpty else { throw HermesNativeActionError.invalidInput("albumID") }
    guard let album = PHAssetCollection.fetchAssetCollections(
      withLocalIdentifiers: [normalizedAlbum], options: nil
    ).firstObject else { throw HermesNativeActionError.invalidInput("albumID") }
    let ids = Array(Set(assetIDs.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).prefix(100)
    guard !ids.isEmpty else { throw HermesNativeActionError.invalidInput("assetIDs") }
    let assets = PHAsset.fetchAssets(withLocalIdentifiers: Array(ids), options: nil)
    try await performChanges {
      guard let request = PHAssetCollectionChangeRequest(for: album) else { return }
      request.addAssets(assets)
    }
    return ["added": assets.count, "albumID": normalizedAlbum]
  }

  static func importImage(owner: String, imageURL: String) async throws -> [String: Any] {
    guard authorization() == "authorized" else {
      throw HermesNativeActionError.authorizationRequired("photos-write")
    }
    try HermesAttachmentVault.shared.requireAllowedImportSource(owner: owner, uri: imageURL)
    guard let url = URL(string: imageURL), url.isFileURL else {
      throw HermesNativeActionError.invalidInput("imageURL")
    }
    var identifier: String?
    if let image = UIImage(contentsOfFile: url.path) {
      try await performChanges {
        identifier = PHAssetChangeRequest.creationRequestForAsset(from: image).placeholderForCreatedAsset?.localIdentifier
      }
    } else {
      let videoExtensions: Set<String> = ["mov", "mp4", "m4v", "avi", "mkv", "webm"]
      guard videoExtensions.contains(url.pathExtension.lowercased()) else {
        throw HermesNativeActionError.invalidInput("imageURL")
      }
      try await performChanges {
        if let request = PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url) {
          identifier = request.placeholderForCreatedAsset?.localIdentifier
        }
      }
    }
    return ["imported": true, "id": identifier ?? "", "mediaType": UIImage(contentsOfFile: url.path) == nil ? "video" : "image"]
  }

  static func export(assetID: String, owner: String, original: Bool) async throws -> [String: Any] {
    guard authorization() == "authorized" || authorization() == "limited" else {
      throw HermesNativeActionError.authorizationRequired("photos")
    }
    let normalizedID = assetID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [normalizedID], options: nil).firstObject else {
      throw HermesNativeActionError.invalidInput("assetID")
    }
    let root = exportRoot(owner: owner)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let name = PHAssetResource.assetResources(for: asset).first?.originalFilename ?? "photo.jpg"
    let safeName = name.replacingOccurrences(of: "/", with: "_").prefix(128)
    let target = root.appendingPathComponent("\(UUID().uuidString.lowercased())-\(safeName)")
    if asset.mediaType == .video {
      guard let resource = PHAssetResource.assetResources(for: asset).first else {
        throw HermesNativeActionError.unavailable("video-asset-data")
      }
      let options = PHAssetResourceRequestOptions()
      options.isNetworkAccessAllowed = false
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        PHAssetResourceManager.default().writeData(for: resource, toFile: target, options: options) { error in
          if let error { continuation.resume(throwing: error) }
          else { continuation.resume(returning: ()) }
        }
      }
      let bytes = (try? FileManager.default.attributesOfItem(atPath: target.path)[.size] as? NSNumber)?.intValue ?? 0
      return [
        "uri": target.absoluteString,
        "name": target.lastPathComponent,
        "mimeType": videoMimeType(for: target.pathExtension),
        "bytes": bytes,
        "assetID": normalizedID,
        "mediaType": "video",
      ]
    }
    let options = PHImageRequestOptions()
    options.isSynchronous = true
    options.isNetworkAccessAllowed = false
    options.deliveryMode = original ? .highQualityFormat : .fastFormat
    var data: Data?
    PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { imageData, _, _, _ in data = imageData }
    guard let data else { throw HermesNativeActionError.unavailable("photo-asset-data") }
    try data.write(to: target, options: .completeFileProtection)
    return [
      "uri": target.absoluteString,
      "name": target.lastPathComponent,
      "mimeType": "image/\(target.pathExtension.lowercased())",
      "bytes": data.count,
      "assetID": normalizedID,
      "mediaType": "image",
    ]
  }

  static func deleteExport(owner: String, uri: String) throws -> Bool {
    guard let url = URL(string: uri), url.isFileURL else {
      throw HermesNativeActionError.invalidInput("exportURI")
    }
    let root = exportRoot(owner: owner).standardizedFileURL
    let target = url.standardizedFileURL
    guard target.path.hasPrefix(root.path + "/") else {
      throw HermesNativeActionError.invalidInput("exportURI")
    }
    guard FileManager.default.fileExists(atPath: target.path) else { return false }
    try FileManager.default.removeItem(at: target)
    return true
  }

  static func visionImage(imageURL: String, owner: String) throws -> CIImage {
    let normalizedURL = imageURL.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalizedURL.lowercased().hasPrefix("ph://") {
      guard authorization() == "authorized" || authorization() == "limited" else {
        throw HermesNativeActionError.authorizationRequired("photos")
      }
      let assetID = String(normalizedURL.dropFirst("ph://".count))
      guard !assetID.isEmpty,
            let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetID], options: nil).firstObject else {
        throw HermesNativeActionError.invalidInput("imageURL")
      }
      let options = PHImageRequestOptions()
      options.isSynchronous = true
      options.isNetworkAccessAllowed = false
      options.deliveryMode = .highQualityFormat
      var imageData: Data?
      PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) {
        data, _, _, _ in
        imageData = data
      }
      guard let imageData, let image = CIImage(data: imageData) else {
        throw HermesNativeActionError.unavailable("photo-asset-data")
      }
      return image
    }
    guard let url = URL(string: normalizedURL), url.isFileURL,
          FileManager.default.fileExists(atPath: url.path) else {
      throw HermesNativeActionError.invalidInput("imageURL")
    }
    try HermesAttachmentVault.shared.requireAllowedImportSource(owner: owner, uri: normalizedURL)
    guard let image = CIImage(contentsOf: url) else {
      throw HermesNativeActionError.invalidInput("imageURL")
    }
    return image
  }

  private static func videoMimeType(for pathExtension: String) -> String {
    switch pathExtension.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "mp4": return "video/mp4"
    case "m4v": return "video/x-m4v"
    case "webm": return "video/webm"
    case "avi": return "video/x-msvideo"
    default: return "video/quicktime"
    }
  }

  private static func exportRoot(owner: String) -> URL {
    let account = Data(owner.utf8).map { String(format: "%02x", $0) }.joined().prefix(32)
    return FileManager.default.temporaryDirectory.appendingPathComponent(
      "hermes-photo-export-\(account)",
      isDirectory: true
    )
  }

  private static func performChanges(_ changes: @escaping () -> Void) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      PHPhotoLibrary.shared().performChanges(changes) { success, error in
        if let error { continuation.resume(throwing: error) }
        else if success { continuation.resume(returning: ()) }
        else { continuation.resume(throwing: HermesNativeActionError.unavailable("photos-write")) }
      }
    }
  }

  static func recognizeText(
    imageURL: String,
    owner: String,
    recognitionLevel: String?,
    languages: [String]?
  ) throws -> [String: Any] {
    let normalizedURL = imageURL.trimmingCharacters(in: .whitespacesAndNewlines)
    let image: CIImage
    if normalizedURL.lowercased().hasPrefix("ph://") {
      guard HermesPhotosService.authorization() == "authorized"
        || HermesPhotosService.authorization() == "limited" else {
        throw HermesNativeActionError.authorizationRequired("photos")
      }
      let assetID = String(normalizedURL.dropFirst("ph://".count))
      guard !assetID.isEmpty,
            let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetID], options: nil).firstObject else {
        throw HermesNativeActionError.invalidInput("imageURL")
      }
      let options = PHImageRequestOptions()
      options.isSynchronous = true
      options.isNetworkAccessAllowed = false
      options.deliveryMode = .highQualityFormat
      var imageData: Data?
      PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) {
        data, _, _, _ in
        imageData = data
      }
      guard let imageData, let loaded = CIImage(data: imageData) else {
        throw HermesNativeActionError.unavailable("photo-asset-data")
      }
      image = loaded
    } else {
      guard let url = URL(string: normalizedURL), url.isFileURL,
            FileManager.default.fileExists(atPath: url.path) else {
        throw HermesNativeActionError.invalidInput("imageURL")
      }
      try HermesAttachmentVault.shared.requireAllowedOCRSource(owner: owner, uri: normalizedURL)
      guard let loaded = CIImage(contentsOf: url) else {
        throw HermesNativeActionError.invalidInput("imageURL")
      }
      image = loaded
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
      "source": "owner-scoped-local-image",
    ]
  }
}

enum HermesVisionService {
  static func analyze(image: CIImage, mode: String = "analyze") throws -> [String: Any] {
    let normalizedMode = mode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard ["analyze", "classify", "detect", "faces"].contains(normalizedMode) else {
      throw HermesNativeActionError.invalidInput("visionMode")
    }
    var classifications: [[String: Any]] = []
    let classify = VNClassifyImageRequest { request, _ in
      classifications = (request.results as? [VNClassificationObservation] ?? []).prefix(20).map {
        ["identifier": $0.identifier, "confidence": $0.confidence]
      }
    }
    var rectangles: [[String: Any]] = []
    let rectangle = VNDetectRectanglesRequest { request, _ in
      rectangles = (request.results as? [VNRectangleObservation] ?? []).prefix(20).map {
        ["confidence": $0.confidence, "boundingBox": box($0.boundingBox)]
      }
    }
    var faces: [[String: Any]] = []
    let face = VNDetectFaceRectanglesRequest { request, _ in
      faces = (request.results as? [VNFaceObservation] ?? []).prefix(50).map {
        ["confidence": $0.confidence, "boundingBox": box($0.boundingBox)]
      }
    }
    let requests: [VNRequest]
    switch normalizedMode {
    case "classify": requests = [classify]
    case "detect": requests = [rectangle]
    case "faces": requests = [face]
    default: requests = [classify, rectangle, face]
    }
    try VNImageRequestHandler(ciImage: image, options: [:]).perform(requests)
    return [
      "mode": normalizedMode,
      "classifications": classifications,
      "rectangles": rectangles,
      "faces": faces,
      "model": "Vision-\(VNClassifyImageRequest().revision)",
    ]
  }

  private static func box(_ rect: CGRect) -> [String: Any] {
    ["x": rect.origin.x, "y": rect.origin.y, "width": rect.size.width, "height": rect.size.height]
  }
}

enum HermesMediaService {
  private static var volumeView: MPVolumeView?

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
      "volume": AVAudioSession.sharedInstance().outputVolume,
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

  static func search(query: String, limit: Int) throws -> [[String: Any]] {
    guard authorization() == "authorized" else { throw HermesNativeActionError.authorizationRequired("media") }
    let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { throw HermesNativeActionError.invalidInput("query") }
    return matchingItems(query: normalized, limit: limit).map { item in
      ["persistentID": NSNumber(value: item.persistentID), "title": item.title ?? "", "artist": item.artist ?? "", "album": item.albumTitle ?? ""]
    }
  }

  static func playSearch(query: String, limit: Int) throws -> [String: Any] {
    guard authorization() == "authorized" else { throw HermesNativeActionError.authorizationRequired("media") }
    let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { throw HermesNativeActionError.invalidInput("query") }
    let selected = matchingItems(query: normalized, limit: limit)
    guard !selected.isEmpty else { throw HermesNativeActionError.unavailable("media-search-empty") }
    let player = MPMusicPlayerController.systemMusicPlayer
    player.setQueue(with: MPMediaItemCollection(items: selected))
    player.play()
    return ["played": true, "matchCount": selected.count, "title": selected.first?.title ?? "", "media": snapshot()]
  }

  static func setVolume(_ rawValue: Double) throws -> [String: Any] {
    guard authorization() == "authorized" else { throw HermesNativeActionError.authorizationRequired("media") }
    guard rawValue.isFinite, rawValue >= 0, rawValue <= 1 else { throw HermesNativeActionError.invalidInput("volume") }
    // MPVolumeView only changes the system volume when it is attached to a
    // live window. Keep one hidden instance mounted for the lifetime of the
    // app; a detached temporary view silently leaves the actual volume alone.
    if volumeView == nil {
      let mounted = MPVolumeView(frame: CGRect(x: -100, y: -100, width: 1, height: 1))
      mounted.alpha = 0.01
      mounted.showsRouteButton = false
      guard let scene = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .first(where: { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }),
        let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first else {
        throw HermesNativeActionError.unavailable("media-volume-window")
      }
      window.addSubview(mounted)
      volumeView = mounted
    }
    guard let slider = volumeView?.subviews.compactMap({ $0 as? UISlider }).first else {
      throw HermesNativeActionError.unavailable("media-volume")
    }
    slider.value = Float(rawValue)
    slider.sendActions(for: .valueChanged)
    return snapshot()
  }

  private static func matchingItems(query: String, limit: Int) -> [MPMediaItem] {
    let normalized = query.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
    let cappedLimit = min(max(limit, 1), 100)
    return (MPMediaQuery.songs().items ?? []).filter { item in
      [item.title, item.artist, item.albumTitle]
        .compactMap { $0 }
        .contains { field in
          field.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current).contains(normalized)
        }
    }.prefix(cappedLimit).map { $0 }
  }

  private static func playbackState(_ state: MPMusicPlaybackState) -> String {
    switch state {
    case .playing: return "playing"
    case .paused: return "paused"
    case .interrupted: return "interrupted"
    case .stopped: return "stopped"
    case .seekingForward: return "seekingForward"
    case .seekingBackward: return "seekingBackward"
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
final class HermesBluetoothService: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  static let shared = HermesBluetoothService()
  private var manager: CBCentralManager!
  private var scanContinuation: CheckedContinuation<[[String: Any]], Error>?
  private var scanResults: [[String: Any]] = []
  private var scanTask: Task<Void, Never>?
  private var stateWaiters: [CheckedContinuation<CBManagerState, Never>] = []
  private var peripherals: [UUID: CBPeripheral] = [:]
  private var connectContinuation: CheckedContinuation<[String: Any], Error>?
  private var serviceContinuation: CheckedContinuation<[[String: Any]], Error>?
  private var pendingCharacteristicServices: [CBService] = []
  private var readContinuations: [CBUUID: CheckedContinuation<[String: Any], Error>] = [:]
  private var writeContinuations: [CBUUID: CheckedContinuation<[String: Any], Error>] = [:]
  private var notifyContinuation: CheckedContinuation<[String: Any], Error>?
  private var notifySamples: [[String: Any]] = []
  private var notifyCharacteristic: CBCharacteristic?
  private var notifyTask: Task<Void, Never>?
  private var sessionOwner = ""

  private override init() {
    super.init()
    manager = CBCentralManager(delegate: self, queue: .main)
  }

  func state() -> String { bluetoothState(manager.state) }

  func scan(seconds: Double) async throws -> [[String: Any]] {
    if scanContinuation != nil || scanTask != nil {
      finishScan(error: CancellationError())
    }
    let currentState = manager.state
    let resolvedState: CBManagerState
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
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        scanContinuation = continuation
        // Install the continuation before starting CoreBluetooth so a caller
        // that cancels at the boundary cannot leave an unresumable scan.
        guard !Task.isCancelled else {
          finishScan(error: CancellationError())
          return
        }
        scanResults = []
        manager.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        scanTask = Task { [weak self] in
          let nanoseconds = UInt64(max(1, min(seconds, 15)) * 1_000_000_000)
          try? await Task.sleep(nanoseconds: nanoseconds)
          guard !Task.isCancelled else { return }
          self?.finishScan()
        }
      }
    } onCancel: { [weak self] in
      self?.finishScan(error: CancellationError())
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard !stateWaiters.isEmpty else { return }
    let waiters = stateWaiters
    stateWaiters.removeAll()
    waiters.forEach { $0.resume(returning: central.state) }
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    peripherals[peripheral.identifier] = peripheral
    guard scanResults.first(where: { $0["id"] as? String == peripheral.identifier.uuidString }) == nil else { return }
    scanResults.append(["id": peripheral.identifier.uuidString, "name": peripheral.name ?? "", "rssi": RSSI.intValue])
  }

  func connect(owner: String, identifier: String) async throws -> [String: Any] {
    try await ensurePoweredOn()
    let normalizedOwner = owner.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !normalizedOwner.isEmpty else { throw HermesNativeActionError.invalidInput("ownerScope") }
    guard let uuid = UUID(uuidString: identifier.trimmingCharacters(in: .whitespacesAndNewlines)) else {
      throw HermesNativeActionError.invalidInput("deviceID")
    }
    if sessionOwner != normalizedOwner { disconnect() }
    guard connectContinuation == nil else { throw HermesNativeActionError.unavailable("bluetooth-connect-busy") }
    sessionOwner = normalizedOwner
    let peripheral = peripherals[uuid] ?? manager.retrievePeripherals(withIdentifiers: [uuid]).first
    guard let peripheral else { throw HermesNativeActionError.unavailable("bluetooth-device") }
    peripherals[uuid] = peripheral
    peripheral.delegate = self
    if peripheral.state == .connected { return ["connected": true, "id": uuid.uuidString] }
    return try await withCheckedThrowingContinuation { continuation in
      connectContinuation = continuation
      manager.connect(peripheral, options: nil)
      DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self, weak peripheral] in
        guard let self, let peripheral, self.connectContinuation != nil else { return }
        self.manager.cancelPeripheralConnection(peripheral)
        let pending = self.connectContinuation
        self.connectContinuation = nil
        pending?.resume(throwing: HermesNativeActionError.unavailable("bluetooth-connect-timeout"))
      }
    }
  }

  func disconnect() {
    peripherals.values
      .filter { $0.state == .connected || $0.state == .connecting }
      .forEach { manager.cancelPeripheralConnection($0) }
    connectContinuation?.resume(throwing: CancellationError())
    connectContinuation = nil
    serviceContinuation?.resume(throwing: CancellationError())
    serviceContinuation = nil
    pendingCharacteristicServices.removeAll()
    readContinuations.values.forEach { $0.resume(throwing: CancellationError()) }
    readContinuations.removeAll()
    writeContinuations.values.forEach { $0.resume(throwing: CancellationError()) }
    writeContinuations.removeAll()
    notifyTask?.cancel()
    notifyTask = nil
    notifyContinuation?.resume(throwing: CancellationError())
    notifyContinuation = nil
    notifyCharacteristic = nil
    sessionOwner = ""
  }

  func services(owner: String, identifier: String) async throws -> [[String: Any]] {
    guard owner.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == sessionOwner,
          let peripheral = peripheral(identifier) else {
      throw HermesNativeActionError.unavailable("bluetooth-session")
    }
    guard serviceContinuation == nil else { throw HermesNativeActionError.unavailable("bluetooth-services-busy") }
    if let services = peripheral.services, services.allSatisfy({ $0.characteristics != nil }) {
      return serializeServices(services)
    }
    return try await withCheckedThrowingContinuation { continuation in
      serviceContinuation = continuation
      peripheral.delegate = self
      peripheral.discoverServices(nil)
      DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
        guard let self, let pending = self.serviceContinuation else { return }
        self.serviceContinuation = nil
        self.pendingCharacteristicServices.removeAll()
        pending.resume(throwing: HermesNativeActionError.unavailable("bluetooth-services-timeout"))
      }
    }
  }

  func read(owner: String, identifier: String, serviceUUID: String, characteristicUUID: String) async throws -> [String: Any] {
    guard owner.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == sessionOwner,
          let characteristic = characteristic(identifier, serviceUUID: serviceUUID, characteristicUUID: characteristicUUID) else {
      throw HermesNativeActionError.unavailable("bluetooth-characteristic")
    }
    guard characteristic.properties.contains(.read) else { throw HermesNativeActionError.invalidInput("characteristic") }
    let uuid = characteristic.uuid
    guard readContinuations[uuid] == nil else { throw HermesNativeActionError.unavailable("bluetooth-read-busy") }
    return try await withCheckedThrowingContinuation { continuation in
      readContinuations[uuid] = continuation
      guard let peripheral = characteristic.service?.peripheral else {
        readContinuations.removeValue(forKey: uuid)
        continuation.resume(throwing: HermesNativeActionError.unavailable("bluetooth-peripheral"))
        return
      }
      peripheral.readValue(for: characteristic)
      DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
        guard let self, let pending = self.readContinuations.removeValue(forKey: uuid) else { return }
        pending.resume(throwing: HermesNativeActionError.unavailable("bluetooth-read-timeout"))
      }
    }
  }

  func write(owner: String, identifier: String, serviceUUID: String, characteristicUUID: String, data: Data, withResponse: Bool) async throws -> [String: Any] {
    guard owner.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == sessionOwner,
          let characteristic = characteristic(identifier, serviceUUID: serviceUUID, characteristicUUID: characteristicUUID) else {
      throw HermesNativeActionError.unavailable("bluetooth-characteristic")
    }
    guard characteristic.properties.contains(withResponse ? .write : .writeWithoutResponse) else {
      throw HermesNativeActionError.invalidInput("characteristic")
    }
    if !withResponse {
      guard let peripheral = characteristic.service?.peripheral else {
        throw HermesNativeActionError.unavailable("bluetooth-peripheral")
      }
      peripheral.writeValue(data, for: characteristic, type: .withoutResponse)
      return ["written": true, "bytes": data.count]
    }
    let uuid = characteristic.uuid
    guard writeContinuations[uuid] == nil else { throw HermesNativeActionError.unavailable("bluetooth-write-busy") }
    return try await withCheckedThrowingContinuation { continuation in
      writeContinuations[uuid] = continuation
      guard let peripheral = characteristic.service?.peripheral else {
        writeContinuations.removeValue(forKey: uuid)
        continuation.resume(throwing: HermesNativeActionError.unavailable("bluetooth-peripheral"))
        return
      }
      peripheral.writeValue(data, for: characteristic, type: .withResponse)
      DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
        guard let self, let pending = self.writeContinuations.removeValue(forKey: uuid) else { return }
        pending.resume(throwing: HermesNativeActionError.unavailable("bluetooth-write-timeout"))
      }
    }
  }

  func notify(owner: String, identifier: String, serviceUUID: String, characteristicUUID: String, seconds: Double) async throws -> [String: Any] {
    guard owner.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == sessionOwner,
          let characteristic = characteristic(identifier, serviceUUID: serviceUUID, characteristicUUID: characteristicUUID) else {
      throw HermesNativeActionError.unavailable("bluetooth-characteristic")
    }
    guard characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) else {
      throw HermesNativeActionError.invalidInput("characteristic")
    }
    guard notifyContinuation == nil else { throw HermesNativeActionError.unavailable("bluetooth-notify-busy") }
    notifySamples = []
    notifyCharacteristic = characteristic
    guard let peripheral = characteristic.service?.peripheral else {
      throw HermesNativeActionError.unavailable("bluetooth-peripheral")
    }
    peripheral.setNotifyValue(true, for: characteristic)
    return try await withCheckedThrowingContinuation { continuation in
      notifyContinuation = continuation
      notifyTask = Task { [weak self] in
        let nanoseconds = UInt64(max(1, min(seconds, 60)) * 1_000_000_000)
        try? await Task.sleep(nanoseconds: nanoseconds)
        guard !Task.isCancelled else { return }
        await MainActor.run { self?.finishNotify() }
      }
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    connectContinuation?.resume(returning: ["connected": true, "id": peripheral.identifier.uuidString])
    connectContinuation = nil
    peripheral.delegate = self
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    let continuation = connectContinuation
    connectContinuation = nil
    continuation?.resume(throwing: error ?? HermesNativeActionError.unavailable("bluetooth-connect"))
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let continuation = connectContinuation
    connectContinuation = nil
    continuation?.resume(throwing: error ?? HermesNativeActionError.unavailable("bluetooth-disconnected"))
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard serviceContinuation != nil else { return }
    if let error { finishServices(error: error); return }
    pendingCharacteristicServices = peripheral.services ?? []
    discoverNextCharacteristics(for: peripheral)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard serviceContinuation != nil else { return }
    if let error { finishServices(error: error); return }
    discoverNextCharacteristics(for: peripheral)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    if let continuation = readContinuations.removeValue(forKey: characteristic.uuid) {
      if let error { continuation.resume(throwing: error) }
      else { continuation.resume(returning: ["uuid": characteristic.uuid.uuidString, "data": characteristic.value?.base64EncodedString() ?? ""]) }
    }
    if notifyCharacteristic?.uuid == characteristic.uuid, let value = characteristic.value {
      notifySamples.append(["uuid": characteristic.uuid.uuidString, "data": value.base64EncodedString()])
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let continuation = writeContinuations.removeValue(forKey: characteristic.uuid) else { return }
    if let error { continuation.resume(throwing: error) }
    else { continuation.resume(returning: ["written": true, "uuid": characteristic.uuid.uuidString]) }
  }

  private func finishNotify() {
    notifyTask = nil
    if let characteristic = notifyCharacteristic {
      characteristic.service?.peripheral?.setNotifyValue(false, for: characteristic)
    }
    let continuation = notifyContinuation
    notifyContinuation = nil
    notifyCharacteristic = nil
    continuation?.resume(returning: ["samples": notifySamples])
  }

  private func ensurePoweredOn() async throws {
    let current = manager.state
    if current == .poweredOn { return }
    let resolved = current == .unknown || current == .resetting
      ? await withCheckedContinuation { (continuation: CheckedContinuation<CBManagerState, Never>) in
        stateWaiters.append(continuation)
        let state = manager.state
        if state != .unknown && state != .resetting {
          let waiters = stateWaiters
          stateWaiters.removeAll()
          waiters.forEach { $0.resume(returning: state) }
        }
      }
      : current
    guard resolved == .poweredOn else { throw HermesNativeActionError.unavailable("bluetooth") }
  }

  private func peripheral(_ identifier: String) -> CBPeripheral? {
    guard let uuid = UUID(uuidString: identifier.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
    return peripherals[uuid] ?? manager.retrievePeripherals(withIdentifiers: [uuid]).first
  }

  private func characteristic(_ identifier: String, serviceUUID: String, characteristicUUID: String) -> CBCharacteristic? {
    guard let peripheral = peripheral(identifier) else { return nil }
    let serviceUUID = CBUUID(string: serviceUUID)
    let characteristicUUID = CBUUID(string: characteristicUUID)
    return peripheral.services?.first(where: { $0.uuid == serviceUUID })?.characteristics?.first(where: { $0.uuid == characteristicUUID })
  }

  private func serializeServices(_ services: [CBService]) -> [[String: Any]] {
    services.map { service in
      ["uuid": service.uuid.uuidString, "primary": service.isPrimary, "characteristics": service.characteristics?.map { ["uuid": $0.uuid.uuidString, "properties": $0.properties.rawValue] } ?? []]
    }
  }

  private func discoverNextCharacteristics(for peripheral: CBPeripheral) {
    guard serviceContinuation != nil else {
      pendingCharacteristicServices.removeAll()
      return
    }
    guard !pendingCharacteristicServices.isEmpty else {
      finishServices(result: serializeServices(peripheral.services ?? []))
      return
    }
    let service = pendingCharacteristicServices.removeFirst()
    if service.characteristics != nil {
      discoverNextCharacteristics(for: peripheral)
    } else {
      peripheral.discoverCharacteristics(nil, for: service)
    }
  }

  private func finishServices(result: [[String: Any]]? = nil, error: Error? = nil) {
    pendingCharacteristicServices.removeAll()
    let continuation = serviceContinuation
    serviceContinuation = nil
    if let error { continuation?.resume(throwing: error) }
    else { continuation?.resume(returning: result ?? []) }
  }

  private func finishScan(error: Error? = nil) {
    manager.stopScan()
    scanTask?.cancel()
    scanTask = nil
    let continuation = scanContinuation
    scanContinuation = nil
    if let error {
      continuation?.resume(throwing: error)
    } else {
      continuation?.resume(returning: scanResults)
    }
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
                    "writable": characteristic.properties.contains(HMCharacteristicPropertyWritable),
                  ]
                },
              ]
            },
          ]
        },
      ]
    }
  }

  func search(query: String?, limit: Int) -> [[String: Any]] {
    let normalized = query?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    let cappedLimit = min(max(limit, 1), 100)
    var result: [[String: Any]] = []
    for home in manager.homes {
      for accessory in home.accessories {
        let haystack = [accessory.name, accessory.room?.name ?? "", accessory.services.map(\.name).joined(separator: " ")].joined(separator: " ").lowercased()
        guard normalized.isEmpty || haystack.contains(normalized) else { continue }
        result.append(["homeID": home.uniqueIdentifier.uuidString, "id": accessory.uniqueIdentifier.uuidString, "name": accessory.name, "room": accessory.room?.name ?? "", "reachable": accessory.isReachable])
        if result.count >= cappedLimit { return result }
      }
    }
    return result
  }

  func scenes(limit: Int) -> [[String: Any]] {
    let cappedLimit = min(max(limit, 1), 100)
    return manager.homes.flatMap { home in
      home.actionSets.prefix(cappedLimit).map { actionSet in
        ["homeID": home.uniqueIdentifier.uuidString, "id": actionSet.uniqueIdentifier.uuidString, "name": actionSet.name, "type": String(describing: actionSet.actionSetType)]
      }
    }.prefix(cappedLimit).map { $0 }
  }

  func triggerScene(id: String) async throws -> [String: Any] {
    let normalized = id.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let home = manager.homes.first(where: { $0.actionSets.contains(where: { $0.uniqueIdentifier.uuidString == normalized }) }),
          let actionSet = home.actionSets.first(where: { $0.uniqueIdentifier.uuidString == normalized }) else {
      throw HermesNativeActionError.invalidInput("sceneID")
    }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      home.executeActionSet(actionSet) { error in
        if let error { continuation.resume(throwing: error) }
        else { continuation.resume(returning: ()) }
      }
    }
    return ["triggered": true, "sceneID": normalized]
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
    guard characteristic.properties.contains(HMCharacteristicPropertyWritable) else {
      throw HermesNativeActionError.invalidInput("read-only HomeKit characteristic")
    }
    let format = characteristic.metadata?.format?.lowercased() ?? ""
    let writeValue: Any
    if format == HMCharacteristicMetadataFormatBool.lowercased() {
      if let value = value as? Bool { writeValue = value }
      else if let value = value as? String, let parsed = Bool(value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) { writeValue = parsed }
      else { throw HermesNativeActionError.invalidInput("value") }
    } else if format.contains("float") || format.contains("uint") || format.contains("int") || format.contains("double") {
      if let value = value as? NSNumber { writeValue = value }
      else if let value = value as? String, let parsed = Double(value.trimmingCharacters(in: .whitespacesAndNewlines)), parsed.isFinite { writeValue = NSNumber(value: parsed) }
      else { throw HermesNativeActionError.invalidInput("value") }
    } else if let value = value as? String {
      writeValue = value
    } else if let value = value as? NSNumber {
      writeValue = value
    } else {
      throw HermesNativeActionError.invalidInput("value")
    }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
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
