import Foundation
import HealthKit

final class HermesHealthService {
  static let shared = HermesHealthService()

  private let store = HKHealthStore()

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
      case .unnecessary: return "authorized"
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
      return "authorized"
    } catch {
      return "denied"
    }
  }

  func summary(start: Date, end: Date) async throws -> [String: Any] {
    guard HKHealthStore.isHealthDataAvailable() else {
      return emptySummary(authorization: "unavailable")
    }
    let rangeStart = min(start, end)
    let rangeEnd = max(start, end)
    async let heartRate = averageQuantity(
      .heartRate,
      unit: HKUnit.count().unitDivided(by: .minute()),
      start: rangeStart,
      end: rangeEnd
    )
    async let restingHeartRate = averageQuantity(
      .restingHeartRate,
      unit: HKUnit.count().unitDivided(by: .minute()),
      start: rangeStart,
      end: rangeEnd
    )
    async let oxygen = averageQuantity(
      .oxygenSaturation,
      unit: .percent(),
      start: rangeStart,
      end: rangeEnd
    )
    async let steps = cumulativeQuantity(
      .stepCount,
      unit: .count(),
      start: rangeStart,
      end: rangeEnd
    )
    async let activeEnergy = cumulativeQuantity(
      .activeEnergyBurned,
      unit: .kilocalorie(),
      start: rangeStart,
      end: rangeEnd
    )
    async let exerciseMinutes = cumulativeQuantity(
      .appleExerciseTime,
      unit: .minute(),
      start: rangeStart,
      end: rangeEnd
    )
    async let distance = cumulativeQuantity(
      .distanceWalkingRunning,
      unit: .meter(),
      start: rangeStart,
      end: rangeEnd
    )
    async let sleep = sleepMinutes(start: rangeStart, end: rangeEnd)
    async let workouts = workoutSummary(start: rangeStart, end: rangeEnd)

    return [
      "authorization": "authorized",
      "activeEnergyKcal": hermesNullable(try await activeEnergy),
      "distanceWalkingRunningMeters": hermesNullable(try await distance),
      "exerciseMinutes": hermesNullable(try await exerciseMinutes),
      "heartRateBpm": hermesNullable(try await heartRate),
      "oxygenSaturation": hermesNullable(try await oxygen),
      "restingHeartRateBpm": hermesNullable(try await restingHeartRate),
      "sleepMinutes": hermesNullable(try await sleep),
      "steps": hermesNullable(try await steps),
      "workouts": try await workouts,
    ]
  }

  private func emptySummary(authorization: String) -> [String: Any] {
    [
      "authorization": authorization,
      "activeEnergyKcal": NSNull(),
      "distanceWalkingRunningMeters": NSNull(),
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
    return asleep.reduce(0) { $0 + $1.endDate.timeIntervalSince($1.startDate) } / 60
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
