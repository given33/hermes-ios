import Foundation

final class HermesProtectedExportFile {
  static let shared = HermesProtectedExportFile()

  private let fileManager = FileManager.default

  private init() {}

  func write(contents: String, filename: String) throws -> String {
    let directory = try exportDirectory()
    let safeName = sanitizedFilename(filename)
    let target = directory.appendingPathComponent(safeName, isDirectory: false)
    let temporary = directory.appendingPathComponent(".\(UUID().uuidString).tmp")
    let attributes: [FileAttributeKey: Any] = [
      .protectionKey: FileProtectionType.complete,
    ]
    guard fileManager.createFile(
      atPath: temporary.path,
      contents: nil,
      attributes: attributes
    ) else {
      throw CocoaError(.fileWriteUnknown)
    }

    let input = InputStream(data: Data(contents.utf8))
    guard let output = OutputStream(url: temporary, append: false) else {
      try? fileManager.removeItem(at: temporary)
      throw CocoaError(.fileWriteUnknown)
    }
    input.open()
    output.open()
    defer {
      input.close()
      output.close()
    }

    var buffer = [UInt8](repeating: 0, count: 64 * 1024)
    do {
      while input.hasBytesAvailable {
        let read = input.read(&buffer, maxLength: buffer.count)
        if read < 0 {
          throw input.streamError ?? CocoaError(.fileReadUnknown)
        }
        if read == 0 { break }
        var offset = 0
        while offset < read {
          let written = output.write(
            buffer.withUnsafeBufferPointer { pointer in
              pointer.baseAddress!.advanced(by: offset)
            },
            maxLength: read - offset
          )
          if written <= 0 {
            throw output.streamError ?? CocoaError(.fileWriteUnknown)
          }
          offset += written
        }
      }
      if fileManager.fileExists(atPath: target.path) {
        try fileManager.removeItem(at: target)
      }
      try fileManager.moveItem(at: temporary, to: target)
      try fileManager.setAttributes(attributes, ofItemAtPath: target.path)
      return target.absoluteString
    } catch {
      try? fileManager.removeItem(at: temporary)
      throw error
    }
  }

  func delete(uri: String) throws -> Bool {
    guard let target = URL(string: uri), target.isFileURL else { return false }
    let directory = try exportDirectory().standardizedFileURL
    let candidate = target.standardizedFileURL
    guard candidate.deletingLastPathComponent() == directory else { return false }
    guard fileManager.fileExists(atPath: candidate.path) else { return false }
    try fileManager.removeItem(at: candidate)
    return true
  }

  private func exportDirectory() throws -> URL {
    let cache = try fileManager.url(
      for: .cachesDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let directory = cache.appendingPathComponent("HermesProtectedExports", isDirectory: true)
    try fileManager.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    try fileManager.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: directory.path
    )
    return directory
  }

  private func sanitizedFilename(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
    let scalars = value.unicodeScalars.map {
      allowed.contains($0) ? Character(String($0)) : Character("-")
    }
    let result = String(scalars).trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
    return result.isEmpty ? "Hermes-account.hermes-export" : String(result.prefix(180))
  }
}
