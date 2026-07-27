import AVFoundation
import Foundation
import Speech

final class HermesVoiceService: NSObject, AVSpeechSynthesizerDelegate {
  static let shared = HermesVoiceService()

  var onTranscript: (([String: Any]) -> Void)?
  var onState: (([String: Any]) -> Void)?

  private let audioEngine = AVAudioEngine()
  private let synthesizer = AVSpeechSynthesizer()
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var recognitionTimeout: DispatchWorkItem?
  private var latestTranscript = ""
  private var recording = false
  private var inputTapInstalled = false
  private var interruptionObserver: NSObjectProtocol?
  private var recognitionGeneration = 0
  private var activeUtterance: AVSpeechUtterance?

  private override init() {
    super.init()
    synthesizer.delegate = self
  }

  deinit {
    if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
  }

  func authorizationSnapshot() -> [String: String] {
    [
      "microphone": Self.microphoneAuthorization(),
      "speech": Self.speechAuthorization(),
    ]
  }

  func requestAuthorization() async -> [String: String] {
    var microphone = Self.microphoneAuthorization()
    if microphone == "notDetermined" {
      microphone = await withCheckedContinuation { continuation in
        AVAudioApplication.requestRecordPermission { granted in
          continuation.resume(returning: granted ? "authorized" : "denied")
        }
      }
    }

    guard microphone == "authorized" else {
      return ["microphone": microphone, "speech": Self.speechAuthorization()]
    }

    var speech = Self.speechAuthorization()
    if speech == "notDetermined" {
      speech = await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { status in
          continuation.resume(returning: Self.speechAuthorization(status))
        }
      }
    }
    return ["microphone": microphone, "speech": speech]
  }

  @MainActor
  func startRecognition(localeIdentifier: String?) throws -> Bool {
    guard !recording else { return true }
    guard Self.microphoneAuthorization() == "authorized" else {
      throw NSError(
        domain: "HermesVoice",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Microphone permission is required"]
      )
    }
    guard Self.speechAuthorization() == "authorized" else {
      throw NSError(
        domain: "HermesVoice",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Speech recognition permission is required"]
      )
    }

    stopRecognition(emitState: false)
    recognitionGeneration += 1
    let generation = recognitionGeneration
    let identifier = localeIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines)
    let locale = Locale(identifier: identifier.flatMap { $0.isEmpty ? nil : $0 } ?? Locale.current.identifier)
    guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
      throw NSError(
        domain: "HermesVoice",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Speech recognition is unavailable for this language"]
      )
    }

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(
      .playAndRecord,
      mode: .spokenAudio,
      options: [.allowBluetoothHFP, .defaultToSpeaker, .duckOthers]
    )
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.addsPunctuation = true
    request.taskHint = .dictation
    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
    }

    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw NSError(
        domain: "HermesVoice",
        code: 4,
        userInfo: [NSLocalizedDescriptionKey: "No microphone input route is available"]
      )
    }
    input.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
      request.append(buffer)
    }
    inputTapInstalled = true

    recognitionRequest = request
    latestTranscript = ""
    recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      DispatchQueue.main.async {
        guard let self,
              self.recording,
              self.recognitionGeneration == generation else { return }
        if let result {
          self.latestTranscript = result.bestTranscription.formattedString
          self.onTranscript?([
            "isFinal": result.isFinal,
            "text": self.latestTranscript,
            "timestamp": Date().timeIntervalSince1970 * 1_000,
          ])
          if result.isFinal {
            self.stopRecognition(emitState: true)
            return
          }
        }
        if let error {
          self.stopRecognition(emitState: false)
          self.emitState("failed", error: error.localizedDescription)
        }
      }
    }

    audioEngine.prepare()
    do {
      try audioEngine.start()
    } catch {
      if inputTapInstalled {
        input.removeTap(onBus: 0)
        inputTapInstalled = false
      }
      recognitionTask?.cancel()
      recognitionTask = nil
      recognitionRequest = nil
      try? session.setActive(false, options: .notifyOthersOnDeactivation)
      throw error
    }

    recording = true
    observeAudioInterruptions()
    scheduleRecognitionTimeout()
    emitState("listening")
    return true
  }

  @MainActor
  @discardableResult
  func stopRecognition(emitState: Bool = true) -> String {
    recognitionGeneration += 1
    recognitionTimeout?.cancel()
    recognitionTimeout = nil
    if audioEngine.isRunning { audioEngine.stop() }
    if inputTapInstalled {
      audioEngine.inputNode.removeTap(onBus: 0)
      inputTapInstalled = false
    }
    recognitionRequest?.endAudio()
    recognitionTask?.cancel()
    recognitionTask = nil
    recognitionRequest = nil
    recording = false
    if let interruptionObserver {
      NotificationCenter.default.removeObserver(interruptionObserver)
      self.interruptionObserver = nil
    }
    try? AVAudioSession.sharedInstance().setActive(
      false,
      options: .notifyOthersOnDeactivation
    )
    if emitState { self.emitState("idle") }
    return latestTranscript
  }

  @MainActor
  func speak(text: String, localeIdentifier: String?, rate: Double?) throws -> Bool {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return false }
    if recording { _ = stopRecognition() }
    if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
    try session.setActive(true)
    let utterance = AVSpeechUtterance(string: value)
    if let localeIdentifier, !localeIdentifier.isEmpty {
      utterance.voice = AVSpeechSynthesisVoice(language: localeIdentifier)
    }
    if let rate { utterance.rate = Float(min(max(rate, 0.35), 0.62)) }
    activeUtterance = utterance
    synthesizer.speak(utterance)
    return true
  }

  @MainActor
  func stopSpeaking() -> Bool {
    let wasSpeaking = synthesizer.isSpeaking || synthesizer.isPaused
    if wasSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    return wasSpeaking
  }

  var isRecording: Bool { recording }
  var isSpeaking: Bool { synthesizer.isSpeaking }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didStart utterance: AVSpeechUtterance
  ) {
    guard activeUtterance === utterance else { return }
    emitState("speaking")
  }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didFinish utterance: AVSpeechUtterance
  ) {
    finishSpeaking(utterance)
  }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didCancel utterance: AVSpeechUtterance
  ) {
    finishSpeaking(utterance)
  }

  private static func microphoneAuthorization() -> String {
    switch AVAudioApplication.shared.recordPermission {
    case .granted: return "authorized"
    case .denied: return "denied"
    case .undetermined: return "notDetermined"
    @unknown default: return "unavailable"
    }
  }

  private static func speechAuthorization(
    _ status: SFSpeechRecognizerAuthorizationStatus = SFSpeechRecognizer.authorizationStatus()
  ) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    case .restricted: return "restricted"
    @unknown default: return "unavailable"
    }
  }

  @MainActor
  private func scheduleRecognitionTimeout() {
    recognitionTimeout?.cancel()
    let generation = recognitionGeneration
    let timeout = DispatchWorkItem { [weak self] in
      guard let self,
            self.recording,
            self.recognitionGeneration == generation else { return }
      _ = self.stopRecognition()
    }
    recognitionTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 55, execute: timeout)
  }

  @MainActor
  private func observeAudioInterruptions() {
    if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
    let generation = recognitionGeneration
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let self,
            self.recognitionGeneration == generation,
            let rawValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawValue),
            type == .began else { return }
      _ = self.stopRecognition(emitState: false)
      self.emitState("interrupted")
    }
  }

  private func finishSpeaking(_ utterance: AVSpeechUtterance) {
    guard activeUtterance === utterance else { return }
    activeUtterance = nil
    try? AVAudioSession.sharedInstance().setActive(
      false,
      options: .notifyOthersOnDeactivation
    )
    emitState("idle")
  }

  private func emitState(_ state: String, error: String? = nil) {
    var payload: [String: Any] = [
      "state": state,
      "timestamp": Date().timeIntervalSince1970 * 1_000,
    ]
    if let error { payload["error"] = error }
    onState?(payload)
  }
}
