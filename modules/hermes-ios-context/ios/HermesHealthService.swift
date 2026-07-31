import Foundation
import HealthKit
import OSLog

final class HermesHealthService {
  static let shared = HermesHealthService()
  private static let logger = Logger(subsystem: "app.hermes", category: "health-collector")
  private static let anchoredBatchLimit = 500
  private static let initialBackfillLimit = 5_000
  private static let initialBackfillDays: TimeInterval = 7

  private let store = HKHealthStore()
  private let stateLock = NSLock()
  private var activeCollectorToken: HermesCollectorGenerationToken?
  private var inFlightTypes = Set<String>()
  private var observerCompletions: [String: [() -> Void]] = [:]
  private var observerQueries: [String: HKObserverQuery] = [:]

  private var readTypes: Set<HKObjectType> {
    var types = Set<HKObjectType>()
    [
      HKObjectType.quantityType(forIdentifier: .heartRate),
      HKObjectType.quantityType(forIdentifier: .restingHeartRate),
      HKObjectType.quantityType(forIdentifier: .oxygenSaturation),
      HKObjectType.quantityType(forIdentifier: .stepCount),
      HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
      HKObjectType.quantityType(forIdentifier: .appleExerciseTime),
      HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning),
      HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
      HKObjectType.workoutType(),
    ].compactMap { $0 }.forEach { types.insert($0) }
    return types
  }

  private var sampleTypes: [HKSampleType] {
    readTypes.compactMap { $0 as? HKSampleType }
  }

  func activateAccountGeneration(_ token: HermesCollectorGenerationToken) {
    stateLock.lock()
    let changed = activeCollectorToken != token
    stateLock.unlock()
    if changed { stopObservers(deleteAnchors: false) }
    stateLock.lock()
    activeCollectorToken = token
    stateLock.unlock()
    DispatchQueue.main.async { [weak self] in
      _ = self?.resumeBackgroundCollection()
    }
  }

  func resetAccountState() {
    stopObservers(deleteAnchors: true)
    stateLock.lock()
    activeCollectorToken = nil
    stateLock.unlock()
  }

  @discardableResult
  func resumeBackgroundCollection() -> Bool {
    guard HKHealthStore.isHealthDataAvailable(),
          let token = HermesAccountLifecycle.captureCollectorGeneration() else { return false }
    var started = false
    let current = HermesAccountLifecycle.performIfCurrentCollectorGeneration(token) {
      stateLock.lock()
      let changed = activeCollectorToken != token
      stateLock.unlock()
      if changed { activateAccountGeneration(token) }
      else { startBackgroundCollection(token: token) }
      started = true
    }
    return current && started
  }

  private func startBackgroundCollection(token: HermesCollectorGenerationToken) {
    stateLock.lock()
    let current = activeCollectorToken == token
    let alreadyStarted = !observerQueries.isEmpty
    stateLock.unlock()
    guard current, !alreadyStarted else { return }

    for sampleType in sampleTypes {
      store.enableBackgroundDelivery(for: sampleType, frequency: .immediate) { success, error in
        if !success {
          Self.logger.error(
            "Health background delivery failed for \(sampleType.identifier, privacy: .public): \(error?.localizedDescription ?? "unknown", privacy: .public)"
          )
        }
      }
      let query = HKObserverQuery(sampleType: sampleType, predicate: nil) {
        [weak self] _, completion, error in
        guard let self else {
          completion()
          return
        }
        if let error {
          Self.logger.error(
            "Health observer failed for \(sampleType.identifier, privacy: .public): \(error.localizedDescription, privacy: .public)"
          )
          completion()
          return
        }
        self.scheduleDrain(sampleType, token: token, completion: completion)
      }
      stateLock.lock()
      guard activeCollectorToken == token else {
        stateLock.unlock()
        return
      }
      observerQueries[sampleType.identifier] = query
      stateLock.unlock()
      store.execute(query)
      scheduleDrain(sampleType, token: token, completion: {})
    }
  }

  private func stopObservers(deleteAnchors: Bool) {
    stateLock.lock()
    let token = activeCollectorToken
    let queries = Array(observerQueries.values)
    let completions = observerCompletions.values.flatMap { $0 }
    observerQueries.removeAll()
    observerCompletions.removeAll()
    inFlightTypes.removeAll()
    stateLock.unlock()
    queries.forEach(store.stop)
    completions.forEach { $0() }
    if deleteAnchors, let token { deleteAnchorState(token: token) }
  }

  private func scheduleDrain(
    _ sampleType: HKSampleType,
    token: HermesCollectorGenerationToken,
    completion: @escaping () -> Void
  ) {
    let identifier = sampleType.identifier
    stateLock.lock()
    guard activeCollectorToken == token else {
      stateLock.unlock()
      completion()
      return
    }
    observerCompletions[identifier, default: []].append(completion)
    let shouldStart = !inFlightTypes.contains(identifier)
    if shouldStart { inFlightTypes.insert(identifier) }
    stateLock.unlock()
    guard shouldStart else { return }
    executeAnchoredDrain(sampleType, token: token, processed: 0)
  }

  private func executeAnchoredDrain(
    _ sampleType: HKSampleType,
    token: HermesCollectorGenerationToken,
    processed: Int
  ) {
    guard HermesContextEventQueue.shared.isCurrentCollectorGenerationToken(token) else {
      finishDrain(identifier: sampleType.identifier, token: token)
      return
    }
    let anchor = loadAnchor(token: token, typeIdentifier: sampleType.identifier)
    let predicate = anchor == nil
      ? HKQuery.predicateForSamples(
          withStart: Date().addingTimeInterval(-Self.initialBackfillDays * 24 * 60 * 60),
          end: nil,
          options: .strictStartDate
        )
      : nil
    let query = HKAnchoredObjectQuery(
      type: sampleType,
      predicate: predicate,
      anchor: anchor,
      limit: Self.anchoredBatchLimit
    ) { [weak self] _, samples, deleted, newAnchor, error in
      guard let self else { return }
      guard error == nil, let newAnchor else {
        Self.logger.error(
          "Health anchored query failed for \(sampleType.identifier, privacy: .public): \(error?.localizedDescription ?? "missing anchor", privacy: .public)"
        )
        self.finishDrain(identifier: sampleType.identifier, token: token)
        return
      }
      let samples = samples ?? []
      let deleted = deleted ?? []
      self.persistAnchoredBatch(
        samples: samples,
        deleted: deleted,
        sampleType: sampleType,
        anchor: newAnchor,
        token: token
      ) { persisted in
        guard persisted else {
          self.finishDrain(identifier: sampleType.identifier, token: token)
          return
        }
        let batchCount = samples.count + deleted.count
        let total = processed + batchCount
        if batchCount >= Self.anchoredBatchLimit && total < Self.initialBackfillLimit {
          self.executeAnchoredDrain(sampleType, token: token, processed: total)
          return
        }
        self.finishDrain(identifier: sampleType.identifier, token: token)
        if batchCount >= Self.anchoredBatchLimit {
          DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 1) {
            self.scheduleDrain(sampleType, token: token, completion: {})
          }
        }
      }
    }
    store.execute(query)
  }

  private func persistAnchoredBatch(
    samples: [HKSample],
    deleted: [HKDeletedObject],
    sampleType: HKSampleType,
    anchor: HKQueryAnchor,
    token: HermesCollectorGenerationToken,
    completion: @escaping (Bool) -> Void
  ) {
    var rawPersisted = true
    let current = HermesAccountLifecycle.performIfCurrentCollectorGeneration(token) {
      stateLock.lock()
      let isActive = activeCollectorToken == token
      stateLock.unlock()
      guard isActive else {
        rawPersisted = false
        return
      }
      let capturedAt = Date().timeIntervalSince1970 * 1000
      let rawEvents = samples.map { sample in
        [
          "account_generation": token.serverAccountGeneration,
          "id": "health-sample:\(sample.uuid.uuidString.lowercased())",
          "kind": "health-sample",
          "lifecycle_epoch": token.lifecycleEpoch,
          "payload": healthSamplePayload(sample, typeIdentifier: sampleType.identifier),
          "timestamp": capturedAt,
        ] as [String: Any]
      } + deleted.map { deletedObject in
        [
          "account_generation": token.serverAccountGeneration,
          "id": "health-sample-delete:\(deletedObject.uuid.uuidString.lowercased())",
          "kind": "health-sample",
          "lifecycle_epoch": token.lifecycleEpoch,
          "payload": [
            "action": "deleted",
            "sample_id": deletedObject.uuid.uuidString.lowercased(),
            "type_identifier": sampleType.identifier,
          ],
          "timestamp": capturedAt,
        ] as [String: Any]
      }
      do {
        rawPersisted = try HermesContextEventQueue.shared.enqueueBatch(rawEvents)
          == rawEvents.count
      } catch {
        rawPersisted = false
      }
    }
    guard current, rawPersisted else {
      completion(false)
      return
    }

    let intervals = sampleType.identifier == HKQuantityTypeIdentifier.stepCount.rawValue
      ? closedDayIntervals(for: samples)
      : []
    Task { [weak self] in
      guard let self else {
        completion(false)
        return
      }
      var aggregatesPersisted = true
      for interval in intervals {
        do {
          let aggregate = try await self.summary(start: interval.start, end: interval.end)
          aggregatesPersisted = self.persistAggregate(
            aggregate,
            interval: interval,
            token: token
          ) && aggregatesPersisted
        } catch {
          aggregatesPersisted = false
        }
      }
      guard aggregatesPersisted else {
        completion(false)
        return
      }
      var saved = false
      let anchorPersisted = HermesAccountLifecycle.performIfCurrentCollectorGeneration(token) {
        saved = self.saveAnchor(
          anchor,
          token: token,
          typeIdentifier: sampleType.identifier,
          processedDelta: samples.count + deleted.count,
          backfillComplete: samples.count + deleted.count < Self.anchoredBatchLimit
        )
      }
      completion(anchorPersisted && saved)
    }
  }

  private func finishDrain(
    identifier: String,
    token: HermesCollectorGenerationToken
  ) {
    stateLock.lock()
    guard activeCollectorToken == token else {
      stateLock.unlock()
      return
    }
    let completions = observerCompletions.removeValue(forKey: identifier) ?? []
    inFlightTypes.remove(identifier)
    stateLock.unlock()
    completions.forEach { $0() }
  }

  func authorizationStatus() async -> String {
    guard HKHealthStore.isHealthDataAvailable() else { return "unavailable" }
    do {
      let requestStatus = try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<HKAuthorizationRequestStatus, Error>) in
        store.getRequestStatusForAuthorization(toShare: [], read: readTypes) { status, error in
          if let error { continuation.resume(throwing: error) }
          else { continuation.resume(returning: status) }
        }
      }
      switch requestStatus {
      case .shouldRequest: return "notDetermined"
      // HealthKit intentionally does not reveal read authorization per type.
      // "limited" means the request was handled and reads may be attempted;
      // it must not be presented as proof that every data type was granted.
      case .unnecessary: return "limited"
      case .unknown: return "unavailable"
      @unknown default: return "unavailable"
      }
    } catch {
      return "unavailable"
    }
  }

  func requestAuthorization() async -> String {
    guard HKHealthStore.isHealthDataAvailable() else { return "unavailable" }
    do {
      try await store.requestAuthorization(toShare: [], read: readTypes)
      _ = resumeBackgroundCollection()
      return "limited"
    } catch {
      return "unavailable"
    }
  }

  func requestWriteAuthorization(identifier: String) async -> String {
    guard HKHealthStore.isHealthDataAvailable(),
          let type = quantityType(identifier: identifier) else { return "unavailable" }
    do {
      _ = try await store.requestAuthorization(toShare: [type], read: [])
      return store.authorizationStatus(for: type) == .sharingAuthorized ? "authorized" : "denied"
    } catch {
      return "unavailable"
    }
  }

  func writeQuantitySample(
    commandID: String,
    identifier: String,
    value: Double,
    unit: String,
    start: Date,
    end: Date
  ) async throws -> [String: Any] {
    guard HKHealthStore.isHealthDataAvailable() else {
      throw HermesNativeActionError.unavailable("healthkit")
    }
    let normalizedCommandID = commandID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedCommandID.isEmpty, normalizedCommandID.count <= 256 else {
      throw HermesNativeActionError.invalidInput("commandID")
    }
    guard value.isFinite, end > start,
          end.timeIntervalSince(start) <= 31 * 24 * 60 * 60 else {
      throw HermesNativeActionError.invalidInput("health sample range or value")
    }
    guard let type = quantityType(identifier: identifier),
          let hkUnit = quantityUnit(unit) else {
      throw HermesNativeActionError.invalidInput("health sample type or unit")
    }
    guard store.authorizationStatus(for: type) == .sharingAuthorized else {
      throw HermesNativeActionError.authorizationRequired("health-write")
    }
    if await hasExistingCommandSample(type: type, commandID: normalizedCommandID) {
      return [
        "commandID": normalizedCommandID,
        "identifier": identifier,
        "value": value,
        "unit": unit,
        "start": start.timeIntervalSince1970 * 1000,
        "end": end.timeIntervalSince1970 * 1000,
        "saved": true,
        "deduplicated": true,
      ]
    }
    let sample = HKQuantitySample(
      type: type,
      quantity: HKQuantity(unit: hkUnit, doubleValue: value),
      start: start,
      end: end,
      metadata: [HKMetadataKeyExternalUUID: normalizedCommandID]
    )
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      store.save(sample) { success, error in
        if let error { continuation.resume(throwing: error) }
        else if success { continuation.resume(returning: ()) }
        else { continuation.resume(throwing: HermesNativeActionError.unavailable("healthkit-save")) }
      }
    }
    return [
      "commandID": normalizedCommandID,
      "identifier": identifier,
      "value": value,
      "unit": unit,
      "start": start.timeIntervalSince1970 * 1000,
      "end": end.timeIntervalSince1970 * 1000,
      "saved": true,
    ]
  }

  func writeQuantitySamples(commandID: String, samples: [[String: Any]]) async throws -> [String: Any] {
    guard HKHealthStore.isHealthDataAvailable() else { throw HermesNativeActionError.unavailable("healthkit") }
    let normalizedCommandID = commandID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedCommandID.isEmpty, normalizedCommandID.count <= 256,
          !samples.isEmpty, samples.count <= 100 else { throw HermesNativeActionError.invalidInput("samples") }
    var pending: [HKQuantitySample] = []
    var deduplicated = 0
    for (index, input) in samples.enumerated() {
      guard let identifier = input["identifier"] as? String,
            let value = (input["value"] as? NSNumber)?.doubleValue,
            let unit = input["unit"] as? String,
            let start = epochDate(input["start"]),
            let end = epochDate(input["end"]),
            value.isFinite, end > start,
            end.timeIntervalSince(start) <= 31 * 24 * 60 * 60,
            let type = quantityType(identifier: identifier),
            let hkUnit = quantityUnit(unit),
            store.authorizationStatus(for: type) == .sharingAuthorized else {
        throw HermesNativeActionError.invalidInput("health sample")
      }
      let sampleCommandID = "\(normalizedCommandID):\(index)"
      if await hasExistingCommandSample(type: type, commandID: sampleCommandID) {
        deduplicated += 1
        continue
      }
      pending.append(HKQuantitySample(
        type: type,
        quantity: HKQuantity(unit: hkUnit, doubleValue: value),
        start: start,
        end: end,
        metadata: [HKMetadataKeyExternalUUID: sampleCommandID]
      ))
    }
    if !pending.isEmpty {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        store.save(pending) { success, error in
          if let error { continuation.resume(throwing: error) }
          else if success { continuation.resume(returning: ()) }
          else { continuation.resume(throwing: HermesNativeActionError.unavailable("healthkit-save")) }
        }
      }
    }
    return ["commandID": normalizedCommandID, "saved": pending.count, "deduplicated": deduplicated]
  }

  func deleteQuantitySamples(commandID: String, identifier: String) async throws -> [String: Any] {
    guard HKHealthStore.isHealthDataAvailable(),
          let type = quantityType(identifier: identifier),
          store.authorizationStatus(for: type) == .sharingAuthorized else {
      throw HermesNativeActionError.authorizationRequired("health-write")
    }
    let normalizedCommandID = commandID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedCommandID.isEmpty, normalizedCommandID.count <= 256 else {
      throw HermesNativeActionError.invalidInput("commandID")
    }
    let samples: [HKQuantitySample] = try await withCheckedThrowingContinuation { continuation in
      let query = HKSampleQuery(sampleType: type, predicate: nil, limit: 100, sortDescriptors: nil) { _, objects, error in
        if let error { continuation.resume(throwing: error); return }
        let matching = (objects as? [HKQuantitySample] ?? []).filter { sample in
          guard let value = sample.metadata?[HKMetadataKeyExternalUUID] as? String else { return false }
          return value == normalizedCommandID || value.hasPrefix("\(normalizedCommandID):")
        }
        continuation.resume(returning: matching)
      }
      store.execute(query)
    }
    guard !samples.isEmpty else { return ["commandID": normalizedCommandID, "deleted": 0] }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      store.delete(samples) { success, error in
        if let error { continuation.resume(throwing: error) }
        else if success { continuation.resume(returning: ()) }
        else { continuation.resume(throwing: HermesNativeActionError.unavailable("healthkit-delete")) }
      }
    }
    return ["commandID": normalizedCommandID, "deleted": samples.count]
  }

  private func hasExistingCommandSample(type: HKQuantityType, commandID: String) async -> Bool {
    await withCheckedContinuation { continuation in
      let predicate = HKQuery.predicateForObjects(
        withMetadataKey: HKMetadataKeyExternalUUID,
        allowedValues: [commandID]
      )
      let query = HKSampleQuery(
        sampleType: type,
        predicate: predicate,
        limit: 1,
        sortDescriptors: nil
      ) { _, samples, _ in
        continuation.resume(returning: !(samples ?? []).isEmpty)
      }
      self.store.execute(query)
    }
  }

  private func epochDate(_ value: Any?) -> Date? {
    guard let number = value as? NSNumber else { return nil }
    let raw = number.doubleValue
    guard raw.isFinite, raw > 0 else { return nil }
    return Date(timeIntervalSince1970: raw > 10_000_000_000 ? raw / 1000 : raw)
  }

  private func quantityType(identifier: String) -> HKQuantityType? {
    let normalized = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return nil }
    return HKQuantityType.quantityType(forIdentifier: HKQuantityTypeIdentifier(rawValue: normalized))
  }

  private func quantityUnit(_ unit: String) -> HKUnit? {
    switch unit.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "count": return .count()
    case "kcal", "kilocalorie", "kilocalories": return .kilocalorie()
    case "bpm", "count/min", "countperminute": return .count().unitDivided(by: .minute())
    case "%", "percent": return .percent()
    case "kg", "kilogram", "kilograms": return .gramUnit(with: .kilo)
    case "g", "gram", "grams": return .gram()
    case "lb", "lbs", "pound", "pounds": return .pound()
    case "m", "meter", "meters": return .meter()
    case "cm", "centimeter", "centimeters": return .meterUnit(with: .centi)
    case "km", "kilometer", "kilometers": return .meterUnit(with: .kilo)
    case "mi", "mile", "miles": return .mile()
    case "ml", "milliliter", "milliliters": return .literUnit(with: .milli)
    case "l", "liter", "liters": return .liter()
    case "mmhg": return .millimeterOfMercury()
    case "degc", "c", "celsius": return .degreeCelsius()
    case "degf", "f", "fahrenheit": return .degreeFahrenheit()
    case "s", "sec", "second", "seconds": return .second()
    case "min", "minute", "minutes": return .minute()
    case "h", "hr", "hour", "hours": return .hour()
    default: return nil
    }
  }

  func summary(start: Date, end: Date) async throws -> [String: Any] {
    guard HKHealthStore.isHealthDataAvailable() else {
      return emptySummary(authorization: "unavailable")
    }
    let rangeStart = min(start, end)
    let rangeEnd = max(start, end)
    let authorization = await authorizationStatus()
    async let heartRate = optionalAverageQuantity(
      .heartRate,
      unit: HKUnit.count().unitDivided(by: .minute()),
      start: rangeStart,
      end: rangeEnd
    )
    async let restingHeartRate = optionalAverageQuantity(
      .restingHeartRate,
      unit: HKUnit.count().unitDivided(by: .minute()),
      start: rangeStart,
      end: rangeEnd
    )
    async let oxygen = optionalAverageQuantity(
      .oxygenSaturation,
      unit: .percent(),
      start: rangeStart,
      end: rangeEnd
    )
    async let steps = optionalCumulativeQuantity(
      .stepCount,
      unit: .count(),
      start: rangeStart,
      end: rangeEnd
    )
    async let activeEnergy = optionalCumulativeQuantity(
      .activeEnergyBurned,
      unit: .kilocalorie(),
      start: rangeStart,
      end: rangeEnd
    )
    async let exerciseMinutes = optionalCumulativeQuantity(
      .appleExerciseTime,
      unit: .minute(),
      start: rangeStart,
      end: rangeEnd
    )
    async let distance = optionalCumulativeQuantity(
      .distanceWalkingRunning,
      unit: .meter(),
      start: rangeStart,
      end: rangeEnd
    )
    async let sleep = optionalSleepMinutes(start: rangeStart, end: rangeEnd)
    async let workouts = optionalWorkoutSummary(start: rangeStart, end: rangeEnd)

    let heartRateValue = await heartRate
    let restingHeartRateValue = await restingHeartRate
    let oxygenValue = await oxygen
    let stepsValue = await steps
    let activeEnergyValue = await activeEnergy
    let exerciseMinutesValue = await exerciseMinutes
    let distanceValue = await distance
    let sleepValue = await sleep
    let workoutValues = await workouts
    return [
      "authorization": authorization,
      "activeEnergyKcal": hermesNullable(activeEnergyValue),
      "distanceWalkingRunningMeters": hermesNullable(distanceValue),
      "domainAuthorization": [
        "activity": domainStatus(
          authorization: authorization,
          hasData: stepsValue != nil || activeEnergyValue != nil
            || exerciseMinutesValue != nil || distanceValue != nil || !workoutValues.isEmpty
        ),
        "heart": domainStatus(
          authorization: authorization,
          hasData: heartRateValue != nil || restingHeartRateValue != nil
        ),
        "oxygen": domainStatus(authorization: authorization, hasData: oxygenValue != nil),
        "sleep": domainStatus(authorization: authorization, hasData: sleepValue != nil),
      ],
      "exerciseMinutes": hermesNullable(exerciseMinutesValue),
      "heartRateBpm": hermesNullable(heartRateValue),
      "oxygenSaturation": hermesNullable(oxygenValue),
      "restingHeartRateBpm": hermesNullable(restingHeartRateValue),
      "sleepMinutes": hermesNullable(sleepValue),
      "steps": hermesNullable(stepsValue),
      "workouts": workoutValues,
    ]
  }

  private func domainStatus(authorization: String, hasData: Bool) -> String {
    if authorization == "unavailable" { return "unavailable" }
    return hasData ? "available" : "limited"
  }

  private func healthSamplePayload(
    _ sample: HKSample,
    typeIdentifier: String
  ) -> [String: Any] {
    var payload: [String: Any] = [
      "end": sample.endDate.timeIntervalSince1970 * 1000,
      "sample_id": sample.uuid.uuidString.lowercased(),
      "source_bundle": sample.sourceRevision.source.bundleIdentifier,
      "start": sample.startDate.timeIntervalSince1970 * 1000,
      "type_identifier": typeIdentifier,
    ]
    if let quantity = sample as? HKQuantitySample {
      let value: Double
      switch typeIdentifier {
      case HKQuantityTypeIdentifier.heartRate.rawValue:
        value = quantity.quantity.doubleValue(
          for: HKUnit.count().unitDivided(by: .minute())
        )
        payload["heartRateBpm"] = value
        payload["unit"] = "count/min"
      case HKQuantityTypeIdentifier.restingHeartRate.rawValue:
        value = quantity.quantity.doubleValue(
          for: HKUnit.count().unitDivided(by: .minute())
        )
        payload["restingHeartRateBpm"] = value
        payload["unit"] = "count/min"
      case HKQuantityTypeIdentifier.oxygenSaturation.rawValue:
        value = quantity.quantity.doubleValue(for: .percent())
        payload["oxygenSaturation"] = value
        payload["unit"] = "%"
      case HKQuantityTypeIdentifier.stepCount.rawValue:
        value = quantity.quantity.doubleValue(for: .count())
        payload["steps"] = value
        payload["unit"] = "count"
      case HKQuantityTypeIdentifier.activeEnergyBurned.rawValue:
        value = quantity.quantity.doubleValue(for: .kilocalorie())
        payload["activeEnergyKcal"] = value
        payload["unit"] = "kcal"
      case HKQuantityTypeIdentifier.appleExerciseTime.rawValue:
        value = quantity.quantity.doubleValue(for: .minute())
        payload["exerciseMinutes"] = value
        payload["unit"] = "min"
      case HKQuantityTypeIdentifier.distanceWalkingRunning.rawValue:
        value = quantity.quantity.doubleValue(for: .meter())
        payload["distanceWalkingRunningMeters"] = value
        payload["unit"] = "m"
      default:
        value = 0
      }
      payload["value"] = value
    } else if let category = sample as? HKCategorySample {
      payload["category_value"] = category.value
      payload["sleepMinutes"] = max(0, category.endDate.timeIntervalSince(category.startDate) / 60)
    } else if let workout = sample as? HKWorkout {
      payload.merge(workoutPayload(workout)) { _, workoutValue in workoutValue }
    }
    return payload
  }

  private func closedDayIntervals(for samples: [HKSample]) -> [(start: Date, end: Date)] {
    let secondsPerDay: TimeInterval = 24 * 60 * 60
    let currentDay = floor(Date().timeIntervalSince1970 / secondsPerDay) * secondsPerDay
    var starts = Set(samples.map {
      floor($0.endDate.timeIntervalSince1970 / secondsPerDay) * secondsPerDay
    }.filter { $0 < currentDay })
    starts.insert(currentDay - secondsPerDay)
    return starts.sorted().suffix(Int(Self.initialBackfillDays) + 1).map {
      let start = Date(timeIntervalSince1970: $0)
      return (start: start, end: start.addingTimeInterval(secondsPerDay))
    }
  }

  private func persistAggregate(
    _ aggregate: [String: Any],
    interval: (start: Date, end: Date),
    token: HermesCollectorGenerationToken
  ) -> Bool {
    let bucket = Int(interval.start.timeIntervalSince1970 * 1000)
    let common: [String: Any] = [
      "authorization": aggregate["authorization"] ?? "limited",
      "bucket_end": interval.end.timeIntervalSince1970 * 1000,
      "bucket_start": Double(bucket),
    ]
    let values: [(String, [String: Any])] = [
      ("health-sleep", common.merging([
        "sleepMinutes": aggregate["sleepMinutes"] ?? NSNull(),
      ]) { _, value in value }),
      ("health-heart", common.merging([
        "heartRateBpm": aggregate["heartRateBpm"] ?? NSNull(),
        "restingHeartRateBpm": aggregate["restingHeartRateBpm"] ?? NSNull(),
      ]) { _, value in value }),
      ("health-oxygen", common.merging([
        "oxygenSaturation": aggregate["oxygenSaturation"] ?? NSNull(),
      ]) { _, value in value }),
      ("health-activity", common.merging([
        "activeEnergyKcal": aggregate["activeEnergyKcal"] ?? NSNull(),
        "distanceWalkingRunningMeters": aggregate["distanceWalkingRunningMeters"] ?? NSNull(),
        "exerciseMinutes": aggregate["exerciseMinutes"] ?? NSNull(),
        "steps": aggregate["steps"] ?? NSNull(),
        "workouts": aggregate["workouts"] ?? [],
      ]) { _, value in value }),
    ]
    var persisted = true
    let current = HermesAccountLifecycle.performIfCurrentCollectorGeneration(token) {
      for (kind, payload) in values {
        persisted = HermesContextEventQueue.shared.enqueue(
          type: kind,
          payload: payload,
          occurredAt: Date(),
          accountGeneration: token.lifecycleEpoch,
          eventID: "health-aggregate:\(kind):\(bucket)"
        ) && persisted
      }
    }
    return current && persisted
  }

  private func anchorKey(
    token: HermesCollectorGenerationToken,
    typeIdentifier: String
  ) -> String {
    "app.hermes.health.anchor.\(token.regionNamespace).\(typeIdentifier)"
  }

  private func anchorIndexKey(token: HermesCollectorGenerationToken) -> String {
    "app.hermes.health.anchor-index.\(token.regionNamespace)"
  }

  private func loadAnchor(
    token: HermesCollectorGenerationToken,
    typeIdentifier: String
  ) -> HKQueryAnchor? {
    let key = anchorKey(token: token, typeIdentifier: typeIdentifier)
    guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
    return (try? NSKeyedUnarchiver.unarchiveTopLevelObjectWithData(data)) as? HKQueryAnchor
  }

  private func saveAnchor(
    _ anchor: HKQueryAnchor,
    token: HermesCollectorGenerationToken,
    typeIdentifier: String,
    processedDelta: Int = 0,
    backfillComplete: Bool = false
  ) -> Bool {
    let data = try? NSKeyedArchiver.archivedData(
      withRootObject: anchor,
      requiringSecureCoding: false
    )
    guard let data else { return false }
    let defaults = UserDefaults.standard
    let key = anchorKey(token: token, typeIdentifier: typeIdentifier)
    let progressKey = "\(key).backfill-progress"
    let completeKey = "\(key).backfill-complete"
    defaults.set(data, forKey: key)
    defaults.set(defaults.integer(forKey: progressKey) + processedDelta, forKey: progressKey)
    if backfillComplete { defaults.set(true, forKey: completeKey) }
    let indexKey = anchorIndexKey(token: token)
    var keys = Set(defaults.stringArray(forKey: indexKey) ?? [])
    keys.formUnion([key, progressKey, completeKey])
    defaults.set(Array(keys).sorted(), forKey: indexKey)
    defaults.synchronize()
    return true
  }

  private func deleteAnchorState(token: HermesCollectorGenerationToken) {
    let defaults = UserDefaults.standard
    let indexKey = anchorIndexKey(token: token)
    (defaults.stringArray(forKey: indexKey) ?? []).forEach {
      defaults.removeObject(forKey: $0)
    }
    defaults.removeObject(forKey: indexKey)
    defaults.synchronize()
  }

  private func emptySummary(authorization: String) -> [String: Any] {
    [
      "authorization": authorization,
      "activeEnergyKcal": NSNull(),
      "distanceWalkingRunningMeters": NSNull(),
      "domainAuthorization": [
        "activity": "unavailable",
        "heart": "unavailable",
        "oxygen": "unavailable",
        "sleep": "unavailable",
      ],
      "exerciseMinutes": NSNull(),
      "heartRateBpm": NSNull(),
      "oxygenSaturation": NSNull(),
      "restingHeartRateBpm": NSNull(),
      "sleepMinutes": NSNull(),
      "steps": NSNull(),
      "workouts": [],
    ]
  }

  private func averageQuantity(
    _ identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    start: Date,
    end: Date
  ) async throws -> Double? {
    guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else { return nil }
    let statistics = try await statistics(type: type, option: .discreteAverage, start: start, end: end)
    return statistics?.averageQuantity()?.doubleValue(for: unit)
  }

  private func optionalAverageQuantity(
    _ identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    start: Date,
    end: Date
  ) async -> Double? {
    do { return try await averageQuantity(identifier, unit: unit, start: start, end: end) }
    catch { return nil }
  }

  private func cumulativeQuantity(
    _ identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    start: Date,
    end: Date
  ) async throws -> Double? {
    guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else { return nil }
    let statistics = try await statistics(type: type, option: .cumulativeSum, start: start, end: end)
    return statistics?.sumQuantity()?.doubleValue(for: unit)
  }

  private func optionalCumulativeQuantity(
    _ identifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    start: Date,
    end: Date
  ) async -> Double? {
    do { return try await cumulativeQuantity(identifier, unit: unit, start: start, end: end) }
    catch { return nil }
  }

  private func statistics(
    type: HKQuantityType,
    option: HKStatisticsOptions,
    start: Date,
    end: Date
  ) async throws -> HKStatistics? {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HKStatistics?, Error>) in
      let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
      let query = HKStatisticsQuery(
        quantityType: type,
        quantitySamplePredicate: predicate,
        options: option
      ) { _, statistics, error in
        if let error { continuation.resume(throwing: error) }
        else { continuation.resume(returning: statistics) }
      }
      store.execute(query)
    }
  }

  private func sleepMinutes(start: Date, end: Date) async throws -> Double? {
    guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return nil }
    let samples: [HKCategorySample] = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HKCategorySample], Error>) in
      let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
      let query = HKSampleQuery(
        sampleType: type,
        predicate: predicate,
        limit: HKObjectQueryNoLimit,
        sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
      ) { _, samples, error in
        if let error { continuation.resume(throwing: error) }
        else { continuation.resume(returning: (samples as? [HKCategorySample]) ?? []) }
      }
      store.execute(query)
    }
    let asleep = samples.filter { sample in
      sample.value != HKCategoryValueSleepAnalysis.inBed.rawValue
        && sample.value != HKCategoryValueSleepAnalysis.awake.rawValue
    }
    guard !asleep.isEmpty else { return nil }
    let intervals = asleep
      .map { (start: max($0.startDate, start), end: min($0.endDate, end)) }
      .filter { $0.end > $0.start }
      .sorted { $0.start < $1.start }
    guard var current = intervals.first else { return nil }
    var total: TimeInterval = 0
    for interval in intervals.dropFirst() {
      if interval.start <= current.end {
        current.end = max(current.end, interval.end)
      } else {
        total += current.end.timeIntervalSince(current.start)
        current = interval
      }
    }
    total += current.end.timeIntervalSince(current.start)
    return total / 60
  }

  private func optionalSleepMinutes(start: Date, end: Date) async -> Double? {
    do { return try await sleepMinutes(start: start, end: end) }
    catch { return nil }
  }

  private func workoutSummary(start: Date, end: Date) async throws -> [[String: Any]] {
    let type = HKObjectType.workoutType()
    return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[[String: Any]], Error>) in
      let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
      let query = HKSampleQuery(
        sampleType: type,
        predicate: predicate,
        limit: 100,
        sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
      ) { _, samples, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        let workouts = samples as? [HKWorkout] ?? []
        var values: [[String: Any]] = []
        values.reserveCapacity(workouts.count)
        for workout in workouts {
          values.append(self.workoutPayload(workout))
        }
        continuation.resume(returning: values)
      }
      store.execute(query)
    }
  }

  private func optionalWorkoutSummary(start: Date, end: Date) async -> [[String: Any]] {
    do { return try await workoutSummary(start: start, end: end) }
    catch { return [] }
  }

  private func workoutPayload(_ workout: HKWorkout) -> [String: Any] {
    let energy = workout.totalEnergyBurned?.doubleValue(for: HKUnit.kilocalorie())
    return [
      "activity": workout.workoutActivityType.rawValue,
      "durationMinutes": workout.duration / 60,
      "energyKcal": hermesNullable(energy),
      "end": workout.endDate.timeIntervalSince1970 * 1000,
      "id": workout.uuid.uuidString,
      "start": workout.startDate.timeIntervalSince1970 * 1000,
    ]
  }
}
