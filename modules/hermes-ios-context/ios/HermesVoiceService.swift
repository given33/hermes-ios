import AVFoundation
import Foundation
import Speech

final class HermesVoiceService: NSObject, AVSpeechSynthesizerDelegate {
  static let shared = HermesVoiceService()

  var onTranscript: (([String: Any]) -> Void)?
  var onState: (([String: Any]) -> Void)?

  private let audioEngine = AVAudioEngine()
  private let synthesizer = AVSpeechSynthesizer()
  private let pcmAudioEngine = AVAudioEngine()
  private let pcmPlayer = AVAudioPlayerNode()
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var recognitionTimeout: DispatchWorkItem?
  private var latestTranscript = ""
  private var enqueueAgentTriggerOnFinalTranscript = false
  private var recording = false
  private var inputTapInstalled = false
  private var interruptionObserver: NSObjectProtocol?
  private var recognitionGeneration = 0
  private var activeUtterance: AVSpeechUtterance?
  private var streamingSpeechActive = false
  private var streamingSpeechBuffer = ""
  private var streamingSpeechFinishRequested = false
  private var streamingSpeechGeneration = 0
  private var streamingSpeechLocaleIdentifier: String?
  private var streamingSpeechRate: Float?
  private var streamingSpeechIdleFlush: DispatchWorkItem?
  private var streamingUtterances: [ObjectIdentifier: Int] = [:]
  private var pcmFormat: AVAudioFormat?
  private var pcmPlaybackActive = false
  private var pcmPlaybackFinishRequested = false
  private var pcmPlaybackGeneration = 0
  private var pcmQueuedBuffers = 0
  private var pcmRemainder = Data()
  private var pcmPlayerAttached = false
  private var pcmInterruptionObserver: NSObjectProtocol?

  private override init() {
    super.init()
    synthesizer.delegate = self
  }

