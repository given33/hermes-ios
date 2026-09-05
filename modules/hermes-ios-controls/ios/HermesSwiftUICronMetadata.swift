import Foundation
import SwiftUI

struct HermesCronDeliveryTarget: Decodable, Identifiable {
  let id: String
  let name: String
  let home_target_set: Bool

  static func decode(_ text: String?) -> [Self] {
    struct Catalog: Decodable { let targets: [HermesCronDeliveryTarget] }
    guard let bytes = text?.data(using: .utf8),
          let catalog = try? JSONDecoder().decode(Catalog.self, from: bytes) else { return [] }
    return catalog.targets
  }
}

struct HermesCronDeliverySection: View {
  let chinese: Bool
  let targets: [HermesCronDeliveryTarget]

  var body: some View {
    Section(chinese ? "投递目标" : "Delivery targets") {
      ForEach(targets) { target in
        VStack(alignment: .leading, spacing: 4) {
          Text(target.name).font(HermesFonts.bodyBold(13))
          Label(target.home_target_set ? (chinese ? "可用" : "Ready") : (chinese ? "未配置默认频道" : "No home channel"),
                systemImage: target.home_target_set ? "checkmark.circle" : "exclamationmark.circle")
            .font(HermesFonts.body(12)).foregroundStyle(.secondary)
        }
      }
      if targets.isEmpty {
        Text(chinese ? "投递目标不可用" : "Delivery targets unavailable").foregroundStyle(.secondary)
      }
    }
  }
}

private struct HermesCronRunMetadata: Decodable, Identifiable {
  let id: String
  let title: String?
  let started_at: Double?
  let ended_at: Double?
  let is_active: Bool?
  let model: String?
}

private struct HermesCronHistoryMetadata: Decodable, Identifiable {
  let jobId: String
  let profile: String
  let runs: [HermesCronRunMetadata]?
  let unavailable: Bool?
  var id: String { "\(profile.utf8.count):\(profile)\(jobId)" }
}

struct HermesCronHistorySection: View {
  let chinese: Bool
  let jobs: [HermesCronJobSnapshot]
  private let histories: [HermesCronHistoryMetadata]

  init(chinese: Bool, jobs: [HermesCronJobSnapshot], json: String?) {
    self.chinese = chinese
    self.jobs = jobs
    if let bytes = json?.data(using: .utf8),
       let groups = try? JSONDecoder().decode([String: HermesCronHistoryMetadata].self, from: bytes) {
      histories = groups.values.sorted { ($0.profile, $0.jobId) < ($1.profile, $1.jobId) }
    } else {
      histories = []
    }
  }

  var body: some View {
    Section(chinese ? "运行历史" : "Run history") {
      ForEach(histories) { history in
        DisclosureGroup {
          if history.unavailable == true {
            Label(chinese ? "加载失败" : "Could not load history", systemImage: "exclamationmark.circle")
          } else if let runs = history.runs, !runs.isEmpty {
            ForEach(runs) { run in
              DisclosureGroup {
                Text(run.id).font(HermesFonts.mono(11)).textSelection(.enabled)
                if let model = run.model { Text(model).font(HermesFonts.body(12)) }
                if let start = run.started_at { timestamp(chinese ? "开始" : "Started", start) }
                if let end = run.ended_at { timestamp(chinese ? "结束" : "Ended", end) }
              } label: {
                VStack(alignment: .leading, spacing: 4) {
                  Text(run.title.flatMap { $0.isEmpty ? nil : $0 } ?? run.id)
                    .font(HermesFonts.body(13))
                  Text(run.is_active == true ? (chinese ? "运行中" : "Running")
                    : run.ended_at != nil ? (chinese ? "已结束" : "Ended") : (chinese ? "未活动" : "Inactive"))
                    .font(HermesFonts.body(11)).foregroundStyle(.secondary)
                }
              }
            }
          } else {
            Text(chinese ? "暂无运行记录" : "No recorded runs").foregroundStyle(.secondary)
          }
        } label: {
          VStack(alignment: .leading, spacing: 4) {
            Text(jobs.first { $0.id == history.jobId && ($0.profile ?? "default") == history.profile }?.name ?? history.jobId)
              .font(HermesFonts.bodyBold(13))
            Text(history.profile).font(HermesFonts.body(11)).foregroundStyle(.secondary)
          }
        }
      }
      if histories.isEmpty {
        Text(chinese ? "运行历史不可用" : "Run history unavailable").foregroundStyle(.secondary)
      }
    }
  }

  private func timestamp(_ label: String, _ seconds: Double) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(label).font(HermesFonts.body(11)).foregroundStyle(.secondary)
      Text(Date(timeIntervalSince1970: seconds), format: .dateTime.year().month().day().hour().minute().second())
        .font(HermesFonts.body(12))
    }
  }
}