  deinit {
    if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
    if let pcmInterruptionObserver { NotificationCenter.default.removeObserver(pcmInterruptionObserver) }
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
    if synthesizer.isSpeaking || synthesizer.isPaused || streamingSpeechActive || pcmPlaybackActive {
      _ = stopSpeaking(interrupted: true)
    }
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
    do {
      try session.setCategory(
        .playAndRecord,
        mode: .spokenAudio,
        options: [.allowBluetoothHFP, .defaultToSpeaker, .duckOthers]
      )
      try session.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
      try? session.setActive(false, options: .notifyOthersOnDeactivation)
      throw error
    }

    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      deactivateAudioSession()
      throw NSError(
        domain: "HermesVoice",
        code: 4,
        userInfo: [NSLocalizedDescriptionKey: "No microphone input route is available"]
      )
    }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.addsPunctuation = true
    request.taskHint = .dictation
    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
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
            if self.enqueueAgentTriggerOnFinalTranscript,
               !self.latestTranscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
              _ = HermesAgentTriggerStore.shared.enqueue(
                kind: "voice-capture",
                content: self.latestTranscript
              )
            }
            self.enqueueAgentTriggerOnFinalTranscript = false
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
  func startAgentCapture(localeIdentifier: String?) throws -> Bool {
    guard HermesPermissionCollectionGate.shared.isReadyForCurrentOwner else {
      throw NSError(
        domain: "HermesVoice",
        code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Hermes permissions are not ready for the active account"]
      )
    }
    do {
      let started = try startRecognition(localeIdentifier: localeIdentifier)
      enqueueAgentTriggerOnFinalTranscript = true
      return started
    } catch {
      enqueueAgentTriggerOnFinalTranscript = false
      throw error
    }
  }

  @MainActor
  @discardableResult
  func stopRecognition(emitState: Bool = true) -> String {
    recognitionGeneration += 1
    enqueueAgentTriggerOnFinalTranscript = false
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
    if synthesizer.isSpeaking || synthesizer.isPaused || streamingSpeechActive || pcmPlaybackActive {
      _ = stopSpeaking()
    }
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
      try session.setActive(true)
    } catch {
      deactivateAudioSession()
      throw error
    }
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
  func startStreamingSpeech(localeIdentifier: String?, rate: Double?) throws -> Bool {
    if recording { _ = stopRecognition() }
    if synthesizer.isSpeaking || synthesizer.isPaused || streamingSpeechActive || pcmPlaybackActive {
      _ = stopSpeaking()
    }
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
      try session.setActive(true)
    } catch {
      deactivateAudioSession()
      throw error
    }
    streamingSpeechGeneration += 1
    streamingSpeechActive = true
    streamingSpeechBuffer = ""
    streamingSpeechFinishRequested = false
    streamingSpeechLocaleIdentifier = localeIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines)
    streamingSpeechRate = rate.map { Float(min(max($0, 0.35), 0.62)) }
    streamingSpeechIdleFlush?.cancel()
    streamingSpeechIdleFlush = nil
    streamingUtterances.removeAll()
    return true
  }

  @MainActor
  func appendStreamingSpeech(_ delta: String) -> Bool {
    guard streamingSpeechActive, !streamingSpeechFinishRequested, !delta.isEmpty else {
      return false
    }
    streamingSpeechBuffer.append(delta)
    enqueueStreamingClauses(force: false)
    scheduleStreamingSpeechIdleFlush()
    return true
  }

  @MainActor
  func finishStreamingSpeech() -> Bool {
    guard streamingSpeechActive else { return false }
    streamingSpeechFinishRequested = true
    streamingSpeechIdleFlush?.cancel()
    streamingSpeechIdleFlush = nil
    enqueueStreamingClauses(force: true)
    finishStreamingSpeechIfDrained()
    return true
  }

  @MainActor
  func startPCMPlayback(sampleRate: Double, channels: Int) throws -> Bool {
    guard sampleRate >= 8_000, sampleRate <= 96_000, channels >= 1, channels <= 2,
          let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRate,
            channels: AVAudioChannelCount(channels),
            interleaved: true
          ) else {
      throw NSError(
        domain: "HermesVoice",
        code: 6,
        userInfo: [NSLocalizedDescriptionKey: "Unsupported PCM playback format"]
      )
    }
    if recording { _ = stopRecognition() }
    _ = stopSpeaking()

    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
      try session.setActive(true)
      if !pcmPlayerAttached {
        pcmAudioEngine.attach(pcmPlayer)
        pcmPlayerAttached = true
      }
      pcmAudioEngine.connect(pcmPlayer, to: pcmAudioEngine.mainMixerNode, format: format)
      pcmAudioEngine.prepare()
      try pcmAudioEngine.start()
      pcmPlayer.play()
    } catch {
      resetPCMPlayback()
      deactivateAudioSession()
      throw error
    }

    pcmPlaybackGeneration += 1
    pcmFormat = format
    pcmPlaybackActive = true
    pcmPlaybackFinishRequested = false
    pcmQueuedBuffers = 0
    pcmRemainder.removeAll(keepingCapacity: true)
    observePCMInterruptions()
    emitState("speaking")
    return true
  }

  @MainActor
  func appendPCMPlayback(_ base64PCM: String) throws -> Bool {
    guard pcmPlaybackActive, !pcmPlaybackFinishRequested, let format = pcmFormat else {
      return false
    }
    guard base64PCM.count <= 1_500_000,
          let incoming = Data(base64Encoded: base64PCM),
          !incoming.isEmpty else {
      throw NSError(
        domain: "HermesVoice",
        code: 7,
        userInfo: [NSLocalizedDescriptionKey: "Invalid PCM playback chunk"]
      )
    }

    var payload = pcmRemainder
    payload.append(incoming)
    let bytesPerFrame = Int(format.streamDescription.pointee.mBytesPerFrame)
    guard bytesPerFrame > 0 else { return false }
    let remainderCount = payload.count % bytesPerFrame
    if remainderCount > 0 {
      pcmRemainder = Data(payload.suffix(remainderCount))
      payload.removeLast(remainderCount)
    } else {
      pcmRemainder.removeAll(keepingCapacity: true)
    }
    guard !payload.isEmpty else { return true }

    let frameCount = payload.count / bytesPerFrame
    guard frameCount <= Int(AVAudioFrameCount.max),
          let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(frameCount)
          ),
          let destination = buffer.mutableAudioBufferList.pointee.mBuffers.mData else {
      throw NSError(
        domain: "HermesVoice",
        code: 8,
        userInfo: [NSLocalizedDescriptionKey: "Could not allocate PCM playback buffer"]
      )
    }
    buffer.frameLength = AVAudioFrameCount(frameCount)
    payload.copyBytes(
      to: destination.assumingMemoryBound(to: UInt8.self),
      count: payload.count
    )

    let generation = pcmPlaybackGeneration
    pcmQueuedBuffers += 1
    pcmPlayer.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
      DispatchQueue.main.async {
        self?.completePCMBuffer(generation: generation)
      }
    }
    return true
  }

  @MainActor
  func finishPCMPlayback() -> Bool {
    guard pcmPlaybackActive else { return false }
    pcmPlaybackFinishRequested = true
    pcmRemainder.removeAll(keepingCapacity: true)
    finishPCMPlaybackIfDrained()
    return true
  }

  @MainActor
  func stopPCMPlayback(interrupted: Bool = false) -> Bool {
    guard pcmPlaybackActive else { return false }
    resetPCMPlayback()
    deactivateAudioSession()
    emitState(interrupted ? "interrupted" : "idle")
    return true
  }

  @MainActor
  func stopSpeaking(interrupted: Bool = false) -> Bool {
    let wasSpeaking = synthesizer.isSpeaking || synthesizer.isPaused
      || streamingSpeechActive || pcmPlaybackActive
    streamingSpeechGeneration += 1
    streamingSpeechActive = false
    streamingSpeechBuffer = ""
    streamingSpeechFinishRequested = false
    streamingSpeechLocaleIdentifier = nil
    streamingSpeechRate = nil
    streamingSpeechIdleFlush?.cancel()
    streamingSpeechIdleFlush = nil
    streamingUtterances.removeAll()
    if wasSpeaking {
      activeUtterance = nil
      synthesizer.stopSpeaking(at: .immediate)
      resetPCMPlayback()
      deactivateAudioSession()
      emitState(interrupted ? "interrupted" : "idle")
    }
    return wasSpeaking
  }

  var isRecording: Bool { recording }
  var isSpeaking: Bool { synthesizer.isSpeaking || streamingSpeechActive || pcmPlaybackActive }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didStart utterance: AVSpeechUtterance
  ) {
    if activeUtterance === utterance || streamingUtterances[ObjectIdentifier(utterance)] != nil {
      emitState("speaking")
    }
  }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didFinish utterance: AVSpeechUtterance
  ) {
    finishUtterance(utterance)
  }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer,
    didCancel utterance: AVSpeechUtterance
  ) {
    finishUtterance(utterance)
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

  private func enqueueStreamingClauses(force: Bool) {
    guard streamingSpeechActive else { return }
    for clause in Self.takeSpeakableClauses(from: &streamingSpeechBuffer, force: force) {
      let utterance = AVSpeechUtterance(string: clause)
      if let locale = streamingSpeechLocaleIdentifier, !locale.isEmpty {
        utterance.voice = AVSpeechSynthesisVoice(language: locale)
      }
      if let rate = streamingSpeechRate { utterance.rate = rate }
      streamingUtterances[ObjectIdentifier(utterance)] = streamingSpeechGeneration
      synthesizer.speak(utterance)
    }
  }

  private func scheduleStreamingSpeechIdleFlush() {
    streamingSpeechIdleFlush?.cancel()
    guard streamingSpeechActive, !streamingSpeechBuffer.trimmingCharacters(
      in: .whitespacesAndNewlines
    ).isEmpty else {
      streamingSpeechIdleFlush = nil
      return
    }
    let generation = streamingSpeechGeneration
    let flush = DispatchWorkItem { [weak self] in
      guard let self,
            self.streamingSpeechActive,
            self.streamingSpeechGeneration == generation else { return }
      self.streamingSpeechIdleFlush = nil
      self.enqueueStreamingClauses(force: true)
    }
    streamingSpeechIdleFlush = flush
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45, execute: flush)
  }

  private func finishUtterance(_ utterance: AVSpeechUtterance) {
    if activeUtterance === utterance {
      activeUtterance = nil
      deactivateAudioSession()
      emitState("idle")
      return
    }
    guard let generation = streamingUtterances.removeValue(
      forKey: ObjectIdentifier(utterance)
    ), generation == streamingSpeechGeneration else { return }
    finishStreamingSpeechIfDrained()
  }

  private func finishStreamingSpeechIfDrained() {
    guard streamingSpeechActive,
          streamingSpeechFinishRequested,
          streamingSpeechBuffer.isEmpty,
          !streamingUtterances.values.contains(streamingSpeechGeneration) else { return }
    streamingSpeechActive = false
    streamingSpeechLocaleIdentifier = nil
    streamingSpeechRate = nil
    streamingSpeechIdleFlush?.cancel()
    streamingSpeechIdleFlush = nil
    deactivateAudioSession()
    emitState("idle")
  }

  @MainActor
  private func completePCMBuffer(generation: Int) {
    guard pcmPlaybackActive, generation == pcmPlaybackGeneration else { return }
    pcmQueuedBuffers = max(0, pcmQueuedBuffers - 1)
    finishPCMPlaybackIfDrained()
  }

  @MainActor
  private func finishPCMPlaybackIfDrained() {
    guard pcmPlaybackActive, pcmPlaybackFinishRequested, pcmQueuedBuffers == 0 else { return }
    resetPCMPlayback()
    deactivateAudioSession()
    emitState("idle")
  }

  @MainActor
  private func resetPCMPlayback() {
    pcmPlaybackGeneration += 1
    pcmPlaybackActive = false
    pcmPlaybackFinishRequested = false
    pcmQueuedBuffers = 0
    pcmRemainder.removeAll(keepingCapacity: false)
    pcmFormat = nil
    pcmPlayer.stop()
    if pcmAudioEngine.isRunning { pcmAudioEngine.stop() }
    if pcmPlayerAttached { pcmAudioEngine.disconnectNodeOutput(pcmPlayer) }
    if let pcmInterruptionObserver {
      NotificationCenter.default.removeObserver(pcmInterruptionObserver)
      self.pcmInterruptionObserver = nil
    }
  }

  @MainActor
  private func observePCMInterruptions() {
    if let pcmInterruptionObserver {
      NotificationCenter.default.removeObserver(pcmInterruptionObserver)
    }
    let generation = pcmPlaybackGeneration
    pcmInterruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let self,
            self.pcmPlaybackActive,
            self.pcmPlaybackGeneration == generation,
            let rawValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawValue),
            type == .began else { return }
      _ = self.stopPCMPlayback(interrupted: true)
    }
  }

  private static func takeSpeakableClauses(from buffer: inout String, force: Bool) -> [String] {
    var clauses: [String] = []
    var start = buffer.startIndex
    var index = start
    let boundaries = CharacterSet(charactersIn: ".!?;:\n\u{3002}\u{FF01}\u{FF1F}\u{FF1B}\u{FF1A}")

    while index < buffer.endIndex {
      let scalarBoundary = buffer[index].unicodeScalars.contains {
        boundaries.contains($0)
      }
      if scalarBoundary {
        let end = buffer.index(after: index)
        let clause = buffer[start..<end].trimmingCharacters(in: .whitespacesAndNewlines)
        if !clause.isEmpty { clauses.append(clause) }
        start = end
      }
      index = buffer.index(after: index)
    }

    buffer = String(buffer[start...])
    if force {
      let remainder = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
      if !remainder.isEmpty { clauses.append(remainder) }
      buffer = ""
    }
    return clauses
  }

  private func deactivateAudioSession() {
    try? AVAudioSession.sharedInstance().setActive(
      false,
      options: .notifyOthersOnDeactivation
    )
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
