import Charts
import CoreImage
import Foundation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct HermesRouteContent: View {
  let attachmentIds: [String]
  let attachmentNames: [String]
  let data: HermesRouteSnapshot
  let route: HermesRoute
  let chinese: Bool
  let renderDeferredContent: Bool
  let onAction: HermesRouteActionSink

  var body: some View {
    switch route {
    case .chat:
      // Chat deliberately stays in the existing React Native/Hermes surface.
      // This native route host is used only for destinations opened from the sidebar.
      EmptyView()
    case .sessions:
      HermesSessionsPage(
        chinese: chinese,
        sessions: data.sessions,
        sessionContext: data.sessionContext,
        sessionSidebarJSON: data.sessionSidebarJSON,
        sessionProjectsJSON: data.sessionProjectsJSON,
        sessionPullRequestsJSON: data.sessionPullRequestsJSON,
        sessionStatsJSON: data.sessionStatsJSON,
        onAction: onAction
      )
    case .memory:
      HermesMemoryPage(data: data.memory, chinese: chinese, onAction: onAction)
    case .files:
      HermesFilesPage(
        chinese: chinese,
        files: data.files,
        accountFilesJSON: data.accountFilesJSON,
        managedFilesJSON: data.managedFilesJSON,
        onAction: onAction
      )
    case .git:
      HermesGitPage(data: data.git, chinese: chinese, onAction: onAction)
    case .analytics:
      HermesAnalyticsPage(
        analytics: data.analytics,
        chinese: chinese,
        renderChart: renderDeferredContent,
        onAction: onAction
      )
    case .smartWeather:
      EmptyView()
    case .browser:
      EmptyView()
    case .models:
      HermesModelsPage(
        chinese: chinese,
        detectedModels: data.detectedModels,
        models: data.models,
        auxiliary: data.modelAuxiliary,
        moa: data.modelMoa,
        modelMoaJSON: data.modelMoaJSON,
        providerOauthJSON: data.providerOauthJSON,
        providerOauthPendingJSON: data.providerOauthPendingJSON,
        credentialPoolJSON: data.credentialPoolJSON,
        customProviderEndpointsJSON: data.customProviderEndpointsJSON,
        confirmation: data.modelConfirmation,
        operation: data.operation,
        onAction: onAction
      )
    case .logs:
      HermesLogsPage(
        chinese: chinese,
        logs: data.logs,
        onAction: onAction
      )
    case .cron:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .skills:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .plugins:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .mcp:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .pairing:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .channels:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .webhooks:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .achievements:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .collaboration:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .kanban:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .workflows:
      HermesWorkflowsPage(
        data: data.workflows,
        operation: data.operation,
        chinese: chinese,
        onAction: onAction
      )
    case .approvals:
      HermesApprovalsPage(data: data.approvals, chinese: chinese, onAction: onAction)
    case .runtimeCenter:
      HermesRuntimeCenterPage(data: data.runtime, chinese: chinese, onAction: onAction)
    case .profiles:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .bots:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .config:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .account:
      EmptyView()
    case .env:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .system:
      HermesRemoteRoutePage(route: route, data: data, chinese: chinese, onAction: onAction)
    case .docs:
      HermesDocsPage(chinese: chinese)
    }
  }
}

private struct HermesWorkflowsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  @State private var locallyPendingWorkflowIds: Set<String> = []
  @State private var workflowRequestIds: [String: String] = [:]
  let data: HermesWorkflowSnapshot
  let operation: HermesRouteOperationSnapshot?
  let chinese: Bool
  let onAction: HermesRouteActionSink

  var body: some View {
    List {
      if let health = data.health {
        Section(chinese ? "工作流服务" : "Workflow service") {
          HStack(spacing: 8) {
            Circle()
              .fill(health.ok ? appearance.palette.success : appearance.palette.destructive)
              .frame(width: 8, height: 8)
            Text(health.ok
              ? (chinese ? "服务正常" : "Service healthy")
              : (chinese ? "服务异常" : "Service unavailable"))
              .font(HermesFonts.bodyBold(13))
            Spacer()
            if let recoverable = health.recoverableRuns {
              Text(chinese ? "可恢复 (recoverable)" : "(recoverable) recoverable")
                .font(HermesFonts.mono(10))
                .foregroundStyle(appearance.palette.secondary)
            }
          }
        }
      }
      if data.workflows.isEmpty {
        ContentUnavailableView(
          chinese ? "暂无工作流" : "No workflows",
          systemImage: "arrow.triangle.branch",
          description: Text(chinese ? "工作流定义由 Hermes 服务器管理。" : "Workflow definitions are managed by the Hermes server.")
        )
      } else {
        Section(chinese ? "工作流" : "Workflows") {
          ForEach(data.workflows) { workflow in
            Button {
              onAction(.workflowSelect, HermesRouteActionPayload(route: "workflows", id: workflow.id))
            } label: {
              HStack(spacing: 12) {
                Image(systemName: workflow.id == data.selectedWorkflowId ? "checkmark.circle.fill" : "arrow.triangle.branch")
                  .foregroundStyle(appearance.palette.accent)
                VStack(alignment: .leading, spacing: 3) {
                  Text(workflow.name).font(HermesFonts.bodyBold(15))
                  if !workflow.detail.isEmpty {
                    Text(workflow.detail).font(HermesFonts.body(12)).foregroundStyle(appearance.palette.secondary)
                  }
                }
                Spacer()
                if !workflow.state.isEmpty { HermesStatusPill(text: workflow.state) }
              }
            }
            .buttonStyle(.plain)
          }
        }
      }
      if let selectedId = data.selectedWorkflowId {
        Section(chinese ? "执行" : "Execution") {
          if let run = data.run {
            HStack {
              VStack(alignment: .leading, spacing: 4) {
                Text(run.state).font(HermesFonts.bodyBold(14))
                if let current = run.currentNodeId {
                  Text(current).font(HermesFonts.body(12)).foregroundStyle(appearance.palette.secondary)
                }
              }
              Spacer()
              if run.canCancel {
                Button(role: .destructive) {
                  onAction(
                    .workflowCancel,
                    HermesRouteActionPayload(
                      route: "workflows",
                      id: run.id,
                      requestId: "workflow-cancel-\(UUID().uuidString.lowercased())",
                      fields: ["revision": String(run.revision)]
                    )
                  )
                } label: { Image(systemName: "stop.circle") }
              }
            }
            if let error = run.error, !error.isEmpty {
              Text(error).font(HermesFonts.body(12)).foregroundStyle(appearance.palette.destructive).textSelection(.enabled)
            }
            if !run.canCancel {
              workflowStartButton(
                workflowId: selectedId,
                title: chinese ? "再次启动" : "Start again"
              )
            }
          } else {
            workflowStartButton(
              workflowId: selectedId,
              title: chinese ? "启动工作流" : "Start workflow"
            )
          }
        }
        if !data.nodes.isEmpty {
          Section(chinese ? "节点" : "Nodes") {
            ForEach(data.nodes) { node in
              VStack(alignment: .leading, spacing: 7) {
                HStack {
                  Text(node.label).font(HermesFonts.bodyBold(14))
                  Spacer()
                  HermesStatusPill(text: node.state)
                }
                if !node.detail.isEmpty {
                  Text(node.detail).font(HermesFonts.body(12)).foregroundStyle(appearance.palette.secondary)
                }
                if let run = data.run, let runNodeId = node.runNodeId, node.revision > 0 {
                  HStack {
                    if node.state == "failed" {
                      Button(chinese ? "重试" : "Retry") {
                        onAction(
                          .workflowRetry,
                          HermesRouteActionPayload(
                            route: "workflows",
                            id: run.id,
                            targetId: runNodeId,
                            requestId: "workflow-retry-\(UUID().uuidString.lowercased())",
                            fields: ["revision": String(node.revision)]
                          )
                        )
                      }
                    }
                    if node.approvalPending {
                      Button(chinese ? "单次批准" : "Approve once") {
                        onAction(
                          .workflowApprove,
                          HermesRouteActionPayload(
                            route: "workflows",
                            id: run.id,
                            targetId: runNodeId,
                            requestId: "workflow-approve-\(UUID().uuidString.lowercased())",
                            fields: ["revision": String(node.revision)]
                          )
                        )
                      }
                    }
                  }.buttonStyle(.bordered)
                }
              }.padding(.vertical, 3)
            }
          }
        }
        if !data.workspaceAudits.isEmpty {
          Section(chinese ? "工作区审计" : "Workspace audit") {
            ForEach(data.workspaceAudits) { audit in
              VStack(alignment: .leading, spacing: 5) {
                HStack {
                  Text(audit.nodeRunId)
                    .font(HermesFonts.mono(10))
                    .lineLimit(1)
                  Spacer()
                  HermesStatusPill(text: audit.state)
                }
                Text(
                  chinese
                    ? "\(audit.fileCount) 个文件 · \(audit.byteCount.formatted()) 字节"
                    : "\(audit.fileCount) files · \(audit.byteCount.formatted()) bytes"
                )
                .font(HermesFonts.body(11))
                .foregroundStyle(appearance.palette.secondary)
                if !audit.reason.isEmpty {
                  Text(audit.reason)
                    .font(HermesFonts.body(11))
                    .foregroundStyle(appearance.palette.destructive)
                    .textSelection(.enabled)
                }
              }
              .padding(.vertical, 2)
            }
          }
        }
        if !data.changeSets.isEmpty {
          Section(chinese ? "运行变更" : "Run changes") {
            ForEach(data.changeSets) { changeSet in
              VStack(alignment: .leading, spacing: 5) {
                Text(changeSet.summary.isEmpty ? changeSet.id : changeSet.summary)
                  .font(HermesFonts.bodyBold(13))
                Text(
                  "+\(changeSet.addedCount)  ~\(changeSet.modifiedCount)  -\(changeSet.deletedCount)"
                  + "  ·  \(changeSet.fileCount) files  ·  \(changeSet.byteCount.formatted()) bytes"
                )
                .font(HermesFonts.mono(10))
                .foregroundStyle(appearance.palette.secondary)
              }
              .padding(.vertical, 2)
            }
          }
        }
        if let changeSet = data.selectedChangeSet {
          Section(chinese ? "最新 Workspace Diff" : "Latest Workspace Diff") {
            ForEach(changeSet.files) { file in
              DisclosureGroup {
                if file.patch.isEmpty {
                  Text(chinese ? "没有可显示的文本 Patch" : "No textual patch is available.")
                    .font(HermesFonts.body(11))
                    .foregroundStyle(appearance.palette.secondary)
                } else {
                  ScrollView(.horizontal) {
                    Text(file.patch)
                      .font(.system(size: 11, design: .monospaced))
                      .textSelection(.enabled)
                      .fixedSize(horizontal: true, vertical: false)
                  }
                }
              } label: {
                HStack(spacing: 9) {
                  HermesStatusPill(text: file.changeType)
                  VStack(alignment: .leading, spacing: 2) {
                    Text(file.path)
                      .font(HermesFonts.mono(10))
                      .lineLimit(2)
                    Text("\(file.byteCount.formatted()) bytes")
                      .font(HermesFonts.body(10))
                      .foregroundStyle(appearance.palette.secondary)
                  }
                }
              }
            }
          }
        }
      }
    }
    .hermesListStyle()
    .refreshable { onAction(.refresh, HermesRouteActionPayload(route: "workflows")) }
    .onAppear { applyWorkflowOperation(operation) }
    .onChange(of: operation) { next in applyWorkflowOperation(next) }
  }

  @ViewBuilder private func workflowStartButton(workflowId: String, title: String) -> some View {
    let pending = isWorkflowStartPending(workflowId)
    Button {
      startWorkflow(workflowId)
    } label: {
      if pending {
        HStack(spacing: 8) {
          ProgressView().controlSize(.small)
          Text(chinese ? "启动中…" : "Starting…")
        }
      } else {
        Label(title, systemImage: "play.fill")
      }
    }
    .disabled(pending)
  }

  private func isWorkflowStartPending(_ workflowId: String) -> Bool {
    locallyPendingWorkflowIds.contains(workflowId)
      || (
        operation?.action == HermesRouteAction.workflowStart.rawValue
          && operation?.state == "running"
          && operation?.targetId == workflowId
      )
  }

  private func startWorkflow(_ workflowId: String) {
    guard !isWorkflowStartPending(workflowId) else { return }
    let requestId = workflowRequestIds[workflowId]
      ?? "workflow-start-\(UUID().uuidString.lowercased())"
    workflowRequestIds[workflowId] = requestId
    locallyPendingWorkflowIds.insert(workflowId)
    onAction(
      .workflowStart,
      HermesRouteActionPayload(
        route: "workflows",
        id: workflowId,
        requestId: requestId
      )
    )
  }

  private func applyWorkflowOperation(_ next: HermesRouteOperationSnapshot?) {
    guard
      next?.action == HermesRouteAction.workflowStart.rawValue,
      let workflowId = next?.targetId
    else { return }
    if let requestId = next?.requestId, !requestId.isEmpty {
      workflowRequestIds[workflowId] = requestId
    }
    if next?.state == "running" {
      locallyPendingWorkflowIds.insert(workflowId)
      return
    }
    locallyPendingWorkflowIds.remove(workflowId)
    if next?.state == "success" {
      workflowRequestIds.removeValue(forKey: workflowId)
    }
  }
}

private struct HermesApprovalsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let data: HermesApprovalsSnapshot
  let chinese: Bool
  let onAction: HermesRouteActionSink

  var body: some View {
    List {
      if data.items.isEmpty {
        ContentUnavailableView(
          chinese ? "暂无待审批写入" : "No pending approvals",
          systemImage: "checkmark.shield"
        )
      } else {
        Section(chinese ? "待审批" : "Pending") {
          ForEach(data.items) { item in
            Button {
              onAction(.approvalSelect, HermesRouteActionPayload(route: "approvals", id: item.id))
            } label: {
              HStack(spacing: 12) {
                Image(systemName: item.subsystem == "skills" ? "shippingbox" : "brain.head.profile")
                  .foregroundStyle(appearance.palette.accent)
                VStack(alignment: .leading, spacing: 3) {
                  Text(item.title).font(HermesFonts.bodyBold(14))
                  Text(item.origin).font(HermesFonts.body(12)).foregroundStyle(appearance.palette.secondary)
                }
                Spacer()
                HermesStatusPill(text: item.state)
              }
            }.buttonStyle(.plain)
          }
        }
      }
      if let selected = data.selected {
        Section(chinese ? "变更内容" : "Changes") {
          if selected.diffAvailable {
            ScrollView(.horizontal) {
              Text(selected.diff)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
            }
          } else {
            Text(chinese ? "服务器未返回可展示的 Diff。" : "The server returned no displayable diff.")
              .foregroundStyle(appearance.palette.secondary)
          }
        }
        if selected.state == "pending" {
          Section {
          HStack {
            Button(role: .destructive) {
              decide(selected, action: .approvalReject)
            } label: { Label(chinese ? "拒绝" : "Reject", systemImage: "xmark") }
            Spacer()
            Button {
              decide(selected, action: .approvalApprove)
            } label: { Label(chinese ? "批准" : "Approve", systemImage: "checkmark") }
              .buttonStyle(.borderedProminent)
          }
          }
        }
      }
    }
    .hermesListStyle()
    .refreshable { onAction(.refresh, HermesRouteActionPayload(route: "approvals")) }
  }

  private func decide(_ item: HermesApprovalItemSnapshot, action: HermesRouteAction) {
    var fields = ["revision": String(item.revision)]
    if let payloadDigest = item.payloadDigest, !payloadDigest.isEmpty {
      fields["payloadDigest"] = payloadDigest
    }
    onAction(
      action,
      HermesRouteActionPayload(
        route: "approvals",
        id: item.id,
        requestId: "approval-\(UUID().uuidString.lowercased())",
        fields: fields
      )
    )
  }
}

private struct HermesRuntimeCenterPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let data: HermesRuntimeSnapshot
  let chinese: Bool
  let onAction: HermesRouteActionSink

  var body: some View {
    List {
      if data.runs.isEmpty {
        ContentUnavailableView(
          chinese ? "暂无运行记录" : "No runtime records",
          systemImage: "waveform.path.ecg"
        )
      } else {
        Section(chinese ? "真实运行" : "Authoritative runs") {
          ForEach(data.runs) { run in
            Button {
              onAction(.runtimeSelect, HermesRouteActionPayload(route: "runtime-center", id: run.id))
            } label: {
              HStack(spacing: 12) {
                Image(systemName: runtimeSymbol(run.kind)).foregroundStyle(appearance.palette.accent)
                VStack(alignment: .leading, spacing: 3) {
                  Text(run.title.isEmpty ? run.id : run.title).font(HermesFonts.bodyBold(14))
                  Text([run.kind, run.profile, run.detail].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(HermesFonts.body(12)).foregroundStyle(appearance.palette.secondary)
                }
                Spacer()
                HermesStatusPill(text: run.state)
              }
            }.buttonStyle(.plain)
          }
        }
      }
      if let run = data.selected {
        Section(chinese ? "运行详情" : "Run details") {
          LabeledContent(chinese ? "状态" : "State", value: run.state)
          LabeledContent(chinese ? "产物" : "Artifacts", value: String(run.artifactCount))
          if let error = run.error, !error.isEmpty {
            Text(error).font(HermesFonts.body(12)).foregroundStyle(appearance.palette.destructive).textSelection(.enabled)
          }
          HStack {
            if run.cancelable, let actionUrl = run.cancelUrl {
              Button(role: .destructive) {
                runtimeAction(.runtimeCancel, run: run, actionUrl: actionUrl)
              } label: { Label(chinese ? "取消" : "Cancel", systemImage: "stop.circle") }
            }
            if run.retryable, let actionUrl = run.retryUrl {
              Button {
                runtimeAction(.runtimeRetry, run: run, actionUrl: actionUrl)
              } label: { Label(chinese ? "重试" : "Retry", systemImage: "arrow.clockwise") }
            }
          }.buttonStyle(.bordered)
        }
      }
    }
    .hermesListStyle()
    .refreshable { onAction(.refresh, HermesRouteActionPayload(route: "runtime-center")) }
  }

  private func runtimeAction(_ action: HermesRouteAction, run: HermesRuntimeRunSnapshot, actionUrl: String) {
    onAction(
      action,
      HermesRouteActionPayload(
        route: "runtime-center",
        id: run.id,
        requestId: "runtime-\(UUID().uuidString.lowercased())",
        fields: ["actionUrl": actionUrl]
      )
    )
  }

  private func runtimeSymbol(_ kind: String) -> String {
    switch kind {
    case "hosted": return "icloud.and.arrow.up"
    case "delegation": return "person.2.wave.2"
    case "workflow": return "arrow.triangle.branch"
    default: return "message"
    }
  }
}

private enum HermesRemoteEditor: String, Identifiable {
  case collaboration
  case cron
  case mcp
  case webhooks
  case pairing
  case profiles
  case profileDescription
  case profileModel
  case botMeta
  case botProfileConfigure
  case botRelay
  case soul
  case skill
  case kanban
  case channel
  case config
  case plugin
  case environment
  case toolsetProvider
  case toolsetModel
  case toolsetEnvironment

  var id: String { rawValue }
}

private struct HermesMemoryPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let data: HermesMemorySnapshot
  let chinese: Bool
  let onAction: HermesRouteActionSink
  @State private var configProviderID = ""
  @State private var configDraft = ""

  var body: some View {
    HermesPage(subtitle: chinese ? "记忆 provider 与本地记忆文件" : "Memory providers and local memory files") {
      HermesPanel {
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            Label(chinese ? "当前 provider" : "Active provider", systemImage: "brain.head.profile")
            Spacer()
            Text(data.active.isEmpty ? (chinese ? "未设置" : "Not configured") : data.active)
              .font(HermesFonts.mono(12))
          }
          HStack {
            LabeledContent(chinese ? "MEMORY.md" : "MEMORY.md", value: ByteCountFormatter.string(fromByteCount: Int64(data.memoryBytes), countStyle: .file))
            LabeledContent(chinese ? "USER.md" : "USER.md", value: ByteCountFormatter.string(fromByteCount: Int64(data.userBytes), countStyle: .file))
          }
        }
      }
      if !data.providers.isEmpty {
        Section(chinese ? "Providers" : "Providers") {
          ForEach(data.providers) { provider in
            HStack(spacing: 10) {
              Button {
                onAction(.memoryProvider, HermesRouteActionPayload(route: "memory", id: provider.id))
              } label: {
                HStack(spacing: 10) {
                  Image(systemName: provider.active ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(provider.ready ? appearance.palette.success : appearance.palette.tertiary)
                  VStack(alignment: .leading, spacing: 3) {
                    Text(provider.label).font(HermesFonts.bodyBold(14))
                    if !provider.detail.isEmpty { Text(provider.detail).font(HermesFonts.body(11)).foregroundStyle(appearance.palette.secondary) }
                  }
                }
              }
              .buttonStyle(.plain)
              Spacer(minLength: 6)
              if provider.oauthAvailable == true && provider.oauthConnected != true {
                if provider.oauthState == "pending" {
                  ProgressView().controlSize(.small)
                    .accessibilityLabel(chinese ? "等待 OAuth 授权" : "Waiting for OAuth authorization")
                } else {
                  Button {
                    onAction(.memoryOAuthStart, HermesRouteActionPayload(route: "memory", id: provider.id))
                  } label: {
                    Label(chinese ? "连接" : "Connect", systemImage: "person.badge.key")
                  }
                  .buttonStyle(.borderedProminent)
                  .controlSize(.small)
                }
              } else if provider.oauthConnected == true {
                HermesStatusPill(text: chinese ? "已连接" : "Connected", color: appearance.palette.success)
              }
              HermesStatusPill(text: provider.status.isEmpty ? (provider.ready ? "ready" : "setup") : provider.status)
              if let configJSON = provider.configJSON, !configJSON.isEmpty {
                Button {
                  configProviderID = provider.id
                  configDraft = configJSON
                } label: {
                  Image(systemName: "gearshape")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(chinese ? "配置记忆 Provider" : "Configure memory provider")
              }
            }
          }
        }
      }
      HStack {
        Button(role: .destructive) {
          onAction(.memoryReset, HermesRouteActionPayload(route: "memory", value: "all"))
        } label: { Label(chinese ? "重置全部记忆" : "Reset all memory", systemImage: "trash") }
          .buttonStyle(.bordered)
        Button {
          onAction(.refresh, HermesRouteActionPayload(route: "memory"))
        } label: { Label(chinese ? "刷新" : "Refresh", systemImage: "arrow.clockwise") }
      }
    }
    .task(id: data.providers.map { "\($0.id):\($0.oauthState)" }.joined(separator: ",")) {
      guard data.providers.contains(where: { $0.oauthState == "pending" }) else { return }
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        guard !Task.isCancelled else { return }
        onAction(.refresh, HermesRouteActionPayload(route: "memory"))
      }
    }
    .sheet(isPresented: Binding(
      get: { !configProviderID.isEmpty },
      set: { if !$0 { configProviderID = "" } }
    )) {
      HermesMemoryConfigSheet(
        provider: configProviderID,
        chinese: chinese,
        draft: $configDraft,
        onCancel: { configProviderID = "" },
        onSave: {
          let id = configProviderID
          let json = configDraft
          configProviderID = ""
          onAction(.memoryConfigUpdate, HermesRouteActionPayload(route: "memory", id: id, detail: json))
        }
      )
    }
  }
}

private struct HermesMemoryConfigSheet: View {
  let provider: String
  let chinese: Bool
  @Binding var draft: String
  let onCancel: () -> Void
  let onSave: () -> Void

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text(chinese
            ? "这些字段来自 Hermes 官方 declared provider schema。保存时会通过 /api/memory/providers/<provider>/config 写回当前 Profile。"
            : "These fields come from Hermes' declared provider schema and are saved through the official provider config API for the active Profile.")
            .font(HermesFonts.body(12))
            .foregroundStyle(.secondary)
          TextEditor(text: $draft)
            .font(HermesFonts.mono(12))
            .frame(minHeight: 320)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        } header: {
          Text(provider)
        }
      }
      .navigationTitle(chinese ? "Provider 配置" : "Provider configuration")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(chinese ? "取消" : "Cancel", action: onCancel) }
        ToolbarItem(placement: .confirmationAction) { Button(chinese ? "保存" : "Save", action: onSave) }
      }
    }
    .presentationDetents([.large])
    .presentationDragIndicator(.visible)
  }
}

private struct HermesGitPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let data: HermesSwiftUIGitSnapshot?
  let chinese: Bool
  let onAction: HermesRouteActionSink
  @State private var commitMessage = ""
  @State private var branch = ""
  @State private var worktreeBranch = ""
  @State private var worktreeName = ""
  @State private var worktreeBase = ""
  @State private var removeWorktreePath = ""
  @State private var forceRemoveWorktree = false

  var body: some View {
    Group {
      if let data {
        List {
          Section(chinese ? "工作区" : "Workspace") {
            LabeledContent(chinese ? "路径" : "Path", value: data.root.isEmpty ? data.cwd : data.root)
            LabeledContent(chinese ? "分支" : "Branch", value: data.branch.isEmpty ? "—" : data.branch)
            HStack {
              Button {
                onAction(.gitRefresh, HermesRouteActionPayload(route: "git"))
              } label: {
                Label(chinese ? "刷新" : "Refresh", systemImage: "arrow.clockwise")
              }
              .buttonStyle(.bordered)
              Button {
                onAction(.gitPush, HermesRouteActionPayload(route: "git", fields: ["path": data.root]))
              } label: {
                Label(chinese ? "推送" : "Push", systemImage: "arrow.up.circle")
              }
              .buttonStyle(.borderedProminent)
              Button {
                onAction(.gitGhAuth, HermesRouteActionPayload(route: "git", fields: ["path": data.root]))
              } label: {
                Label(chinese ? "检查 GitHub" : "Check GitHub", systemImage: "person.crop.circle.badge.checkmark")
              }
              .buttonStyle(.bordered)
            }
            if !branchChoices.isEmpty {
              Picker(chinese ? "切换分支" : "Switch branch", selection: Binding(
                get: { branch.isEmpty ? data.branch : branch },
                set: { next in
                  branch = next
                  onAction(.gitSwitchBranch, HermesRouteActionPayload(route: "git", value: next, fields: ["path": data.root]))
                }
              )) {
                ForEach(branchChoices, id: \.self) { Text($0).tag($0) }
              }
            }
          }
          gitJSONSection(chinese ? "工作区状态" : "Status", data.statusJSON)
          if !gitFiles.isEmpty {
            Section(chinese ? "待审阅文件" : "Review files") {
              ForEach(gitFiles) { file in
                VStack(alignment: .leading, spacing: 6) {
                  Text(file.path).font(HermesFonts.mono(12))
                  if !file.detail.isEmpty {
                    Text(file.detail).font(HermesFonts.body(11)).foregroundStyle(appearance.palette.secondary)
                  }
                  HStack {
                    Button { onAction(.gitSelect, HermesRouteActionPayload(route: "git", id: file.path, fields: ["path": data.root])) } label: {
                      Label(chinese ? "查看差异" : "View diff", systemImage: "doc.text.magnifyingglass")
                    }
                    .buttonStyle(.bordered)
                    Button { onAction(.gitFileDiff, HermesRouteActionPayload(route: "git", id: file.path, fields: ["path": data.root])) } label: {
                      Label(chinese ? "文件 Diff" : "File diff", systemImage: "doc.plaintext")
                    }
                    .buttonStyle(.bordered)
                    Button { onAction(.gitStage, HermesRouteActionPayload(route: "git", id: file.path, fields: ["path": data.root])) } label: {
                      Label(chinese ? "暂存" : "Stage", systemImage: "plus.circle")
                    }
                    .buttonStyle(.bordered)
                    Button { onAction(.gitUnstage, HermesRouteActionPayload(route: "git", id: file.path, fields: ["path": data.root])) } label: {
                      Label(chinese ? "取消暂存" : "Unstage", systemImage: "minus.circle")
                    }
                    .buttonStyle(.bordered)
                    Button(role: .destructive) { onAction(.gitRevert, HermesRouteActionPayload(route: "git", id: file.path, fields: ["path": data.root])) } label: {
                      Label(chinese ? "还原" : "Revert", systemImage: "arrow.uturn.backward.circle")
                    }
                    .buttonStyle(.bordered)
                  }
                }
                .padding(.vertical, 4)
              }
            }
          } else {
            Text(chinese ? "没有待审阅文件" : "No files need review")
              .foregroundStyle(appearance.palette.secondary)
          }
          gitJSONSection(chinese ? "提交前检查" : "Ship checks", data.shipInfoJSON)
          Section(chinese ? "提交" : "Commit") {
            TextField(chinese ? "提交信息" : "Commit message", text: $commitMessage, axis: .vertical)
              .lineLimit(2...5)
            Button {
              let message = commitMessage.trimmingCharacters(in: .whitespacesAndNewlines)
              guard !message.isEmpty else { return }
              onAction(.gitCommit, HermesRouteActionPayload(route: "git", detail: message, fields: ["path": data.root]))
              commitMessage = ""
            } label: {
              Label(chinese ? "提交更改" : "Commit changes", systemImage: "checkmark.circle")
            }
            .buttonStyle(.borderedProminent)
            .disabled(commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
          Section(chinese ? "发布与工作树" : "Ship and worktrees") {
            Button {
              onAction(.gitCreatePR, HermesRouteActionPayload(route: "git", fields: ["path": data.root]))
            } label: {
              Label(chinese ? "创建或打开 Pull Request" : "Create or open Pull Request", systemImage: "arrow.triangle.pull")
            }
            .buttonStyle(.borderedProminent)

            TextField(chinese ? "工作树分支（必填）" : "Worktree branch (required)", text: $worktreeBranch)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
            TextField(chinese ? "工作树名称（可选）" : "Worktree name (optional)", text: $worktreeName)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
            TextField(chinese ? "基础分支（可选）" : "Base branch (optional)", text: $worktreeBase)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
            Button {
              let branchValue = worktreeBranch.trimmingCharacters(in: .whitespacesAndNewlines)
              guard !branchValue.isEmpty else { return }
              var options: [String: String] = ["branch": branchValue]
              let nameValue = worktreeName.trimmingCharacters(in: .whitespacesAndNewlines)
              let baseValue = worktreeBase.trimmingCharacters(in: .whitespacesAndNewlines)
              if !nameValue.isEmpty { options["name"] = nameValue }
              if !baseValue.isEmpty { options["base"] = baseValue }
              guard let encoded = try? JSONSerialization.data(withJSONObject: options, options: [.sortedKeys]),
                    let json = String(data: encoded, encoding: .utf8) else { return }
              onAction(.gitAddWorktree, HermesRouteActionPayload(route: "git", detail: json, fields: ["path": data.root]))
              worktreeBranch = ""
              worktreeName = ""
              worktreeBase = ""
            } label: {
              Label(chinese ? "创建工作树" : "Create worktree", systemImage: "plus.rectangle.on.folder")
            }
            .buttonStyle(.bordered)
            .disabled(worktreeBranch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            TextField(chinese ? "要移除的工作树路径" : "Worktree path to remove", text: $removeWorktreePath)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
            Toggle(chinese ? "强制移除（丢弃未提交更改）" : "Force remove (discard uncommitted changes)", isOn: $forceRemoveWorktree)
            Button(role: .destructive) {
              let path = removeWorktreePath.trimmingCharacters(in: .whitespacesAndNewlines)
              guard !path.isEmpty else { return }
              onAction(.gitRemoveWorktree, HermesRouteActionPayload(route: "git", id: path, enabled: forceRemoveWorktree, fields: ["path": data.root]))
              removeWorktreePath = ""
              forceRemoveWorktree = false
            } label: {
              Label(chinese ? "移除工作树" : "Remove worktree", systemImage: "trash")
            }
            .buttonStyle(.bordered)
            .disabled(removeWorktreePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
          if let selected = data.selectedFile, !selected.isEmpty, let diff = data.diffJSON, !diff.isEmpty {
            Section(chinese ? "差异 · \(selected)" : "Diff · \(selected)") {
              Text(diff)
                .font(HermesFonts.mono(10))
                .foregroundStyle(appearance.palette.secondary)
                .textSelection(.enabled)
            }
          }
          gitJSONSection(chinese ? "分支" : "Branches", data.branchesJSON)
          gitJSONSection(chinese ? "Worktree" : "Worktrees", data.worktreesJSON)
          gitJSONSection(chinese ? "基础分支" : "Base branches", data.baseBranchesJSON)
          gitJSONSection(chinese ? "GitHub 登录状态" : "GitHub auth", data.ghAuthJSON ?? "")
          gitJSONSection(chinese ? "提交上下文" : "Commit context", data.commitContextJSON ?? "")
          gitJSONSection(chinese ? "版本解析" : "Revision", data.revParseJSON ?? "")
          gitJSONSection(chinese ? "Pull Requests" : "Pull requests", data.pullRequestsJSON ?? "")
          gitJSONSection(chinese ? "文件 Diff" : "File diff", data.fileDiffJSON ?? "")
        }
        .hermesListStyle()
        .refreshable { onAction(.gitRefresh, HermesRouteActionPayload(route: "git")) }
      } else {
        ContentUnavailableView(
          chinese ? "Git 不可用" : "Git unavailable",
          systemImage: "arrow.triangle.branch",
          description: Text(chinese ? "当前 Hermes 工作区没有可用的 Git 仓库。" : "The current Hermes workspace has no usable Git repository.")
        )
      }
    }
    .background(appearance.palette.background)
  }

  private var gitFiles: [HermesGitFileSnapshot] {
    guard let data, let raw = data.reviewJSON.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: raw) else { return [] }
    let candidates: [[String: Any]]
    if let dict = object as? [String: Any], let files = dict["files"] as? [[String: Any]] {
      candidates = files
    } else if let dict = object as? [String: Any], let files = dict["items"] as? [[String: Any]] {
      candidates = files
    } else if let files = object as? [[String: Any]] {
      candidates = files
    } else {
      candidates = []
    }
    return candidates.compactMap { item in
      let path = (item["path"] as? String) ?? (item["file"] as? String) ?? (item["name"] as? String) ?? ""
      guard !path.isEmpty else { return nil }
      let status = (item["status"] as? String) ?? (item["change"] as? String) ?? ""
      return HermesGitFileSnapshot(path: path, detail: status)
    }
  }

  private var branchChoices: [String] {
    guard let data, let raw = data.branchesJSON.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: raw) else { return [] }
    if let values = object as? [String] { return values.filter { !$0.isEmpty } }
    if let dict = object as? [String: Any] {
      if let values = dict["branches"] as? [String] { return values.filter { !$0.isEmpty } }
      if let values = dict["items"] as? [[String: Any]] {
        return values.compactMap { ($0["name"] as? String) ?? ($0["branch"] as? String) }
      }
    }
    return []
  }

  @ViewBuilder
  private func gitJSONSection(_ title: String, _ value: String) -> some View {
    if !value.isEmpty {
      Section(title) {
        Text(value)
          .font(HermesFonts.mono(10))
          .foregroundStyle(appearance.palette.secondary)
          .textSelection(.enabled)
          .lineLimit(24)
      }
    }
  }
}

private struct HermesGitFileSnapshot: Identifiable {
  let path: String
  let detail: String
  var id: String { path }
}

private struct HermesKanbanBoardChoice: Identifiable, Hashable {
  let id: String
  let name: String
}

private struct HermesRemoteRoutePage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let route: HermesRoute
  let data: HermesRouteSnapshot
  let chinese: Bool
  let onAction: HermesRouteActionSink
  @State private var collaborationDraft = ""
  @State private var collaborationPendingRequestId = ""
  @State private var collaborationPendingRoomId = ""
  @State private var collaborationPendingText = ""
  @State private var editor: HermesRemoteEditor?
  @State private var editorID = ""
  @State private var editorName = ""
  @State private var editorValue = ""
  @State private var editorDetail = ""
  @State private var importingConfiguration = false
  @State private var importingBotAvatar = false
  @State private var avatarBotID = ""
  @State private var clearingBotAvatarID = ""
  @State private var requestedSkillID = ""
  @State private var rollbackInstallationID = ""
  @State private var showingToolsetConfig = false
  @State private var toolsetConfigName = ""
  @State private var toolsetConfigJSON = ""
  @State private var toolsetModelsJSON = ""
  @State private var toolsetProvidersJSON = ""
  @State private var showingToolsetSchema = false
  @State private var editingToolsetID = ""
  @State private var editingToolsetConfigJSON = ""
  @State private var showingMcpMapEditor = false
  @State private var mcpMapJSON = ""
  @State private var skillHubQuery = ""
  @State private var skillHubIdentifier = ""
  @State private var cronBlueprintValues = "{}"
  @State private var importingBackup = false
  @State private var editingHook = false
  @State private var hookJSON = "{}"
  @State private var hookEvent = "on_session_end"
  @State private var hookCommand = ""
  @State private var hookMatcher = ""
  @State private var hookTimeout = "30"
  @State private var hookApprove = false
  @State private var hookDeleteEvent = ""
  @State private var hookDeleteCommand = ""
  @State private var routineEditorProfile = ""
  @State private var onboardingChannel = "telegram"
  @State private var onboardingTelegramIDs = ""
  @State private var onboardingWhatsappMode = "pairing"
  @State private var onboardingWhatsappUsers = ""
  @State private var selectedKanbanCard: HermesKanbanCardSnapshot?

  var body: some View {
    routeBody
      .toolbar {
        if let editorKind {
          ToolbarItem(placement: .navigationBarTrailing) {
            Button {
              prepareEditor(editorKind)
            } label: {
              Image(systemName: editorKind == .config ? "square.and.pencil" : "plus")
            }
            .accessibilityLabel(chinese ? "新增或编辑" : "Add or edit")
          }
        }
      }
      .sheet(item: $editor) { kind in
        HermesRemoteEditorSheet(
          kind: kind,
          chinese: chinese,
          isCreating: editorID.isEmpty,
          name: $editorName,
          value: $editorValue,
          detail: $editorDetail,
          kanbanColumns: data.kanban,
          onCancel: { editor = nil },
          onSave: { saveEditor(kind) }
        )
        .environmentObject(appearance)
      }
      .fileImporter(
        isPresented: $importingBotAvatar,
        allowedContentTypes: [.image],
        allowsMultipleSelection: false
      ) { result in
        guard route == .bots,
              case let .success(urls) = result,
              let url = urls.first,
              !avatarBotID.isEmpty else { return }
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        guard let bytes = try? Data(contentsOf: url), !bytes.isEmpty, bytes.count <= 2_000_000 else { return }
        let ext = url.pathExtension.lowercased()
        let mime = ext == "png" ? "image/png" : ext == "webp" ? "image/webp" : "image/jpeg"
        let dataURL = "data:\(mime);base64,\(bytes.base64EncodedString())"
        onAction(.botAvatarUpload, HermesRouteActionPayload(route: "bots", id: avatarBotID, detail: dataURL))
        avatarBotID = ""
      }
      .sheet(isPresented: $showingToolsetConfig) {
        NavigationStack {
          Form {
            Section(chinese ? "上游工具集配置" : "Upstream toolset configuration") {
              Text(toolsetConfigName)
                .font(HermesFonts.bodyBold(15))
              Text(chinese
                ? "此内容来自 Hermes 官方 ToolsetConfig 接口。可在桌面端同一配置面板中修改凭据；iOS 展示经过脱敏的声明式配置，避免在日志或 URL 中泄露密钥。"
                : "Loaded from Hermes' official ToolsetConfig endpoint. Edit credentials in the same upstream configuration panel; iOS renders the declared, redacted schema without putting secrets in logs or URLs.")
                .font(HermesFonts.body(12))
                .foregroundStyle(appearance.palette.secondary)
              ScrollView(.horizontal) {
                Text(toolsetConfigJSON)
                  .font(HermesFonts.mono(11))
                  .textSelection(.enabled)
                  .frame(maxWidth: .infinity, alignment: .leading)
              }
              if !toolsetModelsJSON.isEmpty {
                Text(chinese ? "官方模型目录" : "Official model catalog")
                  .font(HermesFonts.bodyBold(12))
                Text(toolsetModelsJSON)
                  .font(HermesFonts.mono(10))
                  .textSelection(.enabled)
              }
              if !toolsetProvidersJSON.isEmpty {
                Text(chinese ? "官方 Provider 目录" : "Official provider catalog")
                  .font(HermesFonts.bodyBold(12))
                Text(toolsetProvidersJSON)
                  .font(HermesFonts.mono(10))
                  .textSelection(.enabled)
              }
            }
          }
          .scrollContentBackground(.hidden)
          .background(appearance.palette.background)
          .navigationTitle(chinese ? "工具集详情" : "Toolset details")
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .confirmationAction) {
              Button(chinese ? "完成" : "Done") { showingToolsetConfig = false }
            }
          }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
      }
      .sheet(isPresented: $showingToolsetSchema) {
        HermesToolsetSchemaSheet(
          chinese: chinese,
          toolsetName: toolsetConfigName,
          configJSON: editingToolsetConfigJSON,
          onCancel: { showingToolsetSchema = false },
          onSave: { json in
            onAction(.toolsetEnvironment, HermesRouteActionPayload(route: "skills", id: editingToolsetID, detail: json))
            showingToolsetSchema = false
          }
        )
        .environmentObject(appearance)
      }
      .sheet(isPresented: $showingMcpMapEditor) {
        NavigationStack {
          Form {
            Section(chinese ? "完整 MCP 配置" : "Complete MCP configuration") {
              TextEditor(text: $mcpMapJSON)
                .font(HermesFonts.mono(11))
                .frame(minHeight: 320)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }
          }
          .scrollContentBackground(.hidden)
          .background(appearance.palette.background)
          .navigationTitle("mcp.json")
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button(chinese ? "取消" : "Cancel") { showingMcpMapEditor = false }
            }
            ToolbarItem(placement: .confirmationAction) {
              Button(chinese ? "保存" : "Save") {
                onAction(.mcpReplace, HermesRouteActionPayload(route: "mcp", detail: mcpMapJSON))
                showingMcpMapEditor = false
              }
              .disabled(mcpMapJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
          }
        }
        .presentationDetents([.large])
      }
      .sheet(item: $selectedKanbanCard) { card in
        HermesKanbanTaskDetailSheet(
          card: card,
          detailJSON: data.kanbanDetailJSON,
          profileChoices: kanbanProfileChoices,
          board: kanbanCurrentBoard,
          chinese: chinese,
          onAction: onAction,
          onNavigate: { target in
            selectedKanbanCard = target
            onAction(
              .kanbanTaskOpen,
              HermesRouteActionPayload(
                route: "kanban",
                id: target.id,
                fields: kanbanCurrentBoard.map { ["board": $0] }
              )
            )
          },
          onDismiss: { selectedKanbanCard = nil }
        )
        .environmentObject(appearance)
      }
      .sheet(isPresented: $editingHook) {
        NavigationStack {
          Form {
            Section(chinese ? "Hook 字段" : "Hook fields") {
              TextField(chinese ? "事件" : "Event", text: $hookEvent).textInputAutocapitalization(.never).autocorrectionDisabled()
              TextField(chinese ? "命令路径" : "Command path", text: $hookCommand).textInputAutocapitalization(.never).autocorrectionDisabled()
              TextField(chinese ? "匹配器（可选）" : "Matcher (optional)", text: $hookMatcher).textInputAutocapitalization(.never).autocorrectionDisabled()
              TextField(chinese ? "超时秒数" : "Timeout seconds", text: $hookTimeout).keyboardType(.numberPad)
              Toggle(chinese ? "同时批准执行" : "Approve execution", isOn: $hookApprove)
            }
            Section(chinese ? "官方 Hook JSON" : "Official hook JSON") {
              TextEditor(text: $hookJSON)
                .font(HermesFonts.mono(11))
                .frame(minHeight: 180)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }
          }
          .navigationTitle(chinese ? "新增 Hook" : "Create hook")
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button(chinese ? "取消" : "Cancel") { editingHook = false }
            }
            ToolbarItem(placement: .confirmationAction) {
              Button(chinese ? "保存" : "Save") {
                var values: [String: Any] = ["event": hookEvent, "command": hookCommand, "approve": hookApprove]
                if !hookMatcher.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { values["matcher"] = hookMatcher }
                if let timeout = Int(hookTimeout), timeout > 0 { values["timeout"] = timeout }
                let payloadJSON = (try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])).flatMap { String(data: $0, encoding: .utf8) } ?? hookJSON
                onAction(.systemHookCreate, HermesRouteActionPayload(route: "system", detail: payloadJSON))
                editingHook = false
              }
              .disabled(hookEvent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hookCommand.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
          }
        }
        .presentationDetents([.medium, .large])
      }
      .fileImporter(
        isPresented: $importingBackup,
        allowedContentTypes: [.data, .archive, .zip],
        allowsMultipleSelection: false
      ) { result in
        guard case let .success(urls) = result, let url = urls.first else { return }
        DispatchQueue.global(qos: .userInitiated).async {
          let staged = HermesFileImportStaging.stage([url])
          guard let stagedURL = staged.first else { return }
          DispatchQueue.main.async {
            onAction(.systemBackupImport, HermesRouteActionPayload(
              route: "system",
              name: url.lastPathComponent,
              fields: ["mimeType": "application/zip", "stagedImport": "true"],
              uris: [stagedURL.absoluteString]
            ))
          }
        }
      }
      .onChange(of: data.skills) { _, skills in
        guard !requestedSkillID.isEmpty,
              let skill = skills.first(where: { $0.id == requestedSkillID }),
              let content = skill.content else { return }
        editorID = skill.id
        editorName = skill.name
        editorValue = ""
        editorDetail = content
        requestedSkillID = ""
        editor = .skill
      }
      .confirmationDialog(
        chinese ? "确认回滚此资源？" : "Roll back this resource?",
        isPresented: Binding(
          get: { !rollbackInstallationID.isEmpty },
          set: { if !$0 { rollbackInstallationID = "" } }
        ),
        titleVisibility: .visible
      ) {
        Button(chinese ? "回滚" : "Roll Back", role: .destructive) {
          let operationID = rollbackInstallationID
          rollbackInstallationID = ""
          onAction(
            .installationRollback,
            HermesRouteActionPayload(route: route.rawValue, id: operationID)
          )
        }
        Button(chinese ? "取消" : "Cancel", role: .cancel) {
          rollbackInstallationID = ""
        }
      }
      .confirmationDialog(
        chinese ? "清除此机器人的头像？" : "Clear this bot's avatar?",
        isPresented: Binding(
          get: { !clearingBotAvatarID.isEmpty },
          set: { if !$0 { clearingBotAvatarID = "" } }
        ),
        titleVisibility: .visible
      ) {
        Button(chinese ? "清除头像" : "Clear Avatar", role: .destructive) {
          let botID = clearingBotAvatarID
          clearingBotAvatarID = ""
          onAction(.botAvatarClear, HermesRouteActionPayload(route: "bots", id: botID))
        }
        Button(chinese ? "取消" : "Cancel", role: .cancel) {
          clearingBotAvatarID = ""
        }
      }
  }

  @ViewBuilder private var routeBody: some View {
    switch route {
    case .cron:
      cronRouteBody
    case .skills:
      skillsRouteBody
    case .plugins, .mcp, .channels, .webhooks:
      integrationsRouteBody
    case .pairing:
      pairingRouteBody
    case .achievements:
      achievementsRouteBody
    case .collaboration:
      collaborationRouteBody
    case .kanban:
      kanbanRoutePage
    case .profiles, .bots:
      profilesRouteBody
    case .config:
      configRouteBody
    case .env:
      environmentRouteBody
    case .system:
      systemRouteBody
    default:
      EmptyView()
    }
  }

  private var cronRouteBody: some View {
      List {
        if let catalog = data.cronBlueprintsJSON, !catalog.isEmpty {
          Section(chinese ? "官方自动化蓝图" : "Official automation blueprints") {
            Text(catalog)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.secondary)
              .textSelection(.enabled)
              .lineLimit(6)
            ForEach(cronBlueprintKeys, id: \.self) { key in
              VStack(alignment: .leading, spacing: 5) {
                Text(key).font(HermesFonts.bodyBold(13))
                TextEditor(text: $cronBlueprintValues)
                  .font(HermesFonts.mono(10)).frame(minHeight: 55)
                  .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button {
                  onAction(.cronBlueprintCreate, HermesRouteActionPayload(route: "cron", id: key, fields: ["values": cronBlueprintValues]))
                } label: {
                  Label(chinese ? "从此蓝图创建" : "Create from blueprint", systemImage: "wand.and.stars")
                }
              }
            }
          }
        }
        if let targets = data.cronDeliveryTargetsJSON, !targets.isEmpty {
          Section(chinese ? "投递目标" : "Delivery targets") {
            Text(targets)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.secondary)
              .textSelection(.enabled)
              .lineLimit(4)
          }
        }
        if let runs = data.cronRunsJSON, !runs.isEmpty {
          Section(chinese ? "运行历史" : "Run history") {
            Text(runs)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.secondary)
              .textSelection(.enabled)
              .lineLimit(14)
          }
        }
        ForEach(data.cron) { job in
        HermesRemoteRow(icon: job.enabled ? "clock.arrow.circlepath" : "pause.circle", title: job.name, detail: "\(job.schedule) · \(job.lastRun)", tint: job.enabled ? appearance.palette.accent : appearance.palette.tertiary) {
          Button {
            onAction(.cronToggle, HermesRouteActionPayload(route: "cron", id: job.id, enabled: !job.enabled))
          } label: {
            Image(systemName: job.enabled ? "pause.fill" : "play.fill")
          }
          .buttonStyle(.borderless)
        }
        .contextMenu {
          Button {
            editorID = job.id
            editorName = job.name
            editorValue = job.schedule
            editorDetail = job.prompt
            routineEditorProfile = ""
            editor = .cron
          } label: {
            Label(chinese ? "编辑定时任务" : "Edit scheduled job", systemImage: "square.and.pencil")
          }
          Button {
            onAction(.cronRun, HermesRouteActionPayload(route: "cron", id: job.id))
          } label: {
            Label(chinese ? "立即运行" : "Run now", systemImage: "play.fill")
          }
        }
        .swipeActions {
          Button {
            onAction(.cronRun, HermesRouteActionPayload(route: "cron", id: job.id))
          } label: { Label(chinese ? "立即运行" : "Run now", systemImage: "play.fill") }
          Button(role: .destructive) {
            onAction(.cronDelete, HermesRouteActionPayload(route: "cron", id: job.id))
          } label: { Label(chinese ? "删除" : "Delete", systemImage: "trash") }
        }
      }
      }
      .hermesListStyle()
      .refreshable { onAction(.refresh, HermesRouteActionPayload(route: "cron")) }
  }

  private var skillsRouteBody: some View {
      List {
        installationSection
        if let sources = data.skillHubSourcesJSON, !sources.isEmpty {
          Section(chinese ? "SkillHub 来源" : "SkillHub sources") {
            Text(sources)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.secondary)
              .textSelection(.enabled)
              .lineLimit(6)
            Button {
              onAction(.skillHubUpdate, HermesRouteActionPayload(route: "skills"))
            } label: {
              Label(chinese ? "更新 SkillHub" : "Update SkillHub", systemImage: "arrow.clockwise")
            }
          }
        }
        if let graph = data.learningGraphJSON, !graph.isEmpty {
          Section(chinese ? "Learning 图谱" : "Learning graph") {
            Text(graph)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.secondary)
              .textSelection(.enabled)
              .lineLimit(8)
            Button {
              onAction(.learningGraphRefresh, HermesRouteActionPayload(route: "skills"))
            } label: {
              Label(chinese ? "刷新学习图谱" : "Refresh learning graph", systemImage: "arrow.clockwise")
            }
          }
        }
        if let result = data.skillHubResultJSON, !result.isEmpty {
          Section(chinese ? "SkillHub 结果" : "SkillHub result") {
            Text(result)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.secondary)
              .textSelection(.enabled)
              .lineLimit(12)
          }
        }
        Section(chinese ? "SkillHub 浏览与安装" : "Browse and install from SkillHub") {
          TextField(chinese ? "搜索关键词" : "Search query", text: $skillHubQuery)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          TextField(chinese ? "标识符（预览/扫描/安装）" : "Identifier (preview / scan / install)", text: $skillHubIdentifier)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          HStack {
            Button {
              onAction(.skillHubSearch, HermesRouteActionPayload(route: "skills", value: skillHubQuery, fields: ["source": "all", "limit": "20"]))
            } label: { Label(chinese ? "搜索" : "Search", systemImage: "magnifyingglass") }
            .buttonStyle(.bordered)
            Button {
              onAction(.skillHubPreview, HermesRouteActionPayload(route: "skills", value: skillHubIdentifier))
            } label: { Label(chinese ? "预览" : "Preview", systemImage: "doc.text.magnifyingglass") }
            .buttonStyle(.bordered)
            Button {
              onAction(.skillHubScan, HermesRouteActionPayload(route: "skills", value: skillHubIdentifier))
            } label: { Label(chinese ? "扫描" : "Scan", systemImage: "checkmark.shield") }
            .buttonStyle(.bordered)
          }
          Button {
            onAction(.skillHubInstall, HermesRouteActionPayload(route: "skills", value: skillHubIdentifier))
          } label: { Label(chinese ? "安装 Skill" : "Install Skill", systemImage: "arrow.down.circle") }
          .buttonStyle(.borderedProminent)
          .disabled(skillHubIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        Section(chinese ? "已安装 Skill" : "Installed Skills") {
          ForEach(data.skills) { skill in
            HermesRemoteRow(icon: skill.bundled ? "shippingbox.fill" : "shippingbox", title: skill.name, detail: skill.detail, tint: appearance.palette.accent) {
              Toggle("", isOn: Binding(
                get: { skill.enabled },
                set: { onAction(.skillToggle, HermesRouteActionPayload(route: "skills", id: skill.id, enabled: $0)) }
              )).labelsHidden()
            }
            .contextMenu {
              Button {
                requestedSkillID = skill.id
                onAction(.skillSelect, HermesRouteActionPayload(route: "skills", id: skill.id))
              } label: {
                Label(chinese ? "编辑 SKILL.md" : "Edit SKILL.md", systemImage: "square.and.pencil")
              }
              Button { onAction(.skillView, HermesRouteActionPayload(route: "skills", id: skill.id)) } label: {
                Label(chinese ? "查看 SKILL.md" : "View SKILL.md", systemImage: "doc.text")
              }
              if !skill.bundled {
                Button(role: .destructive) {
                  onAction(.skillHubUninstall, HermesRouteActionPayload(route: "skills", value: skill.id))
                } label: {
                  Label(chinese ? "从 SkillHub 卸载" : "Uninstall from SkillHub", systemImage: "trash")
                }
              }
            }
          }
        }
        if !data.toolsets.isEmpty {
          Section(chinese ? "工具集" : "Toolsets") {
            ForEach(data.toolsets) { toolset in
              HermesRemoteRow(
                icon: toolset.enabled ? "wrench.and.screwdriver.fill" : "wrench.and.screwdriver",
                title: toolset.name,
                detail: toolset.detail.isEmpty
                  ? "\(toolset.tools.count) \(chinese ? "个工具" : "tools")"
                  : "\(toolset.detail) · \(toolset.tools.count) \(chinese ? "个工具" : "tools")",
                tint: toolset.enabled ? appearance.palette.accent : appearance.palette.tertiary
              ) {
                Toggle("", isOn: Binding(
                  get: { toolset.enabled },
                  set: { onAction(.toolsetToggle, HermesRouteActionPayload(route: "skills", id: toolset.id, enabled: $0)) }
                )).labelsHidden()
              }
              .contextMenu {
                Text(toolset.configured
                  ? (chinese ? "已配置" : "Configured")
                  : (chinese ? "需要配置凭据" : "Credentials required"))
                if !toolset.tools.isEmpty {
                  Text(toolset.tools.joined(separator: ", "))
                }
                if let config = toolset.configJSON, !config.isEmpty {
                  Button {
                    toolsetConfigName = toolset.name
                    toolsetConfigJSON = config
                    toolsetModelsJSON = toolset.modelsJSON ?? ""
                    toolsetProvidersJSON = toolset.providersJSON ?? ""
                    showingToolsetConfig = true
                  } label: {
                    Label(chinese ? "查看官方配置" : "View official configuration", systemImage: "doc.text.magnifyingglass")
                  }
                  Button {
                    toolsetConfigName = toolset.name
                    editingToolsetID = toolset.id
                    editingToolsetConfigJSON = config
                    showingToolsetSchema = true
                  } label: {
                    Label(chinese ? "使用声明式表单配置" : "Configure with schema form", systemImage: "list.bullet.rectangle")
                  }
                }
                Button {
                  onAction(.toolsetPostSetup, HermesRouteActionPayload(route: "skills", id: toolset.id, value: toolset.id))
                } label: {
                  Label(chinese ? "运行官方 Setup" : "Run official setup", systemImage: "terminal")
                }
                Button {
                  editorID = toolset.id; editorName = toolset.name; editorValue = ""; editorDetail = ""; editor = .toolsetProvider
                } label: { Label(chinese ? "选择 Provider" : "Select provider", systemImage: "slider.horizontal.3") }
                Button {
                  editorID = toolset.id; editorName = toolset.name; editorValue = ""; editorDetail = ""; editor = .toolsetModel
                } label: { Label(chinese ? "选择模型" : "Select model", systemImage: "cpu") }
                Button {
                  editorID = toolset.id; editorName = toolset.name; editorValue = "{}"; editorDetail = ""; editor = .toolsetEnvironment
                } label: { Label(chinese ? "编辑环境 JSON" : "Edit environment JSON", systemImage: "key") }
              }
            }
          }
        }
        if let terminal = data.terminalBackendsJSON, !terminal.isEmpty {
          Section(chinese ? "Terminal 后端" : "Terminal backends") {
            Text(terminal).font(HermesFonts.mono(10)).foregroundStyle(appearance.palette.secondary).textSelection(.enabled).lineLimit(4)
            ForEach(terminalBackendKeys, id: \.self) { backend in
              Button {
                onAction(.terminalBackend, HermesRouteActionPayload(route: "skills", value: backend))
              } label: { Label(chinese ? "使用 \(backend)" : "Use \(backend)", systemImage: "terminal") }
            }
          }
        }
        if let computer = data.computerUseJSON, !computer.isEmpty {
          Section(chinese ? "Computer Use" : "Computer Use") {
            Text(computer).font(HermesFonts.mono(10)).foregroundStyle(appearance.palette.secondary).textSelection(.enabled).lineLimit(4)
            Button {
              onAction(.computerUseGrant, HermesRouteActionPayload(route: "skills"))
            } label: { Label(chinese ? "授予 Computer Use 权限" : "Grant Computer Use permissions", systemImage: "lock.open") }
          }
        }
      }
      .hermesListStyle()
      .refreshable { onAction(.refresh, HermesRouteActionPayload(route: "skills")) }
  }

  private var integrationsRouteBody: some View {
      List {
        if route == .channels {
          channelOnboardingSection
        }
        if route == .mcp {
          if let document = data.mcpServersJSON, !document.isEmpty {
            Section(chinese ? "配置" : "Configuration") {
              Button {
                mcpMapJSON = document
                showingMcpMapEditor = true
              } label: {
                Label(chinese ? "编辑完整 mcp.json" : "Edit complete mcp.json", systemImage: "curlybraces.square")
              }
            }
          }
          installationSection
        }
        ForEach(data.integrations) { item in
          HermesRemoteRow(icon: route == .plugins ? "puzzlepiece.extension" : route == .mcp ? "point.3.connected.trianglepath.dotted" : route == .channels ? "dot.radiowaves.left.and.right" : "arrow.triangle.branch", title: item.name, detail: item.detail, tint: item.enabled ? appearance.palette.accent : appearance.palette.tertiary) {
            if route == .mcp && item.catalogEntry == true {
              Button {
                onAction(.integrationCreate, HermesRouteActionPayload(
                  route: "mcp",
                  name: item.name,
                  fields: [
                    "catalogName": item.id,
                    "enable": "true",
                  ]
                ))
              } label: {
                Label(chinese ? "安装" : "Install", systemImage: "arrow.down.circle")
              }
              .buttonStyle(.borderedProminent)
              .disabled(item.catalogNeedsInstall == true && !(item.catalogRequiredEnv ?? []).isEmpty)
            } else {
              Toggle("", isOn: Binding(
                get: { item.enabled },
                set: { onAction(.integrationToggle, HermesRouteActionPayload(route: route.rawValue, id: item.id, enabled: $0)) }
              )).labelsHidden()
            }
          }
          .swipeActions {
            if route == .plugins && item.canRemove == true {
              Button(role: .destructive) {
                onAction(.pluginDelete, HermesRouteActionPayload(route: "plugins", id: item.id))
              } label: { Label(chinese ? "卸载" : "Remove", systemImage: "trash") }
            }
            if (route == .mcp || route == .webhooks) && item.catalogEntry != true {
              Button(role: .destructive) {
                onAction(.integrationDelete, HermesRouteActionPayload(route: route.rawValue, id: item.id))
              } label: { Label(chinese ? "删除" : "Delete", systemImage: "trash") }
            }
            if route == .mcp && item.catalogEntry != true && item.canTest == true {
              Button {
                onAction(.mcpTest, HermesRouteActionPayload(route: "mcp", id: item.id))
              } label: {
                Label(chinese ? "测试连接" : "Test connection", systemImage: "bolt")
              }
            }
            if route == .mcp && item.catalogEntry != true {
              Button {
                onAction(.mcpAuth, HermesRouteActionPayload(route: "mcp", id: item.id))
              } label: {
                Label(chinese ? "启动 OAuth" : "Start OAuth", systemImage: "person.badge.key")
              }
            }
            if route == .channels && item.canTest == true {
              Button {
                onAction(.integrationTest, HermesRouteActionPayload(route: "channels", id: item.id))
              } label: {
                Label(chinese ? "测试渠道" : "Test channel", systemImage: "bolt")
              }
            }
          }
          .contextMenu {
            if route == .plugins {
              if item.canUpdate == true {
                Button {
                  onAction(.pluginUpdate, HermesRouteActionPayload(route: "plugins", id: item.id))
                } label: {
                  Label(chinese ? "更新插件" : "Update plugin", systemImage: "arrow.down.circle")
                }
              }
              Button {
                onAction(
                  .pluginVisibility,
                  HermesRouteActionPayload(
                    route: "plugins",
                    id: item.id,
                    enabled: item.userHidden != true
                  )
                )
              } label: {
                Label(
                  item.userHidden == true
                    ? (chinese ? "显示在侧边栏" : "Show in sidebar")
                    : (chinese ? "从侧边栏隐藏" : "Hide from sidebar"),
                  systemImage: item.userHidden == true ? "eye" : "eye.slash"
                )
              }
              if item.canRemove == true {
                Button(role: .destructive) {
                  onAction(.pluginDelete, HermesRouteActionPayload(route: "plugins", id: item.id))
                } label: {
                  Label(chinese ? "卸载插件" : "Remove plugin", systemImage: "trash")
                }
              }
            }
            if route == .channels {
              Button {
                editorID = item.id
                editorName = item.name
                editorValue = ""
                editorDetail = item.configuration ?? "{}"
                editor = .channel
              } label: {
                Label(chinese ? "编辑渠道配置" : "Edit channel configuration", systemImage: "gearshape")
              }
            }
          }
        }
      }
      .hermesListStyle()
      .task(id: "\(activeOnboardingChannel):\(onboardingPairingID):\(onboardingStatus)") {
        guard route == .channels,
              !onboardingPairingID.isEmpty,
              !onboardingStatusIsTerminal else { return }
        while !Task.isCancelled {
          try? await Task.sleep(nanoseconds: 2_000_000_000)
          guard !Task.isCancelled else { return }
          onAction(
            .channelOnboardingRefresh,
            HermesRouteActionPayload(
              route: "channels",
              id: activeOnboardingChannel,
              value: onboardingPairingID
            )
          )
        }
      }
      .toolbar {
        if route == .plugins {
          ToolbarItem(placement: .navigationBarLeading) {
            Button {
              onAction(.pluginRescan, HermesRouteActionPayload(route: "plugins"))
            } label: {
              Image(systemName: "arrow.triangle.2.circlepath")
            }
            .accessibilityLabel(chinese ? "重新扫描插件" : "Rescan plugins")
          }
        }
        if route == .webhooks {
          ToolbarItem(placement: .navigationBarLeading) {
            Button {
              onAction(.webhooksEnable, HermesRouteActionPayload(route: "webhooks"))
            } label: {
              Label(chinese ? "启用 Webhook" : "Enable webhooks", systemImage: "bolt.horizontal.circle")
            }
            .accessibilityLabel(chinese ? "启用 Webhook 服务" : "Enable webhook service")
          }
        }
      }
      .refreshable { onAction(.refresh, HermesRouteActionPayload(route: route.rawValue)) }
  }

  private var pairingRouteBody: some View {
      List {
        Section(chinese ? "待批准" : "Pending") {
          if data.pairing.pending.isEmpty {
            Text(chinese ? "暂无待批准的用户" : "No pending users")
              .foregroundStyle(appearance.palette.secondary)
          }
          ForEach(data.pairing.pending) { item in
            HermesRemoteRow(
              icon: "person.badge.clock",
              title: item.platform,
              detail: item.detail,
              tint: appearance.palette.warning
            ) {
              if let requestId = item.requestId, !requestId.isEmpty {
                Button {
                  onAction(
                    .pairingApprove,
                    HermesRouteActionPayload(
                      route: "pairing",
                      id: item.platform,
                      value: requestId
                    )
                  )
                } label: {
                  Label(chinese ? "批准" : "Approve", systemImage: "checkmark.circle")
                }
              }
            }
          }
          if !data.pairing.pending.isEmpty {
            Button(role: .destructive) {
              onAction(.pairingClearPending, HermesRouteActionPayload(route: "pairing"))
            } label: {
              Label(chinese ? "清空待批准请求" : "Clear pending requests", systemImage: "trash")
            }
          }
        }
        Section(chinese ? "已批准" : "Approved") {
          if data.pairing.approved.isEmpty {
            Text(chinese ? "暂无已批准的用户" : "No approved users")
              .foregroundStyle(appearance.palette.secondary)
          }
          ForEach(data.pairing.approved) { item in
            HermesRemoteRow(
              icon: "person.crop.circle.badge.checkmark",
              title: item.platform,
              detail: item.detail,
              tint: appearance.palette.success
            ) { EmptyView() }
            .swipeActions {
              Button(role: .destructive) {
                onAction(
                  .pairingRevoke,
                  HermesRouteActionPayload(
                    route: "pairing",
                    id: item.platform,
                    value: item.userId
                  )
                )
              } label: { Label(chinese ? "撤销" : "Revoke", systemImage: "person.crop.circle.badge.minus") }
            }
          }
        }
      }
      .hermesListStyle()
      .refreshable { onAction(.refresh, HermesRouteActionPayload(route: "pairing")) }
  }

  private var achievementsRouteBody: some View {
      HermesPage(subtitle: chinese ? "Hermes 使用进度与里程碑" : "Hermes usage progress and milestones") {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
          GridRow {
            HermesMetric(title: chinese ? "已完成任务" : "Tasks completed", value: data.achievements.tasksCompleted, symbol: "checkmark.seal", tint: appearance.palette.success)
            HermesMetric(title: chinese ? "连续使用" : "Day streak", value: data.achievements.dayStreak, symbol: "flame", tint: appearance.palette.warning)
          }
        }
        ForEach(data.achievements.items) { item in
          HermesPanel {
            VStack(alignment: .leading, spacing: 8) {
              Label(item.title, systemImage: item.symbol).font(HermesFonts.bodyBold(15))
              Text(item.detail).font(HermesFonts.body(12)).foregroundStyle(appearance.palette.secondary)
              ProgressView(value: item.progress).tint(appearance.palette.accent)
            }
          }
        }
        if !data.achievements.shareText.isEmpty {
          ShareLink(item: data.achievements.shareText) {
            Label(chinese ? "分享成就" : "Share achievements", systemImage: "square.and.arrow.up")
          }.buttonStyle(HermesPrimaryButtonStyle())
        }
        Button {
          onAction(.achievementsRescan, HermesRouteActionPayload(route: "achievements"))
        } label: {
          Label(chinese ? "重新扫描成就" : "Rescan achievements", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
      }
  }

  private var collaborationRouteBody: some View {
      VStack(spacing: 0) {
        if data.collaboration.rooms.isEmpty {
          ContentUnavailableView(
            chinese ? "暂无协作房间" : "No collaboration rooms",
            systemImage: "person.3",
            description: Text(chinese ? "点击右上角添加真实 Hermes 协作房间。" : "Add a Hermes collaboration room from the toolbar.")
          )
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          List(data.collaboration.rooms) { room in
            Button {
              onAction(.collaborationSelect, HermesRouteActionPayload(route: "collaboration", id: room.id))
            } label: {
              Label(room.name, systemImage: room.id == data.collaboration.selectedRoomId ? "checkmark.circle.fill" : "number")
            }
            .buttonStyle(.plain)
            .swipeActions {
              Button(role: .destructive) {
                onAction(
                  .collaborationDelete,
                  HermesRouteActionPayload(route: "collaboration", id: room.id)
                )
              } label: {
                Label(chinese ? "删除" : "Delete", systemImage: "trash")
              }
            }
          }
          .scrollContentBackground(.hidden)
          .frame(maxHeight: 180)
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
              ForEach(data.collaboration.messages) { message in
                Text(message.text).font(HermesFonts.body(14)).frame(maxWidth: .infinity, alignment: .leading).padding(10).background(appearance.palette.surface).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
              }
            }
            .padding(14)
          }
          HStack {
            TextField(chinese ? "发送消息" : "Message", text: $collaborationDraft)
              .textFieldStyle(.roundedBorder)
              .submitLabel(.send)
              .onSubmit { dismissHermesKeyboard() }
            Button {
              let text = collaborationDraft.trimmingCharacters(in: .whitespacesAndNewlines)
              let roomId = data.collaboration.selectedRoomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
              guard !text.isEmpty, !roomId.isEmpty else { return }
              dismissHermesKeyboard()
              let requestId: String
              if collaborationPendingRoomId == roomId,
                 collaborationPendingText == text,
                 !collaborationPendingRequestId.isEmpty {
                requestId = collaborationPendingRequestId
              } else {
                requestId = "room-request-\(UUID().uuidString.lowercased())"
                collaborationPendingRequestId = requestId
                collaborationPendingRoomId = roomId
                collaborationPendingText = text
              }
              onAction(
                .collaborationSend,
                HermesRouteActionPayload(
                  route: "collaboration",
                  id: roomId,
                  value: text,
                  requestId: requestId
                )
              )
            } label: { Image(systemName: "arrow.up.circle.fill") }
          }.padding(12).background(.ultraThinMaterial)
        }
      }
      .background(appearance.palette.background)
      .onChange(of: collaborationDraft) { next in
        let normalized = next.trimmingCharacters(in: .whitespacesAndNewlines)
        if !collaborationPendingRequestId.isEmpty && normalized != collaborationPendingText {
          collaborationPendingRequestId = ""
          collaborationPendingRoomId = ""
          collaborationPendingText = ""
        }
      }
      .onChange(of: data.collaboration.acknowledgedRequestId) { acknowledged in
        guard acknowledged == collaborationPendingRequestId else { return }
        collaborationDraft = ""
        collaborationPendingRequestId = ""
        collaborationPendingRoomId = ""
        collaborationPendingText = ""
      }
  }

  private var profilesRouteBody: some View {
      List {
        if route == .bots {
          Section {
            Button {
              onAction(.botGroupsOpen, HermesRouteActionPayload(route: "bots"))
            } label: {
              Label(chinese ? "群聊" : "Group chats", systemImage: "person.3.fill")
            }
          }
        }
        if route == .bots, let relay = botRelaySummary {
          Section(chinese ? "跨连接 Bot Relay" : "Cross-connection Bot Relay") {
            Text(relay)
              .font(HermesFonts.body(12))
              .foregroundStyle(appearance.palette.secondary)
            Button {
              editorID = ""
              editorName = ""
              editorValue = ""
              editorDetail = ""
              editor = .botRelay
            } label: {
              Label(chinese ? "发送跨连接消息" : "Send cross-connection message", systemImage: "arrow.up.right.square")
            }
          }
        }
        if route == .bots, !botRoutineGroups.isEmpty {
          Section(chinese ? "Bot Routines（按机器人）" : "Bot Routines (per bot)") {
            Text(chinese
              ? "这里对应桌面端 Bot Mode 的 Routines 面板；每个任务使用自己的 Profile 调度存储。"
              : "This mirrors the desktop Bot Mode Routines pane; every job uses its own Profile-scoped scheduler store.")
              .font(HermesFonts.body(11))
              .foregroundStyle(appearance.palette.secondary)
            ForEach(Array(botRoutineGroups.enumerated()), id: \.offset) { group in
              VStack(alignment: .leading, spacing: 7) {
                Text(group.element.profile)
                  .font(HermesFonts.bodyBold(13))
                ForEach(group.element.jobs) { job in
                  HStack(spacing: 8) {
                    Image(systemName: job.enabled ? "clock.arrow.circlepath" : "pause.circle")
                      .foregroundStyle(job.enabled ? appearance.palette.accent : appearance.palette.tertiary)
                    VStack(alignment: .leading, spacing: 2) {
                      Text(job.name).font(HermesFonts.bodyBold(12))
                      Text([job.schedule, job.lastRun].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(HermesFonts.mono(10))
                        .foregroundStyle(appearance.palette.secondary)
                    }
                    Spacer()
                    Button {
                      onAction(.cronToggle, HermesRouteActionPayload(route: "bots", id: job.id, enabled: !job.enabled, fields: ["profile": group.element.profile]))
                    } label: {
                      Image(systemName: job.enabled ? "pause.fill" : "play.fill")
                    }.buttonStyle(.borderless)
                    Button {
                      onAction(.cronRun, HermesRouteActionPayload(route: "bots", id: job.id, fields: ["profile": group.element.profile]))
                    } label: {
                      Image(systemName: "play.circle")
                    }.buttonStyle(.borderless)
                  }
                  .contextMenu {
                    Button {
                      routineEditorProfile = group.element.profile
                      editorID = job.id
                      editorName = job.name
                      editorValue = job.schedule
                      editorDetail = job.prompt
                      editor = .cron
                    } label: {
                      Label(chinese ? "编辑例程" : "Edit routine", systemImage: "square.and.pencil")
                    }
                    Button(role: .destructive) {
                      onAction(.cronDelete, HermesRouteActionPayload(route: "bots", id: job.id, fields: ["profile": group.element.profile]))
                    } label: {
                      Label(chinese ? "删除例程" : "Delete routine", systemImage: "trash")
                    }
                  }
                }
                Button {
                  routineEditorProfile = group.element.profile
                  editorID = ""
                  editorName = ""
                  editorValue = "0 * * * *"
                  editorDetail = ""
                  editor = .cron
                } label: {
                  Label(chinese ? "为此机器人新增例程" : "Add routine for this bot", systemImage: "plus")
                }
                .buttonStyle(.bordered)
              }
              .padding(.vertical, 4)
            }
          }
        }
        ForEach(data.profiles) { profile in
          profileRow(profile)
        }
      }
      .hermesListStyle()
      .refreshable {
        onAction(.refresh, HermesRouteActionPayload(route: route.rawValue))
      }
  }

  private func profileRow(_ profile: HermesProfileSnapshot) -> some View {
        HermesRemoteRow(icon: profile.botHasAvatar == true ? "person.crop.circle.fill" : (profile.active ? "person.crop.circle.fill" : "person.crop.circle"), iconData: profile.botAvatarData, title: profile.name, detail: "\(profile.model) · \(profile.detail)", tint: profile.active ? appearance.palette.success : appearance.palette.secondary) {
          if !profile.active {
            Button { onAction(.profileActivate, HermesRouteActionPayload(route: route.rawValue, id: profile.id)) } label: { Image(systemName: "checkmark") }.buttonStyle(.borderless)
          }
          if route == .bots {
            Button {
              onAction(
                .botChatOpen,
                HermesRouteActionPayload(
                  route: "bots",
                  id: profile.id
                )
              )
            } label: { Image(systemName: "bubble.left.and.bubble.right.fill") }
              .buttonStyle(.borderless)
              .accessibilityLabel(chinese ? "打开 Bot Chat" : "Open Bot Chat")
          }
        }
        .opacity(profile.botHidden == true ? 0.55 : 1)
        .contextMenu {
          Button {
            editorID = profile.id
            editorName = profile.name
            editorValue = ""
            editorDetail = profile.description ?? profile.detail
            editor = .profileDescription
          } label: { Label(chinese ? "编辑描述" : "Edit description", systemImage: "text.alignleft") }
          Button {
            editorID = profile.id
            editorName = profile.name
            editorValue = profile.model
            editorDetail = ""
            editor = .profileModel
          } label: { Label(chinese ? "编辑模型" : "Edit model", systemImage: "cpu") }
          Button {
            onAction(.profileAutoDescribe, HermesRouteActionPayload(route: route.rawValue, id: profile.id))
          } label: { Label(chinese ? "自动生成描述" : "Auto-describe", systemImage: "wand.and.stars") }
          Button {
            onAction(.profileSetup, HermesRouteActionPayload(route: route.rawValue, id: profile.id))
          } label: { Label(chinese ? "查看 Setup 命令" : "View setup command", systemImage: "terminal") }
          Button {
            onAction(.profileExport, HermesRouteActionPayload(route: route.rawValue, id: profile.id))
          } label: { Label(chinese ? "导出 Profile" : "Export profile", systemImage: "square.and.arrow.up") }
          Button {
            editorID = profile.id
            editorName = profile.name
            editorValue = profile.name
            editorDetail = ""
            editor = .profiles
          } label: { Label(chinese ? "重命名" : "Rename", systemImage: "pencil") }
          if route == .bots {
            Button {
              editorID = profile.id
              editorName = profile.name
              editorValue = (profile.botGroups ?? []).joined(separator: ", ")
              editorDetail = ""
              editor = .botMeta
            } label: { Label(chinese ? "编辑标题与分组" : "Edit title and groups", systemImage: "tag") }
            Button {
              onAction(.botProfileDescribe, HermesRouteActionPayload(route: "bots", id: profile.id))
            } label: { Label(chinese ? "读取官方能力配置" : "Load official capabilities", systemImage: "list.bullet.rectangle") }
            Menu {
              Button(chinese ? "跟随名称（自动颜色）" : "Follow name (automatic color)") {
                onAction(.botMetaUpdate, HermesRouteActionPayload(route: "bots", id: profile.id, detail: "{\"color\":\"\"}"))
              }
              ForEach(botAvatarColorChoices, id: \.self) { color in
                Button(color) {
                  onAction(.botMetaUpdate, HermesRouteActionPayload(route: "bots", id: profile.id, detail: "{\"color\":\"\(color)\"}"))
                }
              }
            } label: {
              Label(chinese ? "头像颜色" : "Avatar color", systemImage: "paintpalette")
            }
            Menu {
              ForEach(botAvatarShapeChoices, id: \.self) { shape in
                Button(shape.capitalized) {
                  onAction(.botMetaUpdate, HermesRouteActionPayload(route: "bots", id: profile.id, detail: "{\"shape\":\"\(shape)\"}"))
                }
              }
            } label: {
              Label(chinese ? "头像形状" : "Avatar shape", systemImage: "seal")
            }
            Button {
              avatarBotID = profile.id
              importingBotAvatar = true
            } label: { Label(chinese ? "上传头像" : "Upload avatar", systemImage: "person.crop.circle.badge.plus") }
            if profile.botHasAvatar == true {
              Button(role: .destructive) {
                clearingBotAvatarID = profile.id
              } label: {
                Label(chinese ? "清除头像" : "Clear avatar", systemImage: "person.crop.circle.badge.minus")
              }
            }
            if let petEntries = botPetEntries, !petEntries.isEmpty {
              Menu {
                ForEach(Array(petEntries.prefix(24).enumerated()), id: \.offset) { item in
                  Button(item.element.name) {
                    onAction(
                      .botPetSelect,
                      HermesRouteActionPayload(
                        route: "bots",
                        id: profile.id,
                        detail: item.element.url,
                        targetId: item.element.slug
                      )
                    )
                  }
                }
              } label: {
                Label(chinese ? "选择 Petdex 头像" : "Choose Petdex avatar", systemImage: "pawprint")
              }
            }
            Button {
              onAction(.botAvatarGenerate, HermesRouteActionPayload(route: "bots", id: profile.id))
            } label: { Label(chinese ? "生成头像" : "Generate avatar", systemImage: "wand.and.stars") }
            Button {
              editorID = profile.id
              editorName = profile.name
              editorValue = ""
              editorDetail = "{}"
              editor = .botProfileConfigure
            } label: { Label(chinese ? "编辑技能 / Toolset / MCP" : "Edit skills / toolsets / MCP", systemImage: "slider.horizontal.3") }
            Button {
              editorID = profile.id
              editorName = profile.name
              editorValue = ""
              editorDetail = ""
              editor = .botRelay
            } label: { Label(chinese ? "发送跨连接消息" : "Send cross-connection message", systemImage: "arrow.up.right.square") }
            Button {
              onAction(
                .botMetaUpdate,
                HermesRouteActionPayload(
                  route: "bots",
                  id: profile.id,
                  detail: #"{"hidden":\#(profile.botHidden != true)}"#
                )
              )
            } label: {
              Label(profile.botHidden == true ? (chinese ? "显示机器人" : "Show bot") : (chinese ? "隐藏机器人" : "Hide bot"), systemImage: profile.botHidden == true ? "eye" : "eye.slash")
            }
            Button {
              onAction(
                .botMetaUpdate,
                HermesRouteActionPayload(
                  route: "bots",
                  id: profile.id,
                  detail: #"{"pinned":\#(profile.botPinned != true)}"#
                )
              )
            } label: {
              Label(profile.botPinned == true ? (chinese ? "取消置顶" : "Unpin bot") : (chinese ? "置顶机器人" : "Pin bot"), systemImage: profile.botPinned == true ? "pin.slash" : "pin")
            }
          }
          Button {
            editorName = profile.id
            editorDetail = profile.soul
            editor = .soul
          } label: { Label(chinese ? "编辑 SOUL.md" : "Edit SOUL.md", systemImage: "doc.text") }
          if !profile.active { Button(role: .destructive) { onAction(.profileDelete, HermesRouteActionPayload(route: route.rawValue, id: profile.id)) } label: { Label(chinese ? "删除机器人" : "Delete bot", systemImage: "trash") } }
        }
  }

  private var configRouteBody: some View {
      Form {
        Section(chinese ? "通用" : "General") {
          LabeledContent(chinese ? "默认模型" : "Default model", value: data.config.defaultModel)
          LabeledContent(chinese ? "时区" : "Timezone", value: data.config.timezone)
        }
        Section(chinese ? "执行" : "Execution") {
          LabeledContent(chinese ? "最大迭代" : "Max iterations", value: String(Int(data.config.maxIterations)))
          Toggle(chinese ? "流式输出" : "Stream output", isOn: Binding(
            get: { data.config.streamOutput },
            set: { updateConfigValue("stream_output", value: $0) }
          ))
          Toggle(chinese ? "自动压缩" : "Automatic compaction", isOn: Binding(
            get: { data.config.autoCompact },
            set: { updateConfigValue("auto_compact", value: $0) }
          ))
        }
        Section(chinese ? "导入与导出" : "Import and export") {
          Button {
            importingConfiguration = true
          } label: {
            Label(chinese ? "导入配置" : "Import configuration", systemImage: "square.and.arrow.down")
          }
          ShareLink(item: data.config.exportText) {
            Label(chinese ? "分享配置" : "Share configuration", systemImage: "square.and.arrow.up")
          }
        }
      }.scrollContentBackground(.hidden).background(appearance.palette.background)
        .fileImporter(
          isPresented: $importingConfiguration,
          allowedContentTypes: [.json, .plainText],
          allowsMultipleSelection: false
        ) { result in
          guard case let .success(urls) = result, let url = urls.first else { return }
          DispatchQueue.global(qos: .userInitiated).async {
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            guard
              let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
              let fileSize = values.fileSize,
              fileSize > 0,
              fileSize <= 1_048_576,
              let content = try? String(contentsOf: url, encoding: .utf8)
            else { return }
            DispatchQueue.main.async {
              onAction(.configImport, HermesRouteActionPayload(route: "config", value: content))
            }
          }
        }
  }

  private var environmentRouteBody: some View {
      List(data.environment) { secret in
        HermesRemoteRow(icon: "key.fill", title: secret.key, detail: secret.maskedValue, tint: appearance.palette.accent) {
          HStack(spacing: 8) {
            Button {
              onAction(.environmentReveal, HermesRouteActionPayload(route: "env", id: secret.id))
            } label: { Image(systemName: "eye") }
              .buttonStyle(.borderless)
              .accessibilityLabel(chinese ? "显示变量值" : "Reveal variable")
            Button {
              editorID = secret.id
              editorName = secret.key
              editorValue = ""
              editorDetail = ""
              editor = .environment
            } label: { Image(systemName: "square.and.pencil") }
              .buttonStyle(.borderless)
              .accessibilityLabel(chinese ? "编辑变量" : "Edit variable")
            Button(role: .destructive) { onAction(.environmentDelete, HermesRouteActionPayload(route: "env", id: secret.id)) } label: { Image(systemName: "trash") }.buttonStyle(.borderless)
          }
        }
      }.hermesListStyle().refreshable { onAction(.refresh, HermesRouteActionPayload(route: "env")) }
  }

  private var systemRouteBody: some View {
      HermesPage(subtitle: chinese ? "Hermes 网关、任务和资源状态" : "Hermes gateway, task, and resource status") {
        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
          GridRow {
            HermesMetric(title: "CPU", value: data.system.metricsAvailable ? String(format: "%.0f%%", data.system.cpu) : "-", symbol: "cpu", tint: appearance.palette.primary)
            HermesMetric(title: chinese ? "内存" : "Memory", value: data.system.memoryLabel, symbol: "memorychip", tint: appearance.palette.warning)
          }
          GridRow {
            HermesMetric(title: chinese ? "运行时间" : "Uptime", value: data.system.uptimeLabel, symbol: "clock", tint: appearance.palette.success)
            HermesMetric(title: chinese ? "活动任务" : "Active tasks", value: data.system.activeTasks, symbol: "waveform", tint: appearance.palette.accent)
          }
        }
        HermesPanel {
          HStack { Text(chinese ? "网关状态" : "Gateway status").font(HermesFonts.display(15)); Spacer(); HermesStatusPill(text: data.system.gatewayOnline ? (chinese ? "在线" : "Online") : (chinese ? "离线" : "Offline"), color: data.system.gatewayOnline ? appearance.palette.success : appearance.palette.destructive) }
        }
        if let health = data.system.healthLabel, !health.isEmpty {
          HermesPanel {
            Label(health, systemImage: data.system.gatewayOnline ? "checkmark.shield" : "exclamationmark.shield")
              .foregroundStyle(data.system.gatewayOnline ? appearance.palette.success : appearance.palette.warning)
          }
        }
        if let egress = data.system.egressLabel, !egress.isEmpty {
          HermesPanel {
            Text(egress).font(HermesFonts.mono(11)).foregroundStyle(appearance.palette.secondary).textSelection(.enabled)
          }
        }
        if let updateVersion = data.system.updateVersion, !updateVersion.isEmpty {
          HermesPanel {
            HStack {
              Label(chinese ? "可用更新" : "Update available", systemImage: "arrow.down.circle")
              Spacer()
              Text(updateVersion).font(HermesFonts.mono(11))
            }
          }
        }
        ForEach(data.system.nodes) { node in
          HermesPanel {
            VStack(alignment: .leading, spacing: 12) {
              HStack(spacing: 8) {
                Circle()
                  .fill(node.gatewayOnline ? appearance.palette.success : appearance.palette.destructive)
                  .frame(width: 9, height: 9)
                Text(node.label)
                  .font(HermesFonts.display(15))
                Spacer()
                Button {
                  onAction(.systemRecover, HermesRouteActionPayload(route: "system", id: node.id))
                } label: {
                  Image(systemName: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(chinese ? "重新连接 \(node.label)" : "Reconnect \(node.label)")
                HermesStatusPill(
                  text: node.gatewayOnline
                    ? (chinese ? "网关在线" : "Online")
                    : node.recoveryState == "recovering" || node.recoveryState == "cooldown"
                      ? (chinese ? "正在重连" : "Reconnecting")
                      : (chinese ? "网关离线" : "Offline"),
                  color: node.gatewayOnline
                    ? appearance.palette.success
                    : node.recoveryState == "recovering" || node.recoveryState == "cooldown"
                      ? appearance.palette.warning
                      : appearance.palette.destructive
                )
              }
              if !node.version.isEmpty {
                Text("Hermes \(node.version)")
                  .font(HermesFonts.mono(11))
                  .foregroundStyle(appearance.palette.secondary)
              }
              Grid(horizontalSpacing: 12, verticalSpacing: 8) {
                GridRow {
                  LabeledContent("CPU", value: node.metricsAvailable ? String(format: "%.0f%%", node.cpu) : "-")
                  LabeledContent(chinese ? "内存" : "Memory", value: node.metricsAvailable ? String(format: "%.0f%%", node.memory) : "-")
                }
                GridRow {
                  LabeledContent(chinese ? "磁盘" : "Disk", value: node.metricsAvailable ? String(format: "%.0f%%", node.disk) : "-")
                  LabeledContent(chinese ? "活动任务" : "Tasks", value: node.activeTasks)
                }
              }
              .font(HermesFonts.body(12))
              Text(chinese
                ? "采集：\(node.metricsSource) · \(node.observedAt)"
                : "Source: \(node.metricsSource) · \(node.observedAt)")
                .font(HermesFonts.mono(9))
                .foregroundStyle(appearance.palette.tertiary)
            }
          }
        }
        HStack {
          Button { onAction(.systemStart, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "启动" : "Start", systemImage: "play.fill") }.buttonStyle(.bordered)
          Button { onAction(.systemStop, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "停止" : "Stop", systemImage: "stop.fill") }.buttonStyle(.bordered)
          Button { onAction(.systemDrain, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "排空" : "Drain", systemImage: "arrow.down.to.line") }.buttonStyle(.bordered)
          Button { onAction(.systemRecover, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "立即重连" : "Reconnect", systemImage: "arrow.triangle.2.circlepath") }.buttonStyle(HermesPrimaryButtonStyle())
          Button { onAction(.systemRestart, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "重启网关" : "Restart gateway", systemImage: "arrow.clockwise") }.buttonStyle(HermesPrimaryButtonStyle())
          Button { onAction(.systemUpdateCheck, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "检查更新" : "Check updates", systemImage: "magnifyingglass") }.buttonStyle(.bordered)
          Button { onAction(.systemUpdate, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "更新 Hermes" : "Update Hermes", systemImage: "arrow.down.circle") }.buttonStyle(.bordered)
        }
        ScrollView(.horizontal, showsIndicators: false) {
          HStack {
          Button { onAction(.systemDoctor, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "运行 Doctor" : "Run Doctor", systemImage: "stethoscope") }.buttonStyle(.bordered)
          Button { onAction(.systemSecurityAudit, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "安全审计" : "Security audit", systemImage: "checkmark.shield") }.buttonStyle(.bordered)
          Button { onAction(.systemBackup, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "创建备份" : "Create backup", systemImage: "externaldrive.badge.timemachine") }.buttonStyle(.bordered)
          Button { importingBackup = true } label: { Label(chinese ? "导入备份" : "Import backup", systemImage: "externaldrive.badge.plus") }.buttonStyle(.bordered)
          Button { onAction(.systemDebugShare, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "调试报告" : "Debug share", systemImage: "square.and.arrow.up") }.buttonStyle(.bordered)
          Button { onAction(.systemDiagnostics, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "诊断报告" : "Diagnostics", systemImage: "stethoscope") }.buttonStyle(.bordered)
          Button { onAction(.systemCheckpoints, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "检查点" : "Checkpoints", systemImage: "point.3.connected.trianglepath.dotted") }.buttonStyle(.bordered)
          Button { onAction(.systemCheckpointPrune, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "清理检查点" : "Prune checkpoints", systemImage: "scissors") }.buttonStyle(.bordered)
          Button { onAction(.systemCuratorRun, HermesRouteActionPayload(route: "system")) } label: { Label(chinese ? "运行 Curator" : "Run Curator", systemImage: "wand.and.stars") }.buttonStyle(.bordered)
          if let curatorPaused = data.system.curatorPaused {
            Button {
              onAction(.systemCuratorPause, HermesRouteActionPayload(route: "system", enabled: !curatorPaused))
            } label: {
              Label(
                curatorPaused
                  ? (chinese ? "恢复 Curator" : "Resume Curator")
                  : (chinese ? "暂停 Curator" : "Pause Curator"),
                systemImage: curatorPaused ? "play.circle" : "pause.circle"
              )
            }.buttonStyle(.bordered)
          }
          }
          .padding(.horizontal, 1)
        }
        if let hooks = data.systemHooksJSON, !hooks.isEmpty {
          HermesPanel {
            VStack(alignment: .leading, spacing: 8) {
              HStack {
                Text(chinese ? "Hooks" : "Hooks").font(HermesFonts.display(15))
                Spacer()
                Button {
                  hookJSON = "{}"
                  hookEvent = "on_session_end"
                  hookCommand = ""
                  hookMatcher = ""
                  hookTimeout = "30"
                  hookApprove = false
                  editingHook = true
                } label: {
                  Label(chinese ? "新增" : "Add", systemImage: "plus")
                }
                .buttonStyle(.bordered)
              }
              Text(hooks)
                .font(HermesFonts.mono(10))
                .foregroundStyle(appearance.palette.secondary)
                .textSelection(.enabled)
                .lineLimit(10)
              HStack {
                TextField(chinese ? "事件（如 on_session_end）" : "Event (for example on_session_end)", text: $hookDeleteEvent)
                  .textInputAutocapitalization(.never)
                  .autocorrectionDisabled()
                TextField(chinese ? "命令路径" : "Command path", text: $hookDeleteCommand)
                  .textInputAutocapitalization(.never)
                  .autocorrectionDisabled()
                Button(role: .destructive) {
                  onAction(.systemHookDelete, HermesRouteActionPayload(route: "system", fields: ["event": hookDeleteEvent, "command": hookDeleteCommand]))
                  hookDeleteEvent = ""
                  hookDeleteCommand = ""
                } label: {
                  Image(systemName: "trash")
                }
                .disabled(hookDeleteEvent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hookDeleteCommand.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
              }
              Text(chinese ? "可直接粘贴官方 /api/ops/hooks JSON 创建；删除需要事件名和命令路径。" : "Paste the official /api/ops/hooks JSON to create a hook; delete requires the event and command path.")
                .font(HermesFonts.body(11))
                .foregroundStyle(appearance.palette.tertiary)
            }
          }
        }
      }.refreshable { onAction(.refresh, HermesRouteActionPayload(route: "system")) }
  }

  @ViewBuilder private var channelOnboardingSection: some View {
    Section(chinese ? "官方渠道快速配对" : "Official channel onboarding") {
      Picker(chinese ? "渠道" : "Channel", selection: $onboardingChannel) {
        Text("Telegram").tag("telegram")
        Text("WhatsApp").tag("whatsapp")
      }
      .pickerStyle(.segmented)

      HStack {
        Button {
          onAction(
            .channelOnboardingStart,
            HermesRouteActionPayload(
              route: "channels",
              id: onboardingChannel,
              fields: onboardingChannel == "whatsapp"
                ? ["mode": onboardingWhatsappMode, "allowedUsers": onboardingWhatsappUsers]
                : nil
            )
          )
        } label: {
          Label(chinese ? "启动 QR 配对" : "Start QR pairing", systemImage: "qrcode")
        }
        .buttonStyle(.borderedProminent)
        .disabled(!onboardingPairingID.isEmpty && !onboardingStatusIsTerminal)
        if !onboardingPairingID.isEmpty {
          Button {
            onAction(
              .channelOnboardingCancel,
              HermesRouteActionPayload(
                route: "channels",
                id: activeOnboardingChannel,
                value: onboardingPairingID
              )
            )
          } label: {
            Label(chinese ? "取消" : "Cancel", systemImage: "xmark.circle")
          }
          .buttonStyle(.bordered)
        }
      }

      if onboardingChannel == "whatsapp" {
        Picker(chinese ? "模式" : "Mode", selection: $onboardingWhatsappMode) {
          Text("Bot").tag("bot")
          Text("Self-chat").tag("self-chat")
          Text(chinese ? "配对" : "Pairing").tag("pairing")
        }
        TextField(
          chinese ? "允许的 WhatsApp 号码（逗号分隔）" : "Allowed WhatsApp numbers (comma separated)",
          text: $onboardingWhatsappUsers
        )
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .keyboardType(.phonePad)
      } else if onboardingPairingID.isEmpty {
        Text(chinese
          ? "Telegram 配对完成后，在下方填写允许的数字用户 ID。"
          : "After Telegram pairing is ready, enter the allowed numeric user IDs below.")
          .font(HermesFonts.body(11))
          .foregroundStyle(appearance.palette.secondary)
      }

      if !onboardingPairingID.isEmpty {
        HStack(spacing: 8) {
          HermesStatusPill(
            text: onboardingStatus.isEmpty ? (chinese ? "等待状态" : "Waiting") : onboardingStatus,
            color: onboardingStatusIsTerminal ? appearance.palette.success : appearance.palette.warning
          )
          if !onboardingExpiresAt.isEmpty {
            Text(onboardingExpiresAt)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.secondary)
          }
        }
        if let image = onboardingQRImage {
          Image(uiImage: image)
            .interpolation(.none)
            .resizable()
            .scaledToFit()
            .frame(maxWidth: 240, maxHeight: 240)
            .padding(8)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .frame(maxWidth: .infinity, alignment: .center)
        }
        if !onboardingQRPayload.isEmpty {
          Text(onboardingQRPayload)
            .font(HermesFonts.mono(9))
            .foregroundStyle(appearance.palette.secondary)
            .textSelection(.enabled)
            .lineLimit(4)
        }
        if activeOnboardingChannel == "telegram" {
          TextField(
            chinese ? "允许的 Telegram 用户 ID（逗号分隔）" : "Allowed Telegram user IDs (comma separated)",
            text: $onboardingTelegramIDs
          )
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.numberPad)
        }
        Button {
          let detail: String
          if activeOnboardingChannel == "telegram" {
            let ids = onboardingTelegramIDs
              .split(separator: ",")
              .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
              .filter { !$0.isEmpty }
            guard let encoded = try? JSONSerialization.data(withJSONObject: ["allowed_user_ids": ids]),
                  let json = String(data: encoded, encoding: .utf8) else { return }
            detail = json
          } else {
            let values: [String: String] = [
              "mode": onboardingWhatsappMode,
              "allowed_users": onboardingWhatsappUsers,
            ]
            guard let encoded = try? JSONSerialization.data(withJSONObject: values),
                  let json = String(data: encoded, encoding: .utf8) else { return }
            detail = json
          }
          onAction(
            .channelOnboardingApply,
            HermesRouteActionPayload(
              route: "channels",
              id: activeOnboardingChannel,
              value: onboardingPairingID,
              detail: detail
            )
          )
        } label: {
          Label(chinese ? "保存并重启网关" : "Save and restart gateway", systemImage: "checkmark.circle")
        }
        .buttonStyle(.borderedProminent)
        .disabled(onboardingStatus == "waiting" || onboardingStatus == "starting" || onboardingStatus == "installing")
      }
    }
  }

  private var onboardingRecord: [String: Any] {
    guard let text = data.channelOnboardingJSON,
          let raw = text.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
    else { return [:] }
    return object
  }

  private var activeOnboardingChannel: String {
    let value = onboardingRecord["channel"] as? String
    return value == "whatsapp" ? "whatsapp" : value == "telegram" ? "telegram" : onboardingChannel
  }

  private var onboardingPairingID: String {
    (onboardingRecord["pairing_id"] as? String)
      ?? (onboardingRecord["pairingId"] as? String)
      ?? ""
  }

  private var onboardingStatus: String {
    (onboardingRecord["status"] as? String)?.lowercased() ?? ""
  }

  private var onboardingExpiresAt: String {
    (onboardingRecord["expires_at"] as? String)
      ?? (onboardingRecord["expiresAt"] as? String)
      ?? ""
  }

  private var onboardingQRPayload: String {
    (onboardingRecord["qr_payload"] as? String)
      ?? (onboardingRecord["qrPayload"] as? String)
      ?? ""
  }

  private var onboardingStatusIsTerminal: Bool {
    ["connected", "ready", "error", "cancelled", "expired", "failed"].contains(onboardingStatus)
  }

  private var onboardingQRImage: UIImage? {
    guard !onboardingQRPayload.isEmpty,
          let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
    filter.setValue(Data(onboardingQRPayload.utf8), forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let output = filter.outputImage else { return nil }
    let scale = max(1, floor(240 / max(output.extent.width, output.extent.height)))
    let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let cgImage = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
    return UIImage(cgImage: cgImage)
  }

  @ViewBuilder private var installationSection: some View {
    if !data.installations.isEmpty {
      Section(chinese ? "节点安装状态" : "Node installation status") {
        ForEach(data.installations) { operation in
          VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
              Text(operation.identifier)
                .font(HermesFonts.bodyBold(14))
                .lineLimit(1)
              Spacer()
              HermesStatusPill(text: localizedInstallationState(operation.state))
            }
            Text(operation.targets.map {
              "\(localizedNode($0.nodeId)): \(localizedInstallationState($0.state))"
            }.joined(separator: "  ·  "))
              .font(HermesFonts.body(12))
              .foregroundStyle(appearance.palette.secondary)
            if !operation.version.isEmpty {
              LabeledContent(chinese ? "版本" : "Version", value: operation.version)
                .font(HermesFonts.mono(11))
            }
            if !operation.tools.isEmpty {
              Text((chinese ? "工具：" : "Tools: ") + operation.tools.joined(separator: ", "))
                .font(HermesFonts.body(11))
                .foregroundStyle(appearance.palette.secondary)
            }
            if !operation.permissions.isEmpty {
              Text((chinese ? "权限：" : "Permissions: ") + operation.permissions.joined(separator: ", "))
                .font(HermesFonts.body(11))
                .foregroundStyle(appearance.palette.secondary)
            }
            if !operation.lastVerifiedAt.isEmpty {
              Text((chinese ? "最后验证：" : "Verified: ") + operation.lastVerifiedAt)
                .font(HermesFonts.mono(10))
                .foregroundStyle(appearance.palette.tertiary)
            }
            if !operation.error.isEmpty {
              Text(operation.error)
                .font(HermesFonts.body(12))
                .foregroundStyle(appearance.palette.destructive)
            }
            if operation.rollbackAvailable {
              Button(role: .destructive) {
                rollbackInstallationID = operation.id
              } label: {
                Label(chinese ? "回滚" : "Roll Back", systemImage: "arrow.uturn.backward")
              }
              .buttonStyle(.bordered)
            }
          }
          .padding(.vertical, 3)
        }
      }
    }
  }

  private var kanbanRoutePage: some View {
    VStack(alignment: .leading, spacing: 10) {
      HermesPanel {
        VStack(alignment: .leading, spacing: 10) {
          HStack(spacing: 12) {
            Label(chinese ? "官方 Kanban" : "Official Kanban", systemImage: "chart.bar.xaxis")
              .font(HermesFonts.bodyBold(13))
            Spacer()
            if let board = kanbanCurrentBoard, !board.isEmpty {
              HermesStatusPill(text: board, color: appearance.palette.accent)
            }
          }
          if let metadata = kanbanMetadataSummary {
            Text(metadata)
              .font(HermesFonts.mono(11))
              .foregroundStyle(appearance.palette.secondary)
              .fixedSize(horizontal: false, vertical: true)
              .accessibilityLabel(metadata)
          }
          HStack(spacing: 10) {
            if !kanbanBoardChoices.isEmpty {
              Menu {
                ForEach(kanbanBoardChoices) { board in
                  Button {
                    selectedKanbanCard = nil
                    onAction(
                      .kanbanBoardSwitch,
                      HermesRouteActionPayload(
                        route: "kanban",
                        value: board.id,
                        targetId: board.id,
                        fields: kanbanActionFields
                      )
                    )
                  } label: {
                    if board.id == kanbanCurrentBoard {
                      Label(board.name, systemImage: "checkmark")
                    } else {
                      Text(board.name)
                    }
                  }
                }
              } label: {
                Label(chinese ? "切换看板" : "Switch board", systemImage: "rectangle.3.group")
              }
              .buttonStyle(.bordered)
            }
            Spacer(minLength: 4)
            Button {
              onAction(
                .kanbanDispatch,
                HermesRouteActionPayload(route: "kanban", fields: kanbanActionFields)
              )
            } label: {
              Label(chinese ? "调度" : "Dispatch", systemImage: "paperplane.fill")
            }
            .buttonStyle(HermesPrimaryButtonStyle())
          }
        }
      }
      .padding(.horizontal, 14)
      .padding(.top, 12)

      if data.kanban.isEmpty {
        ContentUnavailableView(
          chinese ? "暂无看板任务" : "No Kanban tasks",
          systemImage: "rectangle.3.group",
          description: Text(chinese ? "点击右上角创建真实 Hermes 看板任务。" : "Create a Hermes Kanban task from the toolbar.")
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ScrollView(.horizontal) {
          HStack(alignment: .top, spacing: 12) {
            ForEach(data.kanban) { column in
              VStack(alignment: .leading, spacing: 8) {
                HStack {
                  Text(column.title).font(HermesFonts.display(14))
                  Spacer()
                  Text(String(column.cards.count))
                    .font(HermesFonts.mono(11))
                    .foregroundStyle(appearance.palette.secondary)
                }
                ForEach(column.cards) { card in
                  Button {
                    selectedKanbanCard = card
                    onAction(
                      .kanbanTaskOpen,
                      HermesRouteActionPayload(
                        route: "kanban",
                        id: card.id,
                        fields: kanbanActionFields
                      )
                    )
                  } label: {
                    HermesPanel {
                      VStack(alignment: .leading, spacing: 5) {
                        Text(card.title)
                          .font(HermesFonts.bodyBold(14))
                          .foregroundStyle(appearance.palette.foreground)
                          .frame(maxWidth: .infinity, alignment: .leading)
                        Text(card.detail)
                          .font(HermesFonts.body(12))
                          .foregroundStyle(appearance.palette.secondary)
                          .multilineTextAlignment(.leading)
                          .frame(maxWidth: .infinity, alignment: .leading)
                      }
                    }
                  }
                  .buttonStyle(.plain)
                  .accessibilityHint(chinese ? "打开任务详情和运行控制" : "Open task details and run controls")
                  .contextMenu {
                    Button {
                      editorID = card.id
                      editorName = card.title
                      editorValue = column.id
                      editorDetail = card.detail
                      editor = .kanban
                    } label: {
                      Label(chinese ? "编辑任务" : "Edit task", systemImage: "square.and.pencil")
                    }
                    Menu {
                      ForEach(data.kanban.filter { $0.id != column.id }) { target in
                        Button(target.title) {
                          onAction(
                            .kanbanMove,
                            HermesRouteActionPayload(
                              route: "kanban",
                              id: card.id,
                              targetId: target.id,
                              fields: kanbanActionFields
                            )
                          )
                        }
                      }
                    } label: {
                      Label(chinese ? "移动到" : "Move to", systemImage: "arrow.right.circle")
                    }
                    Button(role: .destructive) {
                      onAction(
                        .kanbanDelete,
                        HermesRouteActionPayload(route: "kanban", id: card.id, fields: kanbanActionFields)
                      )
                    } label: {
                      Label(chinese ? "归档" : "Archive", systemImage: "archivebox")
                    }
                  }
                }
              }
              .frame(width: 250, alignment: .topLeading)
            }
          }
          .padding(14)
        }
      }
      if let status = data.achievements.scanStatus,
         !status.isEmpty || data.achievements.recentUnlocksJSON != nil {
        HermesPanel {
          HStack(spacing: 10) {
            Image(systemName: statusIcon(data.achievements.scanStatus))
              .foregroundStyle(appearance.palette.accent)
            VStack(alignment: .leading, spacing: 3) {
              Text(chinese ? "官方扫描状态" : "Official scan status")
                .font(HermesFonts.bodyBold(12))
              Text(data.achievements.scanStatus?.isEmpty == false
                ? data.achievements.scanStatus!
                : (chinese ? "就绪" : "Ready"))
                .font(HermesFonts.mono(11))
                .foregroundStyle(appearance.palette.secondary)
            }
            Spacer()
            if let recent = recentAchievementCount {
              Text((chinese ? "最近解锁 " : "Recent unlocks ") + String(recent))
                .font(HermesFonts.body(11))
                .foregroundStyle(appearance.palette.secondary)
            }
          }
        }
        .padding(.horizontal, 14)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(appearance.palette.background)
  }

  private func localizedNode(_ value: String) -> String {
    switch value {
    case "server": return chinese ? "主服务器" : "Server"
    case "dbb3": return "DBB3"
    case "wsl": return "WSL"
    case "hk": return chinese ? "香港" : "Hong Kong"
    default: return value
    }
  }

  private func localizedInstallationState(_ value: String) -> String {
    guard chinese else { return value.capitalized }
    switch value {
    case "verified": return "已验证"
    case "partial": return "部分完成"
    case "rolled_back": return "已回滚"
    case "accepted": return "已受理"
    case "dispatching": return "正在分发"
    case "pending": return "等待中"
    case "retry": return "正在重试"
    case "running": return "安装中"
    case "completed": return "已完成"
    case "failed": return "失败"
    case "cancelled": return "已取消"
    default: return value
    }
  }

  private var editorKind: HermesRemoteEditor? {
    switch route {
    case .plugins: return .plugin
    case .cron: return .cron
    case .mcp: return .mcp
    case .webhooks: return .webhooks
    case .pairing: return .pairing
    case .profiles, .bots: return .profiles
    case .kanban: return .kanban
    case .collaboration: return .collaboration
    case .config: return .config
    case .env: return .environment
    case .skills: return .skill
    default: return nil
    }
  }

  private var cronBlueprintKeys: [String] {
    guard route == .cron,
          let text = data.cronBlueprintsJSON,
          let raw = text.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
    else { return [] }
    if let rows = object["blueprints"] as? [[String: Any]] {
      return rows.compactMap { row in
        (row["key"] as? String) ?? (row["name"] as? String)
      }
    }
    return object.keys.sorted()
  }

  private var botRelaySummary: String? {
    guard route == .bots,
          let text = data.botRelayJSON,
          let raw = text.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
    else { return nil }
    let agents = object["agents"] as? [[String: Any]] ?? []
    if agents.isEmpty {
      return chinese ? "当前没有可达的其他连接机器人。" : "No reachable bots on other connections."
    }
    let labels: [String] = agents.prefix(8).compactMap { row -> String? in
      let handle = row["handle"] as? String
      let connection = row["connection_id"] as? String
      guard let handle, !handle.isEmpty else { return nil }
      return connection.map { "\(handle)@\($0)" } ?? handle
    }
    let suffix = agents.count > labels.count ? (chinese ? " 等" : " more") : ""
    return chinese
      ? "可达机器人：\(labels.joined(separator: "、"))\(suffix)"
      : "Reachable bots: \(labels.joined(separator: ", "))\(suffix)"
  }

  /// Compact, human-readable projection of the official Kanban catalog.
  /// The full JSON remains available to JS/native extensions, while this
  /// summary makes diagnostics, worker liveness, board switching and profile
  /// catalogs visible on the phone without forcing a second network roundtrip.
  private var kanbanMetadataSummary: String? {
    guard route == .kanban, let object = kanbanMetadataObject else { return nil }
    let boards = (object["boards"] as? [String: Any])?["boards"] as? [[String: Any]]
      ?? object["boards"] as? [[String: Any]] ?? []
    let stats = object["stats"] as? [String: Any]
    let workers = (object["workers"] as? [String: Any])?["workers"] as? [[String: Any]]
      ?? []
    let diagnostics = (object["diagnostics"] as? [String: Any])?["diagnostics"] as? [[String: Any]]
      ?? object["diagnostics"] as? [[String: Any]] ?? []
    let profiles = (object["profile_catalog"] as? [String: Any])?["profiles"] as? [[String: Any]]
      ?? []
    var parts: [String] = []
    if !boards.isEmpty { parts.append((chinese ? "看板 " : "boards ") + String(boards.count)) }
    if let stats {
      let total = (stats["total"] as? Int)
        ?? ((stats["by_status"] as? [String: Any])?.values.compactMap { $0 as? Int }.reduce(0, +) ?? 0)
      if total > 0 { parts.append((chinese ? "任务 " : "tasks ") + String(total)) }
    }
    if !workers.isEmpty { parts.append((chinese ? "运行中 " : "running ") + String(workers.count)) }
    if !diagnostics.isEmpty { parts.append((chinese ? "诊断 " : "diagnostics ") + String(diagnostics.count)) }
    if !profiles.isEmpty { parts.append((chinese ? "Profile " : "profiles ") + String(profiles.count)) }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  private var kanbanMetadataObject: [String: Any]? {
    guard route == .kanban,
          let text = data.kanbanMetaJSON,
          let raw = text.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
    else { return nil }
    return object
  }

  private var kanbanBoardChoices: [HermesKanbanBoardChoice] {
    guard let object = kanbanMetadataObject else { return [] }
    let catalog = object["boards"]
    var choices: [HermesKanbanBoardChoice] = []

    func appendRows(_ rows: [[String: Any]]) {
      for row in rows {
        guard let id = hermesKanbanString(row["slug"])
          ?? hermesKanbanString(row["id"])
          ?? hermesKanbanString(row["name"]), !id.isEmpty else { continue }
        let name = hermesKanbanString(row["title"])
          ?? hermesKanbanString(row["display_name"])
          ?? hermesKanbanString(row["name"])
          ?? id
        choices.append(HermesKanbanBoardChoice(id: id, name: name))
      }
    }

    if let rows = catalog as? [[String: Any]] {
      appendRows(rows)
    } else if let values = catalog as? [String] {
      choices.append(contentsOf: values.map { HermesKanbanBoardChoice(id: $0, name: $0) })
    } else if let wrapper = catalog as? [String: Any] {
      if let rows = wrapper["boards"] as? [[String: Any]] { appendRows(rows) }
      if let values = wrapper["boards"] as? [String] {
        choices.append(contentsOf: values.map { HermesKanbanBoardChoice(id: $0, name: $0) })
      }
      if choices.isEmpty {
        for key in wrapper.keys.sorted() where wrapper[key] is [String: Any] {
          let row = wrapper[key] as? [String: Any] ?? [:]
          let id = hermesKanbanString(row["slug"])
            ?? hermesKanbanString(row["id"])
            ?? key
          let name = hermesKanbanString(row["title"])
            ?? hermesKanbanString(row["name"])
            ?? id
          choices.append(HermesKanbanBoardChoice(id: id, name: name))
        }
      }
    }

    var seen = Set<String>()
    return choices.filter { !$0.id.isEmpty && seen.insert($0.id).inserted }
  }

  private var kanbanCurrentBoard: String? {
    guard let object = kanbanMetadataObject else { return nil }
    let wrapper = object["boards"] as? [String: Any]

    func boardID(_ value: Any?) -> String? {
      if let direct = hermesKanbanString(value) { return direct }
      guard let row = value as? [String: Any] else { return nil }
      return hermesKanbanString(row["slug"])
        ?? hermesKanbanString(row["id"])
        ?? hermesKanbanString(row["name"])
    }

    let direct = boardID(object["current_board"])
      ?? boardID(object["active_board"])
      ?? boardID(object["current"])
      ?? boardID(object["active"])
      ?? boardID(wrapper?["current_board"])
      ?? boardID(wrapper?["active_board"])
      ?? boardID(wrapper?["current"])
      ?? boardID(wrapper?["active"])
    if let direct, !direct.isEmpty { return direct }

    let rows = (wrapper?["boards"] as? [[String: Any]])
      ?? (object["boards"] as? [[String: Any]])
      ?? []
    return rows.first(where: {
      ($0["current"] as? Bool) == true || ($0["active"] as? Bool) == true
    }).flatMap {
      hermesKanbanString($0["slug"])
        ?? hermesKanbanString($0["id"])
        ?? hermesKanbanString($0["name"])
    }
  }

  private var kanbanProfileChoices: [String] {
    guard let object = kanbanMetadataObject else {
      return data.profiles.map(\.id).filter { !$0.isEmpty }.sorted()
    }
    var profiles = data.profiles.map(\.id)

    func appendCatalog(_ value: Any?) {
      if let strings = value as? [String] {
        profiles.append(contentsOf: strings)
        return
      }
      if let rows = value as? [[String: Any]] {
        profiles.append(contentsOf: rows.compactMap {
          hermesKanbanString($0["profile"])
            ?? hermesKanbanString($0["slug"])
            ?? hermesKanbanString($0["id"])
            ?? hermesKanbanString($0["name"])
        })
        return
      }
      if let wrapper = value as? [String: Any] {
        for key in ["profiles", "assignees", "workers", "items"] {
          if let nested = wrapper[key] { appendCatalog(nested) }
        }
      }
    }

    appendCatalog(object["profile_catalog"])
    appendCatalog(object["assignee_catalog"])
    appendCatalog(object["assignees_catalog"])
    var seen = Set<String>()
    return profiles
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty && seen.insert($0).inserted }
      .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
  }

  private var kanbanActionFields: [String: String]? {
    guard let board = kanbanCurrentBoard, !board.isEmpty else { return nil }
    return ["board": board]
  }

  private var recentAchievementCount: Int? {
    guard let text = data.achievements.recentUnlocksJSON,
          let raw = text.data(using: .utf8),
          let rows = try? JSONSerialization.jsonObject(with: raw) as? [Any]
    else { return nil }
    return rows.count
  }

  private func statusIcon(_ status: String?) -> String {
    switch status?.lowercased() {
    case "running", "scanning", "pending": return "arrow.triangle.2.circlepath"
    case "error", "failed": return "exclamationmark.triangle"
    default: return "checkmark.circle"
    }
  }

  private var botPetEntries: [(slug: String, name: String, url: String)]? {
    guard route == .bots,
          let text = data.botPetJSON,
          let raw = text.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
          let pets = object["pets"] as? [[String: Any]]
    else { return nil }
    return pets.compactMap { row in
      guard let slug = row["slug"] as? String, !slug.isEmpty else { return nil }
      let name = {
        guard let value = row["displayName"] as? String, !value.isEmpty else { return slug }
        return value
      }()
      return (slug: slug, name: name, url: (row["spritesheetUrl"] as? String) ?? "")
    }
  }

  private var botRoutineGroups: [(profile: String, jobs: [HermesCronJobSnapshot])] {
    guard route == .bots,
          let text = data.botRoutinesJSON,
          let raw = text.data(using: .utf8),
          let decoded = try? JSONDecoder().decode([String: [HermesCronJobSnapshot]].self, from: raw)
    else { return [] }
    return decoded.keys.sorted().compactMap { profile in
      guard let jobs = decoded[profile], !jobs.isEmpty else { return nil }
      return (profile: profile, jobs: jobs)
    }
  }

  // Keep the same stable vocabulary as the upstream desktop avatar picker;
  // values are persisted via the official ``ui_meta['hermes-bots']`` patch.
  private var botAvatarShapeChoices: [String] {
    ["circle", "blob", "squircle", "pill", "triangle", "hexagon", "cloud", "drop"]
  }

  private var botAvatarColorChoices: [String] {
    stride(from: 0, to: 360, by: 30).map { "hsl(\($0) 68% 58%)" }
  }

  private var terminalBackendKeys: [String] {
    guard let text = data.terminalBackendsJSON,
          let raw = text.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
    else { return [] }
    if let rows = object["backends"] as? [[String: Any]] {
      return rows.compactMap { ($0["id"] as? String) ?? ($0["name"] as? String) }
    }
    return object.keys.sorted()
  }

  private func prepareEditor(_ kind: HermesRemoteEditor) {
    editorID = ""
    editorName = ""
    editorValue = kind == .kanban
      ? (data.kanban.first?.id ?? "")
      : kind == .collaboration
        ? data.collaboration.availableProfiles.joined(separator: ", ")
        : ""
    editorDetail = ""
    if kind == .cron { routineEditorProfile = "" }
    if kind == .config { editorDetail = data.config.exportText }
    if kind == .environment { editorValue = "" }
    if kind == .skill {
      editorValue = "custom"
      editorDetail = """
      ---
      name: {{name}}
      description: Describe when Hermes should use this skill.
      ---

      # Instructions

      Describe the workflow, constraints, and expected result.
      """
    }
    editor = kind
  }

  private func saveEditor(_ kind: HermesRemoteEditor) {
    dismissHermesKeyboard()
    let name = editorName.trimmingCharacters(in: .whitespacesAndNewlines)
    let value = editorValue.trimmingCharacters(in: .whitespacesAndNewlines)
    let detail = editorDetail.trimmingCharacters(in: .whitespacesAndNewlines)
    switch kind {
    case .collaboration:
      let profiles = value.split(separator: ",").map {
        String($0).trimmingCharacters(in: .whitespaces)
      }.filter { !$0.isEmpty }
      guard !name.isEmpty, !profiles.isEmpty else { return }
      onAction(.collaborationCreate, HermesRouteActionPayload(route: "collaboration", name: name, fields: ["profiles": profiles.joined(separator: ",")]))
    case .cron:
      guard !name.isEmpty, !detail.isEmpty else { return }
      let schedule = value.isEmpty ? "0 * * * *" : value
      if editorID.isEmpty {
        var fields = ["schedule": schedule]
        if !routineEditorProfile.isEmpty { fields["profile"] = routineEditorProfile }
        onAction(.cronCreate, HermesRouteActionPayload(route: "cron", name: name, detail: detail, enabled: true, fields: fields))
      } else if let encoded = try? JSONSerialization.data(withJSONObject: [
        "name": name,
        "prompt": detail,
        "schedule": schedule,
      ], options: [.sortedKeys]), let json = String(data: encoded, encoding: .utf8) {
        var fields: [String: String] = [:]
        if !routineEditorProfile.isEmpty { fields["profile"] = routineEditorProfile }
        onAction(.cronUpdate, HermesRouteActionPayload(route: "cron", id: editorID, detail: json, fields: fields))
      }
    case .mcp:
      guard !name.isEmpty, !value.isEmpty else { return }
      onAction(.integrationCreate, HermesRouteActionPayload(route: "mcp", name: name, fields: ["url": value]))
    case .webhooks:
      guard !name.isEmpty else { return }
      onAction(.integrationCreate, HermesRouteActionPayload(route: "webhooks", name: name, fields: ["description": detail]))
    case .pairing:
      guard !name.isEmpty, !value.isEmpty else { return }
      onAction(.pairingApprove, HermesRouteActionPayload(route: "pairing", id: name, value: value))
    case .profiles:
      guard !name.isEmpty else { return }
      if editorID.isEmpty {
        onAction(.profileCreate, HermesRouteActionPayload(route: route.rawValue, name: name, fields: ["description": detail, "model": value]))
      } else {
        onAction(.profileRename, HermesRouteActionPayload(route: route.rawValue, id: editorID, name: name))
      }
    case .botMeta:
      guard !editorID.isEmpty else { return }
      let groups = value.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
      guard let encoded = try? JSONSerialization.data(withJSONObject: ["title": name, "groups": groups]), let json = String(data: encoded, encoding: .utf8) else { return }
      onAction(.botMetaUpdate, HermesRouteActionPayload(route: "bots", id: editorID, detail: json))
    case .botProfileConfigure:
      guard !editorID.isEmpty, let object = try? JSONSerialization.jsonObject(with: Data(detail.utf8)), object is [String: Any] else { return }
      onAction(.botProfileConfigure, HermesRouteActionPayload(route: "bots", id: editorID, detail: detail))
    case .botRelay:
      guard !value.isEmpty, !detail.isEmpty else { return }
      onAction(.botRelaySend, HermesRouteActionPayload(route: "bots", detail: detail, targetId: value, fields: ["profile": editorID.isEmpty ? "default" : editorID]))
    case .profileDescription:
      guard !editorID.isEmpty else { return }
      onAction(.profileDescription, HermesRouteActionPayload(route: route.rawValue, id: editorID, detail: detail))
    case .profileModel:
      guard !editorID.isEmpty, !value.isEmpty else { return }
      onAction(.profileModel, HermesRouteActionPayload(route: route.rawValue, id: editorID, value: value))
    case .soul:
      guard !name.isEmpty else { return }
      onAction(.profileUpdate, HermesRouteActionPayload(route: "profiles", id: name, detail: editorDetail))
    case .skill:
      if editorID.isEmpty {
        guard !name.isEmpty, !detail.isEmpty else { return }
        let content = detail.replacingOccurrences(of: "{{name}}", with: name)
        onAction(.skillCreate, HermesRouteActionPayload(route: "skills", name: name, value: value, detail: content))
      } else {
        onAction(.skillUpdate, HermesRouteActionPayload(route: "skills", id: editorID, detail: editorDetail))
      }
    case .kanban:
      guard !name.isEmpty else { return }
      if editorID.isEmpty {
        onAction(
          .kanbanCreate,
          HermesRouteActionPayload(
            route: "kanban",
            name: name,
            detail: detail,
            targetId: value,
            fields: kanbanActionFields
          )
        )
      } else {
        onAction(
          .kanbanUpdate,
          HermesRouteActionPayload(
            route: "kanban",
            id: editorID,
            name: name,
            detail: detail,
            targetId: value,
            fields: kanbanActionFields
          )
        )
      }
    case .channel:
      guard !editorID.isEmpty, !detail.isEmpty else { return }
      onAction(.integrationUpdate, HermesRouteActionPayload(route: "channels", id: editorID, value: detail))
    case .config:
      guard !detail.isEmpty else { return }
      onAction(.configUpdate, HermesRouteActionPayload(route: "config", value: detail))
    case .environment:
      guard !name.isEmpty else { return }
      onAction(.environmentSet, HermesRouteActionPayload(route: "env", id: name, detail: value))
    case .toolsetProvider:
      guard !editorID.isEmpty, !value.isEmpty else { return }
      onAction(.toolsetProvider, HermesRouteActionPayload(route: "skills", id: editorID, value: value))
    case .toolsetModel:
      guard !editorID.isEmpty, !value.isEmpty else { return }
      onAction(.toolsetModel, HermesRouteActionPayload(route: "skills", id: editorID, value: value))
    case .toolsetEnvironment:
      guard !editorID.isEmpty, !value.isEmpty else { return }
      onAction(.toolsetEnvironment, HermesRouteActionPayload(route: "skills", id: editorID, detail: value))
    case .plugin:
      guard !name.isEmpty else { return }
      onAction(
        .pluginInstall,
        HermesRouteActionPayload(
          route: "plugins",
          name: name,
          fields: ["force": "false", "enable": "true"]
        )
      )
    }
    editor = nil
  }

  private func updateConfigValue(_ key: String, value: Any) {
    guard let data = self.data.config.exportText.data(using: .utf8),
          var config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    config[key] = value
    guard let updated = try? JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]),
          let json = String(data: updated, encoding: .utf8) else { return }
    onAction(.configUpdate, HermesRouteActionPayload(route: "config", value: json))
  }
}

private enum HermesKanbanPendingDanger: Equatable {
  case reclaim
  case terminate(String)
}

private struct HermesKanbanTaskDetailSheet: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let card: HermesKanbanCardSnapshot
  let detailJSON: String?
  let profileChoices: [String]
  let board: String?
  let chinese: Bool
  let onAction: HermesRouteActionSink
  let onNavigate: (HermesKanbanCardSnapshot) -> Void
  let onDismiss: () -> Void
  @State private var assignee = ""
  @State private var attachmentImporterOpen = false
  @State private var comment = ""
  @State private var reason = ""
  @State private var relationshipKind = "parent"
  @State private var relationshipTaskID = ""
  @State private var pendingDanger: HermesKanbanPendingDanger?

  private var detail: HermesKanbanTaskDetail? {
    HermesKanbanTaskDetail(json: detailJSON, expectedTaskID: card.id)
  }

  var body: some View {
    NavigationStack {
      Group {
        if let detail {
          Form {
            taskSection(detail)
            relationshipsSection(detail)
            relationshipComposerSection
            attachmentsSection(detail.attachments)
            commentComposerSection
            assignmentSection(detail)
            taskActionsSection
            if !detail.runs.isEmpty { runsSection(detail.runs) }
            if let inspection = detail.inspection { inspectionSection(inspection) }
            if let workerLog = detail.workerLog { workerLogSection(workerLog) }
            if !detail.comments.isEmpty {
              timelineSection(
                chinese ? "评论" : "Comments",
                icon: "text.bubble",
                entries: detail.comments
              )
            }
            if !detail.events.isEmpty {
              timelineSection(
                chinese ? "事件" : "Events",
                icon: "clock.arrow.circlepath",
                entries: detail.events
              )
            }
            if let lastAction = detail.lastAction, !lastAction.isEmpty {
              Section(chinese ? "最近操作" : "Last action") {
                Text(lastAction)
                  .font(HermesFonts.mono(10))
                  .foregroundStyle(appearance.palette.secondary)
                  .textSelection(.enabled)
              }
            }
          }
          .scrollContentBackground(.hidden)
          .background(appearance.palette.background)
        } else {
          VStack(spacing: 14) {
            ProgressView()
            Text(chinese ? "正在加载任务详情" : "Loading task details")
              .font(HermesFonts.bodyBold(14))
            Text(card.title)
              .font(HermesFonts.body(12))
              .foregroundStyle(appearance.palette.secondary)
              .multilineTextAlignment(.center)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(appearance.palette.background)
        }
      }
      .navigationTitle(chinese ? "任务详情" : "Task details")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button {
            onAction(
              .kanbanTaskOpen,
              HermesRouteActionPayload(route: "kanban", id: card.id, fields: actionFields())
            )
          } label: {
            Image(systemName: "arrow.clockwise")
          }
          .accessibilityLabel(chinese ? "刷新任务" : "Refresh task")
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(chinese ? "完成" : "Done", action: onDismiss)
        }
      }
    }
    .presentationDetents([.large])
    .presentationDragIndicator(.visible)
    .onAppear { synchronizeAssignee() }
    .onChange(of: detailJSON) { _, _ in synchronizeAssignee() }
    .fileImporter(
      isPresented: $attachmentImporterOpen,
      allowedContentTypes: [.data],
      allowsMultipleSelection: true
    ) { result in
      guard case let .success(urls) = result, !urls.isEmpty else { return }
      DispatchQueue.global(qos: .userInitiated).async {
        let stagedURLs = HermesFileImportStaging.stage(
          urls,
          maximumFileBytes: 25 * 1024 * 1024
        )
        guard !stagedURLs.isEmpty else { return }
        DispatchQueue.main.async {
          var fields = actionFields() ?? [:]
          fields["author"] = "ios"
          fields["stagedImport"] = "true"
          onAction(
            .kanbanAttachmentUpload,
            HermesRouteActionPayload(
              route: "kanban",
              id: card.id,
              requestId: "kanban-attachment-\(UUID().uuidString.lowercased())",
              fields: fields,
              uris: stagedURLs.map(\.absoluteString)
            )
          )
        }
      }
    }
    .confirmationDialog(
      dangerTitle,
      isPresented: Binding(
        get: { pendingDanger != nil },
        set: { if !$0 { pendingDanger = nil } }
      ),
      titleVisibility: .visible
    ) {
      if pendingDanger == .reclaim {
        Button(chinese ? "确认收回" : "Reclaim task", role: .destructive) {
          pendingDanger = nil
          onAction(
            .kanbanReclaim,
            HermesRouteActionPayload(
              route: "kanban",
              id: card.id,
              detail: normalizedReason,
              fields: actionFields()
            )
          )
        }
      }
      if case let .terminate(runID)? = pendingDanger {
        Button(chinese ? "确认终止" : "Terminate run", role: .destructive) {
          pendingDanger = nil
          onAction(
            .kanbanRunTerminate,
            HermesRouteActionPayload(
              route: "kanban",
              id: card.id,
              detail: normalizedReason,
              targetId: runID,
              fields: actionFields()
            )
          )
        }
      }
      Button(chinese ? "取消" : "Cancel", role: .cancel) { pendingDanger = nil }
    }
  }

  @ViewBuilder private func taskSection(_ detail: HermesKanbanTaskDetail) -> some View {
    Section {
      VStack(alignment: .leading, spacing: 10) {
        HStack(alignment: .top, spacing: 10) {
          Text(detail.task.title.isEmpty ? card.title : detail.task.title)
            .font(HermesFonts.display(18))
            .frame(maxWidth: .infinity, alignment: .leading)
          if !detail.task.status.isEmpty {
            HermesStatusPill(
              text: detail.task.status,
              color: kanbanStatusColor(detail.task.status)
            )
          }
        }
        let body = detail.task.body.isEmpty ? card.detail : detail.task.body
        if !body.isEmpty {
          Text(body)
            .font(HermesFonts.body(13))
            .foregroundStyle(appearance.palette.secondary)
            .textSelection(.enabled)
        }
        if !detail.task.priority.isEmpty {
          kanbanDetailRow(chinese ? "优先级" : "Priority", detail.task.priority)
        }
        if !detail.task.assignee.isEmpty {
          kanbanDetailRow(chinese ? "负责人" : "Assignee", detail.task.assignee)
        }
        if !detail.task.currentRunID.isEmpty {
          kanbanDetailRow(chinese ? "当前运行" : "Current run", detail.task.currentRunID)
        }
      }
      if !detail.task.latestSummary.isEmpty {
        VStack(alignment: .leading, spacing: 5) {
          Label(chinese ? "最新摘要" : "Latest summary", systemImage: "text.alignleft")
            .font(HermesFonts.bodyBold(12))
          Text(detail.task.latestSummary)
            .font(HermesFonts.body(12))
            .foregroundStyle(appearance.palette.secondary)
            .textSelection(.enabled)
        }
      }
      if !detail.task.result.isEmpty {
        VStack(alignment: .leading, spacing: 5) {
          Label(chinese ? "结果" : "Result", systemImage: "checkmark.circle")
            .font(HermesFonts.bodyBold(12))
          Text(detail.task.result)
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
            .textSelection(.enabled)
        }
      }
      if !detail.task.diagnostics.isEmpty {
        VStack(alignment: .leading, spacing: 5) {
          Label(chinese ? "诊断与警告" : "Diagnostics and warnings", systemImage: "exclamationmark.triangle")
            .font(HermesFonts.bodyBold(12))
          Text(detail.task.diagnostics)
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
            .textSelection(.enabled)
        }
      }
    }
  }

  @ViewBuilder private func relationshipsSection(_ detail: HermesKanbanTaskDetail) -> some View {
    if !detail.parents.isEmpty {
      Section(chinese ? "依赖 / 父任务" : "Dependencies / Parents") {
        ForEach(detail.parents) { target in relationshipButton(target, relation: "parent") }
      }
    }
    if !detail.children.isEmpty {
      Section(chinese ? "子任务" : "Children") {
        ForEach(detail.children) { target in relationshipButton(target, relation: "child") }
      }
    }
  }

  private var relationshipComposerSection: some View {
    Section(chinese ? "关联任务" : "Link task") {
      Picker(chinese ? "关系" : "Relationship", selection: $relationshipKind) {
        Text(chinese ? "父任务" : "Parent").tag("parent")
        Text(chinese ? "子任务" : "Child").tag("child")
      }
      .pickerStyle(.segmented)
      TextField(chinese ? "任务 ID" : "Task ID", text: $relationshipTaskID)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
      Button {
        let targetID = normalizedRelationshipTaskID
        guard !targetID.isEmpty, targetID != card.id else { return }
        onAction(
          .kanbanRelationLink,
          HermesRouteActionPayload(
            route: "kanban",
            id: card.id,
            targetId: targetID,
            fields: actionFields(["relation": relationshipKind])
          )
        )
        relationshipTaskID = ""
      } label: {
        Label(chinese ? "建立关系" : "Link task", systemImage: "link.badge.plus")
      }
      .disabled(normalizedRelationshipTaskID.isEmpty || normalizedRelationshipTaskID == card.id)
    }
  }

  private func relationshipButton(
    _ target: HermesKanbanRelationshipTarget,
    relation: String
  ) -> some View {
    Button {
      onNavigate(
        HermesKanbanCardSnapshot(
          id: target.id,
          title: target.title.isEmpty ? target.id : target.title,
          detail: target.detail
        )
      )
    } label: {
      HStack(spacing: 10) {
        Image(systemName: "arrow.triangle.branch")
          .foregroundStyle(appearance.palette.accent)
        VStack(alignment: .leading, spacing: 3) {
          Text(target.title.isEmpty ? target.id : target.title)
            .font(HermesFonts.bodyBold(13))
          if target.title != target.id {
            Text(target.id)
              .font(HermesFonts.mono(9))
              .foregroundStyle(appearance.palette.tertiary)
          }
          if !target.detail.isEmpty {
            Text(target.detail)
              .font(HermesFonts.body(11))
              .foregroundStyle(appearance.palette.secondary)
              .lineLimit(3)
          }
        }
        Spacer()
        if !target.status.isEmpty {
          HermesStatusPill(text: target.status, color: kanbanStatusColor(target.status))
        }
        Image(systemName: "chevron.right")
          .font(.caption.weight(.semibold))
          .foregroundStyle(appearance.palette.tertiary)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .swipeActions {
      Button(role: .destructive) {
        onAction(
          .kanbanRelationUnlink,
          HermesRouteActionPayload(
            route: "kanban",
            id: card.id,
            targetId: target.id,
            fields: actionFields(["relation": relation])
          )
        )
      } label: {
        Label(chinese ? "解除关系" : "Unlink", systemImage: "link.badge.minus")
      }
    }
  }

  @ViewBuilder private func attachmentsSection(_ attachments: [HermesKanbanAttachmentRecord]) -> some View {
    Section(chinese ? "附件" : "Attachments") {
      if attachments.isEmpty {
        Text(chinese ? "暂无附件" : "No attachments")
          .font(HermesFonts.body(12))
          .foregroundStyle(appearance.palette.secondary)
      } else {
        ForEach(attachments) { attachment in
          Button {
            onAction(
              .kanbanAttachmentDownload,
              HermesRouteActionPayload(
                route: "kanban",
                id: card.id,
                name: attachment.filename,
                targetId: attachment.id,
                position: attachment.size,
                fields: actionFields()
              )
            )
          } label: {
            HStack(spacing: 10) {
              Image(systemName: "paperclip")
                .foregroundStyle(appearance.palette.accent)
              VStack(alignment: .leading, spacing: 3) {
                Text(attachment.filename)
                  .font(HermesFonts.bodyBold(13))
                Text(attachment.detail)
                  .font(HermesFonts.mono(9))
                  .foregroundStyle(appearance.palette.secondary)
              }
              Spacer()
              Image(systemName: "arrow.down.circle")
                .foregroundStyle(appearance.palette.secondary)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
      Button {
        attachmentImporterOpen = true
      } label: {
        Label(chinese ? "上传附件" : "Upload attachments", systemImage: "paperclip.badge.ellipsis")
      }
    }
  }

  private var commentComposerSection: some View {
    Section(chinese ? "新增评论" : "Add comment") {
      TextField(chinese ? "写下任务备注" : "Write a task note", text: $comment, axis: .vertical)
        .lineLimit(2 ... 6)
      Button {
        let body = normalizedComment
        guard !body.isEmpty else { return }
        onAction(
          .kanbanCommentAdd,
          HermesRouteActionPayload(
            route: "kanban",
            id: card.id,
            detail: body,
            fields: actionFields(["author": "ios"])
          )
        )
        comment = ""
      } label: {
        Label(chinese ? "添加评论" : "Add comment", systemImage: "text.bubble.fill")
      }
      .disabled(normalizedComment.isEmpty)
    }
  }

  @ViewBuilder private func assignmentSection(_ detail: HermesKanbanTaskDetail) -> some View {
    Section(chinese ? "任务分配" : "Assignment") {
      if !profileChoices.isEmpty {
        Menu {
          ForEach(profileChoices, id: \.self) { profile in
            Button(profile) { assignee = profile }
          }
        } label: {
          HStack {
            Label(chinese ? "选择 Profile" : "Choose profile", systemImage: "person.crop.circle")
            Spacer()
            Text(assignee.isEmpty ? (chinese ? "未选择" : "Not selected") : assignee)
              .foregroundStyle(appearance.palette.secondary)
          }
        }
      }
      TextField(chinese ? "负责人 Profile" : "Assignee profile", text: $assignee)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
      TextField(chinese ? "操作原因（可选）" : "Reason (optional)", text: $reason, axis: .vertical)
        .lineLimit(2 ... 5)
      HStack(spacing: 10) {
        Button {
          onAction(
            .kanbanReassign,
            HermesRouteActionPayload(
              route: "kanban",
              id: card.id,
              detail: normalizedReason,
              targetId: normalizedAssignee,
              fields: actionFields()
            )
          )
        } label: {
          Label(chinese ? "重新分配" : "Reassign", systemImage: "person.crop.circle.badge.checkmark")
        }
        .buttonStyle(.borderedProminent)
        .disabled(normalizedAssignee.isEmpty || normalizedAssignee == detail.task.assignee)

        Button(role: .destructive) { pendingDanger = .reclaim } label: {
          Label(chinese ? "收回" : "Reclaim", systemImage: "arrow.uturn.backward")
        }
        .buttonStyle(.bordered)
      }
    }
  }

  private var taskActionsSection: some View {
    Section(chinese ? "任务操作" : "Task actions") {
      HStack(spacing: 10) {
        Button {
          onAction(
            .kanbanSpecify,
            HermesRouteActionPayload(route: "kanban", id: card.id, fields: actionFields())
          )
        } label: {
          Label(chinese ? "生成规格" : "Specify", systemImage: "doc.text.magnifyingglass")
        }
        .buttonStyle(.bordered)

        Button {
          onAction(
            .kanbanDecompose,
            HermesRouteActionPayload(route: "kanban", id: card.id, fields: actionFields())
          )
        } label: {
          Label(chinese ? "拆分任务" : "Decompose", systemImage: "square.split.2x2")
        }
        .buttonStyle(.bordered)
      }
      Button {
        var fields = actionFields() ?? [:]
        fields["tail"] = "300"
        onAction(
          .kanbanTaskLog,
          HermesRouteActionPayload(route: "kanban", id: card.id, fields: fields)
        )
      } label: {
        Label(chinese ? "加载 Worker 日志" : "Load worker log", systemImage: "terminal")
      }
    }
  }

  @ViewBuilder private func runsSection(_ runs: [HermesKanbanRunRecord]) -> some View {
    Section(chinese ? "运行" : "Runs") {
      ForEach(runs) { run in
        VStack(alignment: .leading, spacing: 7) {
          HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
              Text((chinese ? "运行 " : "Run ") + run.id)
                .font(HermesFonts.bodyBold(13))
              let identity = [run.profile, run.stepKey].filter { !$0.isEmpty }.joined(separator: " · ")
              if !identity.isEmpty {
                Text(identity)
                  .font(HermesFonts.mono(10))
                  .foregroundStyle(appearance.palette.secondary)
              }
            }
            Spacer()
            if !run.status.isEmpty {
              HermesStatusPill(text: run.status, color: kanbanStatusColor(run.status))
            }
          }
          if !run.summary.isEmpty {
            Text(run.summary)
              .font(HermesFonts.body(12))
              .foregroundStyle(appearance.palette.secondary)
              .textSelection(.enabled)
          }
          if !run.outcome.isEmpty { kanbanDetailRow(chinese ? "结果" : "Outcome", run.outcome) }
          if !run.error.isEmpty {
            Text(run.error)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.destructive)
              .textSelection(.enabled)
          }
          HStack(spacing: 10) {
            Button {
              onAction(
                .kanbanRunInspect,
                HermesRouteActionPayload(
                  route: "kanban",
                  id: card.id,
                  targetId: run.id,
                  fields: actionFields()
                )
              )
            } label: {
              Label(chinese ? "检查" : "Inspect", systemImage: "waveform.path.ecg")
            }
            .buttonStyle(.bordered)
            if run.isActive {
              Button(role: .destructive) { pendingDanger = .terminate(run.id) } label: {
                Label(chinese ? "终止" : "Terminate", systemImage: "stop.circle")
              }
              .buttonStyle(.bordered)
            }
          }
        }
        .padding(.vertical, 4)
      }
    }
  }

  @ViewBuilder private func inspectionSection(_ inspection: HermesKanbanInspectionRecord) -> some View {
    Section(chinese ? "运行检查" : "Run inspection") {
      ForEach(inspection.fields) { field in
        kanbanDetailRow(field.label, field.value)
      }
    }
  }

  @ViewBuilder private func workerLogSection(_ log: HermesKanbanWorkerLogRecord) -> some View {
    Section(chinese ? "Worker 日志" : "Worker log") {
      if !log.path.isEmpty { kanbanDetailRow(chinese ? "路径" : "Path", log.path) }
      HStack(spacing: 12) {
        if !log.size.isEmpty { kanbanDetailRow(chinese ? "大小" : "Size", log.size) }
        if log.truncated {
          HermesStatusPill(text: chinese ? "已截断" : "Truncated", color: appearance.palette.warning)
        }
      }
      if log.content.isEmpty {
        Text(log.exists ? (chinese ? "日志为空" : "Log is empty") : (chinese ? "日志文件不存在" : "Log file does not exist"))
          .font(HermesFonts.body(12))
          .foregroundStyle(appearance.palette.secondary)
      } else {
        ScrollView(.horizontal) {
          Text(log.content)
            .font(HermesFonts.mono(10))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 100, maxHeight: 360)
      }
    }
  }

  @ViewBuilder private func timelineSection(
    _ title: String,
    icon: String,
    entries: [HermesKanbanTimelineEntry]
  ) -> some View {
    Section(title) {
      ForEach(entries) { entry in
        VStack(alignment: .leading, spacing: 4) {
          HStack(alignment: .firstTextBaseline, spacing: 7) {
            Image(systemName: icon)
              .foregroundStyle(appearance.palette.accent)
            Text(entry.title)
              .font(HermesFonts.bodyBold(12))
            Spacer()
            if !entry.date.isEmpty {
              Text(entry.date)
                .font(HermesFonts.mono(9))
                .foregroundStyle(appearance.palette.tertiary)
            }
          }
          if !entry.detail.isEmpty {
            Text(entry.detail)
              .font(HermesFonts.body(12))
              .foregroundStyle(appearance.palette.secondary)
              .textSelection(.enabled)
          }
        }
        .padding(.vertical, 3)
      }
    }
  }

  private func kanbanDetailRow(_ label: String, _ value: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Text(label)
        .font(HermesFonts.body(11))
        .foregroundStyle(appearance.palette.secondary)
      Spacer()
      Text(value)
        .font(HermesFonts.mono(10))
        .multilineTextAlignment(.trailing)
        .textSelection(.enabled)
    }
  }

  private func actionFields(_ extra: [String: String] = [:]) -> [String: String]? {
    var fields = extra
    if let board, !board.isEmpty { fields["board"] = board }
    return fields.isEmpty ? nil : fields
  }

  private func synchronizeAssignee() {
    guard let next = detail?.task.assignee, assignee.isEmpty else { return }
    assignee = next
  }

  private var normalizedAssignee: String {
    assignee.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var normalizedReason: String {
    reason.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var normalizedComment: String {
    comment.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var normalizedRelationshipTaskID: String {
    relationshipTaskID.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var dangerTitle: String {
    switch pendingDanger {
    case .reclaim:
      return chinese ? "确认收回此任务？当前 Worker 的处理可能被中断。" : "Reclaim this task? The active worker may be interrupted."
    case .terminate:
      return chinese ? "确认终止此运行？此操作无法撤销。" : "Terminate this run? This action cannot be undone."
    case nil:
      return ""
    }
  }

  private func kanbanStatusColor(_ status: String) -> Color {
    switch status.lowercased() {
    case "done", "completed", "succeeded", "success": return appearance.palette.success
    case "failed", "error", "cancelled", "terminated": return appearance.palette.destructive
    case "running", "claimed", "in_progress", "active": return appearance.palette.accent
    default: return appearance.palette.warning
    }
  }
}

private struct HermesKanbanTaskDetail {
  let task: HermesKanbanTaskRecord
  let comments: [HermesKanbanTimelineEntry]
  let events: [HermesKanbanTimelineEntry]
  let attachments: [HermesKanbanAttachmentRecord]
  let parents: [HermesKanbanRelationshipTarget]
  let children: [HermesKanbanRelationshipTarget]
  let runs: [HermesKanbanRunRecord]
  let inspection: HermesKanbanInspectionRecord?
  let workerLog: HermesKanbanWorkerLogRecord?
  let lastAction: String?

  init?(json: String?, expectedTaskID: String) {
    guard let json, !json.isEmpty,
          let raw = json.data(using: .utf8),
          let envelope = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
    else { return nil }
    let taskObject = envelope["task"] as? [String: Any] ?? envelope
    let task = HermesKanbanTaskRecord(taskObject)
    guard !task.id.isEmpty, task.id == expectedTaskID else { return nil }
    self.task = task
    comments = HermesKanbanTimelineEntry.rows(
      from: envelope["comments"],
      nestedKeys: ["comments", "items"],
      kind: "comment"
    )
    events = HermesKanbanTimelineEntry.rows(
      from: envelope["events"],
      nestedKeys: ["events", "items"],
      kind: "event"
    )
    attachments = hermesKanbanRows(
      envelope["attachments"],
      nestedKeys: ["attachments", "items"]
    ).compactMap(HermesKanbanAttachmentRecord.init)
    let links = envelope["links"] as? [String: Any] ?? [:]
    let parentRows = hermesKanbanRows(
      envelope["parent_results"],
      nestedKeys: ["parents", "tasks", "items"]
    )
    var parentRecords = [String: HermesKanbanRelationshipTarget]()
    for row in parentRows {
      guard let parent = HermesKanbanRelationshipTarget(row) else { continue }
      parentRecords[parent.id] = parent
    }
    parents = hermesKanbanIDs(links["parents"]).map { id in
      parentRecords[id] ?? HermesKanbanRelationshipTarget(
        id: id,
        title: id,
        status: "",
        detail: ""
      )
    }
    let childRows = hermesKanbanRows(
      envelope["child_results"],
      nestedKeys: ["children", "tasks", "items"]
    )
    var childRecords = [String: HermesKanbanRelationshipTarget]()
    for row in childRows {
      guard let child = HermesKanbanRelationshipTarget(row) else { continue }
      childRecords[child.id] = child
    }
    children = hermesKanbanIDs(links["children"]).map { id in
      childRecords[id] ?? HermesKanbanRelationshipTarget(
        id: id,
        title: id,
        status: "",
        detail: ""
      )
    }
    runs = hermesKanbanRows(envelope["runs"], nestedKeys: ["runs", "items"])
      .enumerated()
      .map { HermesKanbanRunRecord($0.element, fallbackID: String($0.offset + 1)) }
    inspection = (envelope["inspection"] as? [String: Any]).map(HermesKanbanInspectionRecord.init)
    workerLog = (envelope["worker_log"] as? [String: Any]).map(HermesKanbanWorkerLogRecord.init)
    lastAction = hermesKanbanText(envelope["last_action"])
  }
}

private struct HermesKanbanRelationshipTarget: Identifiable {
  let id: String
  let title: String
  let status: String
  let detail: String

  init(id: String, title: String, status: String, detail: String) {
    self.id = id
    self.title = title
    self.status = status
    self.detail = detail
  }

  init?(_ row: [String: Any]) {
    guard let id = hermesKanbanString(row["id"]) ?? hermesKanbanString(row["task_id"]) else {
      return nil
    }
    self.id = id
    title = hermesKanbanString(row["title"]) ?? id
    status = hermesKanbanString(row["status"]) ?? ""
    detail = hermesKanbanText(row["latest_summary"])
      ?? hermesKanbanText(row["result"])
      ?? ""
  }
}

private struct HermesKanbanAttachmentRecord: Identifiable {
  let id: String
  let filename: String
  let contentType: String
  let size: Int
  let uploadedBy: String
  let createdAt: String

  init?(_ row: [String: Any]) {
    guard let id = hermesKanbanString(row["id"]) else { return nil }
    self.id = id
    filename = hermesKanbanString(row["filename"]) ?? "attachment"
    contentType = hermesKanbanString(row["content_type"]) ?? "application/octet-stream"
    size = hermesKanbanInteger(row["size"])
    uploadedBy = hermesKanbanString(row["uploaded_by"]) ?? ""
    createdAt = hermesKanbanString(row["created_at"]) ?? ""
  }

  var detail: String {
    var parts = [String]()
    if size > 0 {
      parts.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
    }
    if !contentType.isEmpty { parts.append(contentType) }
    if !uploadedBy.isEmpty { parts.append(uploadedBy) }
    if !createdAt.isEmpty { parts.append(createdAt) }
    return parts.joined(separator: " · ")
  }
}

private struct HermesKanbanTaskRecord {
  let id: String
  let title: String
  let body: String
  let status: String
  let assignee: String
  let priority: String
  let currentRunID: String
  let latestSummary: String
  let result: String
  let diagnostics: String

  init(_ row: [String: Any]) {
    id = hermesKanbanString(row["id"]) ?? hermesKanbanString(row["task_id"]) ?? ""
    title = hermesKanbanString(row["title"]) ?? hermesKanbanString(row["name"]) ?? ""
    body = hermesKanbanText(row["body"]) ?? hermesKanbanText(row["description"]) ?? ""
    status = hermesKanbanString(row["status"]) ?? ""
    assignee = hermesKanbanString(row["assignee"])
      ?? hermesKanbanString(row["profile"])
      ?? ""
    priority = hermesKanbanString(row["priority"]) ?? ""
    currentRunID = hermesKanbanString(row["current_run_id"]) ?? ""
    latestSummary = hermesKanbanText(row["latest_summary"]) ?? hermesKanbanText(row["summary"]) ?? ""
    result = hermesKanbanText(row["result"]) ?? ""
    diagnostics = [hermesKanbanText(row["diagnostics"]), hermesKanbanText(row["warnings"])]
      .compactMap { $0 }
      .filter { !$0.isEmpty }
      .joined(separator: "\n")
  }
}

private struct HermesKanbanTimelineEntry: Identifiable {
  let id: String
  let title: String
  let detail: String
  let date: String

  static func rows(from value: Any?, nestedKeys: [String], kind: String) -> [HermesKanbanTimelineEntry] {
    let sourceRows = hermesKanbanRows(value, nestedKeys: nestedKeys)
    return sourceRows.enumerated().map { index, row in
      let fallbackTitle = kind == "comment" ? "Comment" : "Event"
      let id = hermesKanbanString(row["id"]) ?? "\(kind)-\(index)"
      let title = hermesKanbanString(row["author"])
        ?? hermesKanbanString(row["actor"])
        ?? hermesKanbanString(row["kind"])
        ?? hermesKanbanString(row["type"])
        ?? hermesKanbanString(row["event"])
        ?? hermesKanbanString(row["action"])
        ?? fallbackTitle
      let detail = hermesKanbanText(row["body"])
        ?? hermesKanbanText(row["text"])
        ?? hermesKanbanText(row["comment"])
        ?? hermesKanbanText(row["message"])
        ?? hermesKanbanText(row["detail"])
        ?? hermesKanbanText(row["payload"])
        ?? ""
      let date = hermesKanbanString(row["created_at"])
        ?? hermesKanbanString(row["timestamp"])
        ?? hermesKanbanString(row["date"])
        ?? ""
      return HermesKanbanTimelineEntry(
        id: id,
        title: title,
        detail: detail,
        date: date
      )
    }
  }
}

private struct HermesKanbanRunRecord: Identifiable {
  let id: String
  let profile: String
  let stepKey: String
  let status: String
  let endedAt: String
  let outcome: String
  let summary: String
  let error: String

  init(_ row: [String: Any], fallbackID: String) {
    id = hermesKanbanString(row["id"])
      ?? hermesKanbanString(row["run_id"])
      ?? fallbackID
    profile = hermesKanbanString(row["profile"])
      ?? hermesKanbanString(row["assignee"])
      ?? ""
    stepKey = hermesKanbanString(row["step_key"]) ?? ""
    status = hermesKanbanString(row["status"]) ?? ""
    endedAt = hermesKanbanString(row["ended_at"]) ?? ""
    outcome = hermesKanbanText(row["outcome"]) ?? ""
    summary = hermesKanbanText(row["summary"]) ?? ""
    error = hermesKanbanText(row["error"]) ?? ""
  }

  var isActive: Bool {
    guard endedAt.isEmpty else { return false }
    return !["done", "completed", "succeeded", "success", "failed", "error", "cancelled", "terminated"]
      .contains(status.lowercased())
  }
}

private struct HermesKanbanInspectionField: Identifiable {
  let label: String
  let value: String
  var id: String { label }
}

private struct HermesKanbanInspectionRecord {
  let fields: [HermesKanbanInspectionField]

  init(_ source: [String: Any]) {
    let object = source["inspection"] as? [String: Any] ?? source
    let preferredKeys = [
      "run_id", "status", "alive", "pid", "cpu_percent", "memory_rss_bytes",
      "num_threads", "reason", "error",
    ]
    var fields: [HermesKanbanInspectionField] = []
    var seen = Set<String>()
    for key in preferredKeys + object.keys.sorted() where seen.insert(key).inserted {
      guard let value = hermesKanbanText(object[key]), !value.isEmpty else { continue }
      fields.append(HermesKanbanInspectionField(label: key.replacingOccurrences(of: "_", with: " "), value: value))
    }
    self.fields = fields
  }
}

private struct HermesKanbanWorkerLogRecord {
  let path: String
  let exists: Bool
  let size: String
  let content: String
  let truncated: Bool

  init(_ source: [String: Any]) {
    let object = source["log"] as? [String: Any] ?? source
    path = hermesKanbanString(object["path"]) ?? ""
    exists = (object["exists"] as? Bool) ?? !((hermesKanbanText(object["content"]) ?? "").isEmpty)
    if let bytes = hermesKanbanString(object["size_bytes"]), !bytes.isEmpty {
      size = bytes + " B"
    } else {
      size = hermesKanbanString(object["size"]) ?? ""
    }
    content = hermesKanbanText(object["content"])
      ?? hermesKanbanText(object["text"])
      ?? ""
    truncated = (object["truncated"] as? Bool) ?? false
  }
}

private func hermesKanbanRows(_ value: Any?, nestedKeys: [String]) -> [[String: Any]] {
  if let rows = value as? [[String: Any]] { return rows }
  guard let wrapper = value as? [String: Any] else { return [] }
  for key in nestedKeys {
    if let rows = wrapper[key] as? [[String: Any]] { return rows }
  }
  return []
}

private func hermesKanbanIDs(_ value: Any?) -> [String] {
  guard let values = value as? [Any] else { return [] }
  var seen = Set<String>()
  return values.compactMap(hermesKanbanString).filter { seen.insert($0).inserted }
}

private func hermesKanbanInteger(_ value: Any?) -> Int {
  if let number = value as? NSNumber { return max(0, number.intValue) }
  if let string = value as? String, let number = Int(string) { return max(0, number) }
  return 0
}

private func hermesKanbanString(_ value: Any?) -> String? {
  if let string = value as? String {
    let normalized = string.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.isEmpty ? nil : normalized
  }
  if let number = value as? NSNumber { return number.stringValue }
  return nil
}

private func hermesKanbanText(_ value: Any?) -> String? {
  if let string = hermesKanbanString(value) { return string }
  guard let value, !(value is NSNull), JSONSerialization.isValidJSONObject(value),
        let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
        let text = String(data: data, encoding: .utf8), !text.isEmpty
  else { return nil }
  return text
}

private struct HermesRemoteEditorSheet: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let kind: HermesRemoteEditor
  let chinese: Bool
  let isCreating: Bool
  @Binding var name: String
  @Binding var value: String
  @Binding var detail: String
  let kanbanColumns: [HermesKanbanColumnSnapshot]
  let onCancel: () -> Void
  let onSave: () -> Void

  var body: some View {
    NavigationStack {
      Form {
        if kind == .botMeta {
          Section(chinese ? "Bot Mode" : "Bot Mode") {
            TextField(chinese ? "显示标题" : "Display title", text: $name)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
            TextField(chinese ? "分组（逗号分隔）" : "Groups (comma separated)", text: $value)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
        } else if kind == .skill {
          if isCreating {
            TextField(nameLabel, text: $name)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
            TextField(valueLabel, text: $value)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
          Section("SKILL.md") {
            TextEditor(text: $detail)
              .font(HermesFonts.mono(12))
              .frame(minHeight: 320)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
        } else if kind == .config || kind == .soul || kind == .channel || kind == .profileDescription || kind == .botProfileConfigure || kind == .botRelay {
          Section(kind == .soul ? "SOUL.md" : kind == .profileDescription ? (chinese ? "Profile 描述" : "Profile description") : kind == .channel ? (chinese ? "渠道配置 JSON" : "Channel configuration JSON") : kind == .botRelay ? (chinese ? "跨连接 Bot Relay" : "Cross-connection Bot Relay") : (chinese ? "官方 Bot 能力 JSON" : "Official Bot capabilities JSON")) {
            if kind == .botRelay {
              TextField(chinese ? "目标（handle@connection-id）" : "Target (handle@connection-id)", text: $value)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }
            TextEditor(text: $detail)
              .font(HermesFonts.mono(12))
              .frame(minHeight: 320)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
            if kind == .botProfileConfigure {
              Text(chinese ? "字段遵循官方 profiles.configure：description、soul、provider、model、disabled_skills、enabled_toolsets、enabled_mcp_servers、ui_meta。保存时直接调用官方接口。" : "Fields follow official profiles.configure: description, soul, provider, model, disabled_skills, enabled_toolsets, enabled_mcp_servers, and ui_meta. Save calls the upstream contract directly.")
                .font(HermesFonts.body(11))
                .foregroundStyle(.secondary)
            } else if kind == .botRelay {
              Text(chinese ? "消息经官方 Bot Mode relay outbox 排队；目标不在线或不明确时不会静默丢失。" : "The message is queued through the official Bot Mode relay outbox; offline or ambiguous targets fail explicitly.")
                .font(HermesFonts.body(11))
                .foregroundStyle(.secondary)
            }
          }
        } else {
          if kind != .toolsetEnvironment {
            TextField(nameLabel, text: $name)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
          if kind == .collaboration || kind == .cron || kind == .mcp || kind == .pairing || kind == .profiles || kind == .profileModel || kind == .kanban || kind == .environment || kind == .toolsetProvider || kind == .toolsetModel {
            Group {
              if kind == .kanban {
                Picker(chinese ? "状态" : "Status", selection: $value) {
                  ForEach(kanbanColumns) { column in
                    Text(column.title).tag(column.id)
                  }
                }
              } else {
                TextField(valueLabel, text: $value)
                  .textInputAutocapitalization(.never)
                  .autocorrectionDisabled()
              }
            }
          }
          if kind == .toolsetEnvironment {
            Section(chinese ? "Toolset 环境 JSON" : "Toolset environment JSON") {
              TextEditor(text: $value)
                .font(HermesFonts.mono(12))
                .frame(minHeight: 240)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }
          }
          if kind == .cron || kind == .webhooks || kind == .profiles || kind == .kanban {
            TextField(detailLabel, text: $detail, axis: .vertical)
              .lineLimit(3...8)
          }
        }
      }
      .scrollContentBackground(.hidden)
      .background(appearance.palette.background)
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(chinese ? "取消" : "Cancel") {
            dismissHermesKeyboard()
            onCancel()
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(chinese ? "保存" : "Save") {
            dismissHermesKeyboard()
            onSave()
          }
        }
      }
    }
    .presentationDetents(kind == .config || kind == .soul || kind == .skill || kind == .channel || kind == .profileDescription ? [.large] : [.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var title: String {
    if !chinese {
      if kind == .config { return "Edit Configuration" }
      if kind == .soul { return "Edit SOUL.md" }
      if kind == .profileDescription { return isCreating ? "Add Profile description" : "Edit Profile description" }
      if kind == .profileModel { return isCreating ? "Add Profile model" : "Edit Profile model" }
      if kind == .botMeta { return isCreating ? "Bot Mode metadata" : "Edit Bot Mode metadata" }
      if kind == .botProfileConfigure { return "Configure Bot Mode profile" }
      if kind == .botRelay { return "Send Bot Mode message" }
      if kind == .skill { return isCreating ? "New Skill" : "Edit SKILL.md" }
      if kind == .kanban { return name.isEmpty ? "New Task" : "Edit Task" }
      if kind == .channel { return "Edit Channel Configuration" }
      if kind == .plugin { return "Install Plugin" }
      if kind == .cron { return isCreating ? "New Scheduled Job" : "Edit Scheduled Job" }
      if kind == .environment { return isCreating ? "Add Environment Variable" : "Edit Environment Variable" }
      if kind == .toolsetProvider { return "Select Toolset Provider" }
      if kind == .toolsetModel { return "Select Toolset Model" }
      if kind == .toolsetEnvironment { return "Edit Toolset Environment" }
      return "Add \(kind.rawValue.capitalized)"
    }
    switch kind {
    case .collaboration: return "新建协作房间"
    case .cron: return isCreating ? "新建定时任务" : "编辑定时任务"
    case .mcp: return "添加 MCP 服务器"
    case .webhooks: return "添加 Webhook"
    case .pairing: return "批准配对用户"
    case .profiles: return "新建 Profile"
    case .profileDescription: return "编辑 Profile 描述"
    case .profileModel: return "编辑 Profile 模型"
    case .botMeta: return "编辑 Bot Mode 信息"
    case .botProfileConfigure: return "配置 Bot Mode Profile"
    case .botRelay: return "发送跨连接 Bot 消息"
    case .soul: return "编辑 SOUL.md"
    case .skill: return isCreating ? "新建 Skill" : "编辑 SKILL.md"
    case .kanban: return name.isEmpty ? "新建任务" : "编辑任务"
    case .channel: return "编辑渠道配置"
    case .config: return "编辑配置"
    case .plugin: return "安装插件"
    case .environment: return isCreating ? "新增环境变量" : "编辑环境变量"
    case .toolsetProvider: return "选择 Toolset Provider"
    case .toolsetModel: return "选择 Toolset 模型"
    case .toolsetEnvironment: return "编辑 Toolset 环境"
    }
  }

  private var nameLabel: String {
    if kind == .collaboration { return chinese ? "房间名称" : "Room name" }
    if kind == .pairing { return chinese ? "平台" : "Platform" }
    if kind == .kanban { return chinese ? "标题" : "Title" }
    if kind == .plugin { return chinese ? "插件标识符或仓库" : "Plugin identifier or repository" }
    if kind == .environment { return chinese ? "变量名" : "Variable name" }
    return chinese ? "名称" : "Name"
  }
  private var valueLabel: String {
    if kind == .skill { return chinese ? "分类（可选）" : "Category (optional)" }
    if kind == .botRelay { return chinese ? "目标" : "Target" }
    if !chinese { return kind == .collaboration ? "Profiles, separated by commas" : kind == .cron ? "Schedule" : kind == .mcp ? "Server URL" : kind == .pairing ? "Pairing code" : kind == .profiles ? "Model" : kind == .environment ? "Value" : "Secret value" }
    switch kind {
    case .collaboration: return "Profile（用逗号分隔）"
    case .cron: return "计划表达式"
    case .mcp: return "服务器 URL"
    case .pairing: return "配对码"
    case .profiles: return "模型"
    case .environment: return "变量值"
    case .kanban: return "状态"
    default: return "密钥值"
    }
  }
  private var detailLabel: String {
    chinese ? (kind == .cron ? "任务提示词" : kind == .kanban ? "任务内容" : kind == .botRelay ? "消息" : "说明") : (kind == .cron ? "Prompt" : kind == .kanban ? "Task details" : kind == .botRelay ? "Message" : "Description")
  }
}

/// Native counterpart of the desktop ToolsetConfigPanel's declared-key form.
/// The server remains authoritative; this view submits the same environment API.
private struct HermesToolsetSchemaSheet: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let toolsetName: String
  let configJSON: String
  let onCancel: () -> Void
  let onSave: (String) -> Void
  @State private var values: [String: String]

  init(chinese: Bool, toolsetName: String, configJSON: String, onCancel: @escaping () -> Void, onSave: @escaping (String) -> Void) {
    self.chinese = chinese; self.toolsetName = toolsetName; self.configJSON = configJSON; self.onCancel = onCancel; self.onSave = onSave
    _values = State(initialValue: Self.initialValues(configJSON))
  }

  private var keys: [String] {
    guard let data = configJSON.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
    let rows = Self.declaredRows(object)
    return Array(Set(rows.compactMap { ($0["key"] as? String) ?? ($0["name"] as? String) ?? ($0["id"] as? String) })).sorted()
  }

  var body: some View {
    NavigationStack {
      Form {
        Section(chinese ? "声明式配置：\(toolsetName)" : "Declared configuration: \(toolsetName)") {
          if keys.isEmpty {
            Text(chinese ? "上游未声明可编辑字段，请使用 JSON 编辑器。" : "The upstream schema declares no editable fields; use the JSON editor instead.").foregroundStyle(appearance.palette.secondary)
          } else {
            ForEach(keys, id: \.self) { key in
              SecureField(key, text: Binding(get: { values[key, default: ""] }, set: { values[key] = $0 }))
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            }
          }
        }
      }
      .scrollContentBackground(.hidden).background(appearance.palette.background)
      .navigationTitle(chinese ? "工具集配置" : "Toolset configuration").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(chinese ? "取消" : "Cancel", action: onCancel) }
        ToolbarItem(placement: .confirmationAction) {
          Button(chinese ? "保存" : "Save") {
            guard let data = try? JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) else { return }; onSave(json)
          }.disabled(keys.isEmpty)
        }
      }
    }.presentationDetents([.medium, .large])
  }

  private static func initialValues(_ text: String) -> [String: String] {
    guard let data = text.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    let rows = declaredRows(object)
    return rows.reduce(into: [String: String]()) { result, row in
      let key = (row["key"] as? String) ?? (row["name"] as? String) ?? (row["id"] as? String)
      guard let key, !key.isEmpty else { return }
      // Never copy a redacted preview into an outgoing write; leaving it
      // blank preserves the already-stored secret on the server.
      result[key] = (row["value"] as? String) ?? ""
    }
  }

  private static func declaredRows(_ object: [String: Any]) -> [[String: Any]] {
    if let rows = object["env_vars"] as? [[String: Any]] { return rows }
    if let rows = object["fields"] as? [[String: Any]] { return rows }
    return (object["providers"] as? [[String: Any]] ?? []).flatMap { $0["env_vars"] as? [[String: Any]] ?? [] }
  }
}

private struct HermesRemoteRow<Trailing: View>: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let icon: String
  let iconData: String? = nil
  let title: String
  let detail: String
  let tint: Color
  @ViewBuilder let trailing: () -> Trailing

  var body: some View {
    HStack(spacing: 12) {
      if let iconData, let image = Self.image(from: iconData) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
          .frame(width: 26, height: 26)
          .clipShape(Circle())
          .overlay(Circle().stroke(tint.opacity(0.5), lineWidth: 1))
      } else {
        Image(systemName: icon).foregroundStyle(tint).frame(width: 26)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(HermesFonts.bodyBold(15))
        if !detail.isEmpty { Text(detail).font(HermesFonts.mono(10)).foregroundStyle(appearance.palette.secondary) }
      }
      Spacer()
      trailing()
    }.padding(.vertical, 4)
  }

  private static func image(from dataURL: String) -> UIImage? {
    guard let comma = dataURL.firstIndex(of: ","),
          let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) else { return nil }
    return UIImage(data: data)
  }
}

private struct HermesSessionsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let sessions: [HermesSessionSnapshot]
  let sessionContext: HermesSessionContextSnapshot?
  let sessionSidebarJSON: String?
  let sessionProjectsJSON: String?
  let sessionPullRequestsJSON: String?
  let sessionStatsJSON: String?
  let onAction: HermesRouteActionSink
  @State private var search = ""
  @State private var renameTarget: HermesSessionSnapshot?
  @State private var renameText = ""
  @State private var selectedForBulk = Set<String>()
  @State private var importingSessions = false
  @State private var importedSessionsJSON = "[]"

  private var filtered: [HermesSessionSnapshot] {
    guard !search.isEmpty else { return sessions }
    return sessions.filter { $0.title.localizedCaseInsensitiveContains(search) }
  }

  private var sessionsList: some View {
    List {
      if let context = sessionContext {
        Section {
          LabeledContent(chinese ? "当前会话" : "Current session") {
            Text(context.sessionId)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.secondary)
              .textSelection(.enabled)
              .lineLimit(1)
          }
          LabeledContent(chinese ? "上下文 Token" : "Context tokens") {
            Text(context.messageTokens.formatted())
              .font(HermesFonts.mono(12))
          }
          VStack(alignment: .leading, spacing: 5) {
            Text(chinese ? "Token 明细" : "Token breakdown")
              .font(HermesFonts.bodyBold(13))
            Text(
              "in \(context.inputTokens.formatted())  ·  out \(context.outputTokens.formatted())"
              + "  ·  cache \((context.cacheReadTokens + context.cacheWriteTokens).formatted())"
              + "  ·  reasoning \(context.reasoningTokens.formatted())"
            )
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
          }
          LabeledContent(chinese ? "消息" : "Messages") {
            Text("\(context.activeMessages) / \(context.archivedMessages)")
              .font(HermesFonts.mono(12))
          }
          LabeledContent(chinese ? "谱系" : "Lineage") {
            Text(
              chinese
                ? "父 \(context.parentCount) · 子 \(context.childCount)"
                : "\(context.parentCount) parent · \(context.childCount) children"
            )
            .font(HermesFonts.mono(11))
          }
          LabeledContent(chinese ? "上下文压缩" : "Compaction") {
            Text(
              context.compressionInProgress
                ? (chinese ? "进行中" : "In progress")
                : "\(context.compressionCount)"
            )
            .font(HermesFonts.mono(11))
            .foregroundStyle(
              context.compressionInProgress
                ? appearance.palette.accent
                : appearance.palette.secondary
            )
          }
          Button {
            onAction(
              .sessionCompress,
              HermesRouteActionPayload(
                route: "sessions",
                id: context.conversationId,
                requestId: "session-compress-\(UUID().uuidString.lowercased())",
                fields: ["profile": context.profile]
              )
            )
          } label: {
            Label(chinese ? "手动压缩上下文" : "Compact context", systemImage: "rectangle.compress.vertical")
          }
          .disabled(context.compressionInProgress)
        } header: {
          Text(chinese ? "上下文状态" : "Context status")
            .font(HermesFonts.condensed(12))
        }

        if !context.compressionLineage.isEmpty {
          Section(chinese ? "压缩边界" : "Compaction boundaries") {
            ForEach(Array(context.compressionLineage.enumerated()), id: \.offset) { _, boundary in
              Label {
                Text(boundary)
                  .font(HermesFonts.mono(10))
                  .textSelection(.enabled)
                  .lineLimit(1)
              } icon: {
                Image(systemName: "rectangle.compress.vertical")
                  .foregroundStyle(appearance.palette.accent)
              }
            }
          }
        }

        if !context.lineage.isEmpty {
          Section(chinese ? "会话谱系" : "Session lineage") {
            ForEach(context.lineage) { item in
              HStack(spacing: 10) {
                Image(systemName: item.current ? "scope" : "point.3.connected.trianglepath.dotted")
                  .foregroundStyle(item.current ? appearance.palette.accent : appearance.palette.secondary)
                  .frame(width: 24)
                VStack(alignment: .leading, spacing: 3) {
                  Text(item.title)
                    .font(HermesFonts.bodyBold(13))
                    .lineLimit(1)
                  Text("\(item.model) · \(item.messageCount) msg · \(item.toolCallCount) tools")
                    .font(HermesFonts.mono(10))
                    .foregroundStyle(appearance.palette.secondary)
                }
                Spacer()
                if item.current {
                  HermesStatusPill(text: chinese ? "当前" : "Current")
                }
              }
            }
          }
        }

        if !context.branchableMessages.isEmpty {
          Section {
            ForEach(context.branchableMessages) { message in
              Button {
                onAction(
                  .sessionFork,
                  HermesRouteActionPayload(
                    route: "sessions",
                    id: context.conversationId,
                    detail: message.messageId,
                    requestId: "session-fork-\(UUID().uuidString.lowercased())",
                    fields: ["profile": context.profile]
                  )
                )
              } label: {
                HStack(spacing: 10) {
                  Image(systemName: message.role == "user" ? "person.crop.circle" : "sparkles")
                    .foregroundStyle(appearance.palette.accent)
                    .frame(width: 24)
                  VStack(alignment: .leading, spacing: 3) {
                    Text(message.role.capitalized)
                      .font(HermesFonts.bodyBold(13))
                    Text("#\(message.runtimeMessageId) · \(message.messageId)")
                      .font(HermesFonts.mono(10))
                      .foregroundStyle(appearance.palette.secondary)
                      .lineLimit(1)
                  }
                  Spacer()
                  Image(systemName: "arrow.triangle.branch")
                    .foregroundStyle(appearance.palette.accent)
                }
                .padding(.vertical, 3)
              }
              .buttonStyle(.plain)
            }
          } footer: {
            Text(
              chinese
                ? "从选定消息创建新的 Hermes 分支，会话会出现在最近会话中。"
                : "Create a new Hermes branch from a message; it will appear in Recent Sessions."
            )
          }
        }
      }

      if let sidebar = sessionSidebarJSON, !sidebar.isEmpty {
        Section(chinese ? "官方会话侧栏" : "Official session sidebar") {
          Text(sidebar)
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
            .textSelection(.enabled)
            .lineLimit(8)
        }
      }
      if let projects = sessionProjectsJSON, !projects.isEmpty {
        Section(chinese ? "项目树" : "Project tree") {
          Text(projects)
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
            .textSelection(.enabled)
            .lineLimit(12)
          Button {
            onAction(.sessionProjects, HermesRouteActionPayload(route: "sessions"))
          } label: {
            Label(chinese ? "刷新项目树" : "Refresh project tree", systemImage: "folder.badge.gearshape")
          }
        }
      }
      if let pullRequests = sessionPullRequestsJSON, !pullRequests.isEmpty {
        Section(chinese ? "会话 Pull Requests" : "Session pull requests") {
          Text(pullRequests)
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
            .textSelection(.enabled)
            .lineLimit(12)
          Button {
            onAction(.sessionPullRequests, HermesRouteActionPayload(route: "sessions"))
          } label: {
            Label(chinese ? "重新扫描 PR" : "Rescan pull requests", systemImage: "arrow.triangle.branch")
          }
        }
      }
      if let stats = sessionStatsJSON, !stats.isEmpty {
        Section(chinese ? "会话统计" : "Session statistics") {
          Text(stats)
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
            .textSelection(.enabled)
            .lineLimit(8)
        }
      }

      Section {
        ForEach(filtered) { session in
          Button {
            onAction(
              .sessionOpen,
              HermesRouteActionPayload(
                route: "sessions",
                id: session.id,
                fields: session.profile.map { ["profile": $0] }
              )
            )
          } label: {
            HStack(spacing: 12) {
              Image(systemName: session.running ? "waveform" : "bubble.left")
                .foregroundStyle(session.running ? appearance.palette.success : appearance.palette.secondary)
                .frame(width: 26)
              VStack(alignment: .leading, spacing: 4) {
                Text(session.title)
                  .font(HermesFonts.bodyBold(15))
                Text("\(session.model) · \(session.date)")
                  .font(HermesFonts.mono(10))
                  .foregroundStyle(appearance.palette.secondary)
              }
              Spacer()
              if session.pinned == true {
                Image(systemName: "pin.fill")
                  .foregroundStyle(appearance.palette.accent)
                  .accessibilityLabel(chinese ? "已置顶" : "Pinned")
              }
              if session.unread == true {
                HermesStatusPill(text: chinese ? "未读" : "Unread", color: appearance.palette.warning)
              }
              if session.archived == true {
                HermesStatusPill(text: chinese ? "已归档" : "Archived", color: appearance.palette.tertiary)
              }
              if session.running {
                HermesStatusPill(text: chinese ? "运行中" : "Running")
              }
            }
            .padding(.vertical, 4)
          }
          .buttonStyle(.plain)
          .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
              onAction(
                .sessionDelete,
                HermesRouteActionPayload(
                  route: "sessions",
                  id: session.id,
                  fields: session.profile.map { ["profile": $0] }
                )
              )
            } label: {
              Label(chinese ? "删除" : "Delete", systemImage: "trash")
            }
            Button {
              renameText = session.title
              renameTarget = session
            } label: {
              Label(chinese ? "重命名" : "Rename", systemImage: "pencil")
            }
            .tint(appearance.palette.accent)
          }
          .contextMenu {
            Button {
              if selectedForBulk.contains(session.id) {
                selectedForBulk.remove(session.id)
              } else {
                selectedForBulk.insert(session.id)
              }
            } label: {
              Label(
                selectedForBulk.contains(session.id)
                  ? (chinese ? "移出批量选择" : "Remove from bulk selection")
                  : (chinese ? "加入批量选择" : "Add to bulk selection"),
                systemImage: selectedForBulk.contains(session.id) ? "checkmark.circle" : "checkmark.circle.badge.plus"
              )
            }
            Button {
              onAction(
                .sessionSelect,
                HermesRouteActionPayload(
                  route: "sessions",
                  id: session.id,
                  fields: session.profile.map { ["profile": $0] }
                )
              )
            } label: {
              Label(chinese ? "上下文与谱系" : "Context & Lineage", systemImage: "point.3.connected.trianglepath.dotted")
            }
            Button {
              renameText = session.title
              renameTarget = session
            } label: {
              Label(chinese ? "重命名" : "Rename", systemImage: "pencil")
            }
            Button(role: .destructive) {
              onAction(
                .sessionDelete,
                HermesRouteActionPayload(
                  route: "sessions",
                  id: session.id,
                  fields: session.profile.map { ["profile": $0] }
                )
              )
            } label: {
              Label(chinese ? "删除会话" : "Delete Session", systemImage: "trash")
            }
            Button {
              onAction(
                .sessionExport,
                HermesRouteActionPayload(
                  route: "sessions",
                  id: session.id,
                  fields: session.profile.map { ["profile": $0] }
                )
              )
            } label: {
              Label(chinese ? "导出会话" : "Export session", systemImage: "square.and.arrow.up")
            }
            Button {
              onAction(.sessionPin, HermesRouteActionPayload(route: "sessions", id: session.id, enabled: session.pinned != true, fields: session.profile.map { ["profile": $0] }))
            } label: {
              Label(session.pinned == true ? (chinese ? "取消置顶" : "Unpin") : (chinese ? "置顶" : "Pin"), systemImage: "pin")
            }
            Button {
              onAction(.sessionUnread, HermesRouteActionPayload(route: "sessions", id: session.id, enabled: session.unread != true, fields: session.profile.map { ["profile": $0] }))
            } label: {
              Label(session.unread == true ? (chinese ? "标为已读" : "Mark read") : (chinese ? "标为未读" : "Mark unread"), systemImage: "envelope.badge")
            }
            Button {
              onAction(.sessionArchive, HermesRouteActionPayload(route: "sessions", id: session.id, enabled: session.archived != true, fields: session.profile.map { ["profile": $0] }))
            } label: {
              Label(session.archived == true ? (chinese ? "取消归档" : "Unarchive") : (chinese ? "归档" : "Archive"), systemImage: "archivebox")
            }
          }
        }
      } header: {
        Text(chinese ? "最近会话" : "Recent Sessions")
          .font(HermesFonts.condensed(12))
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
  }

  var body: some View {
    sessionsList
    .searchable(text: $search, prompt: chinese ? "搜索会话" : "Search sessions")
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        Menu {
          Button {
            onAction(.sessionDeleteEmpty, HermesRouteActionPayload(route: "sessions"))
          } label: {
            Label(chinese ? "清理空会话" : "Delete empty sessions", systemImage: "trash.slash")
          }
          Button {
            let ids = Array(selectedForBulk)
            guard !ids.isEmpty else { return }
            onAction(.sessionBulkDelete, HermesRouteActionPayload(route: "sessions", detail: (try? String(data: JSONEncoder().encode(ids), encoding: .utf8)) ?? "[]"))
            selectedForBulk.removeAll()
          } label: {
            Label(chinese ? "删除已选会话（" + String(selectedForBulk.count) + "）" : "Delete selected sessions (" + String(selectedForBulk.count) + ")", systemImage: "trash")
          }
          .disabled(selectedForBulk.isEmpty)
          Button {
            importingSessions = true
          } label: {
            Label(chinese ? "导入会话 JSON" : "Import sessions JSON", systemImage: "square.and.arrow.down")
          }
        } label: {
          Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel(chinese ? "会话操作" : "Session actions")
      }
    }
    .refreshable {
      onAction(.refresh, HermesRouteActionPayload(route: "sessions"))
    }
    .sheet(item: $renameTarget) { target in
      NavigationStack {
        Form {
          TextField(chinese ? "会话名称" : "Session name", text: $renameText)
            .submitLabel(.done)
            .onSubmit { dismissHermesKeyboard() }
        }
        .navigationTitle(chinese ? "重命名会话" : "Rename Session")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(chinese ? "取消" : "Cancel") {
              dismissHermesKeyboard()
              renameTarget = nil
            }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(chinese ? "保存" : "Save") {
              dismissHermesKeyboard()
              onAction(
                .sessionRename,
                HermesRouteActionPayload(
                  route: "sessions",
                  id: target.id,
                  name: renameText,
                  fields: target.profile.map { ["profile": $0] }
                )
              )
              renameTarget = nil
            }
          }
        }
      }
      .presentationDetents([.medium])
    }
    .sheet(isPresented: $importingSessions) {
      NavigationStack {
        Form {
          Section(chinese ? "粘贴官方导出 JSON 数组" : "Paste the official exported JSON array") {
            TextEditor(text: $importedSessionsJSON)
              .font(HermesFonts.mono(11))
              .frame(minHeight: 220)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
          }
        }
        .navigationTitle(chinese ? "导入会话" : "Import sessions")
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(chinese ? "取消" : "Cancel") { importingSessions = false }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(chinese ? "导入" : "Import") {
              onAction(.sessionImport, HermesRouteActionPayload(route: "sessions", detail: importedSessionsJSON))
              importingSessions = false
            }
          }
        }
      }
      .presentationDetents([.medium, .large])
    }
  }
}

private enum HermesFileSourceFilter: String, CaseIterable, Identifiable {
  case all
  case model
  case user

  var id: String { rawValue }
}

private struct HermesFileSection: Identifiable {
  let id: String
  let files: [HermesFileSnapshot]
  let timestamp: Double
}

private enum HermesFileImportStaging {
  private static let directoryName = "HermesFileImports"
  private static let defaultMaximumFileBytes = 64 * 1024 * 1024
  private static let maximumBatchBytes = 128 * 1024 * 1024
  private static let maximumAge: TimeInterval = 24 * 60 * 60

  static func stage(
    _ sourceURLs: [URL],
    maximumFileBytes: Int = defaultMaximumFileBytes
  ) -> [URL] {
    cleanupExpiredBatches()
    guard !sourceURLs.isEmpty, let root = stagingRoot() else { return [] }

    let batch = root.appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
    do {
      try FileManager.default.createDirectory(
        at: batch,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
    } catch {
      return []
    }

    var remainingBudget = maximumBatchBytes
    var staged: [URL] = []
    for sourceURL in sourceURLs {
      guard remainingBudget > 0,
            let destination = stage(
              sourceURL,
              in: batch,
              remainingBudget: remainingBudget,
              maximumFileBytes: min(defaultMaximumFileBytes, max(1, maximumFileBytes))
            )
      else { continue }
      if let size = fileSize(at: destination) {
        remainingBudget -= size
      }
      staged.append(destination)
    }
    if staged.isEmpty { try? FileManager.default.removeItem(at: batch) }
    scheduleCleanup()
    return staged
  }

  private static func stage(
    _ sourceURL: URL,
    in batch: URL,
    remainingBudget: Int,
    maximumFileBytes: Int
  ) -> URL? {
    let hasSecurityScope = sourceURL.startAccessingSecurityScopedResource()
    defer {
      if hasSecurityScope { sourceURL.stopAccessingSecurityScopedResource() }
    }
    // Fail closed when a provider hides its size: coordinated copies can be
    // arbitrarily large and must not run on the caller's UI thread.
    guard let size = fileSize(at: sourceURL),
          size > 0,
          size <= maximumFileBytes,
          size <= remainingBudget
    else {
      return nil
    }

    let requestedName = sourceURL.lastPathComponent
    let fileName = requestedName.isEmpty || requestedName == "." || requestedName == ".."
      ? "attachment"
      : requestedName
    let destination = uniqueDestination(named: fileName, in: batch)
    var coordinationError: NSError?
    var copyError: Error?
    var copied = false
    NSFileCoordinator().coordinate(
      readingItemAt: sourceURL,
      options: [],
      error: &coordinationError
    ) { readableURL in
      do {
        try FileManager.default.copyItem(at: readableURL, to: destination)
        copied = true
      } catch {
        copyError = error
      }
    }
    guard coordinationError == nil, copyError == nil, copied else {
      try? FileManager.default.removeItem(at: destination)
      return nil
    }
    return destination
  }

  private static func fileSize(at url: URL) -> Int? {
    (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
      ?? (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? nil
  }

  private static func stagingRoot() -> URL? {
    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      return nil
    }
    let root = caches.appendingPathComponent(directoryName, isDirectory: true)
    do {
      try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
      return root
    } catch {
      return nil
    }
  }

  private static func uniqueDestination(named name: String, in batch: URL) -> URL {
    let initial = batch.appendingPathComponent(name, isDirectory: false)
    guard FileManager.default.fileExists(atPath: initial.path) else { return initial }
    let source = initial.deletingPathExtension().lastPathComponent
    let extensionName = initial.pathExtension
    let uniqueName = extensionName.isEmpty
      ? "\(source)-\(UUID().uuidString.lowercased())"
      : "\(source)-\(UUID().uuidString.lowercased()).\(extensionName)"
    return batch.appendingPathComponent(uniqueName, isDirectory: false)
  }

  private static func cleanupExpiredBatches(now: Date = Date()) {
    guard let root = stagingRoot(),
          let batches = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey, .creationDateKey],
            options: [.skipsHiddenFiles]
          ) else { return }
    for batch in batches {
      let values = try? batch.resourceValues(forKeys: [.contentModificationDateKey, .creationDateKey])
      let timestamp = values?.contentModificationDate ?? values?.creationDate ?? .distantPast
      if now.timeIntervalSince(timestamp) >= maximumAge {
        try? FileManager.default.removeItem(at: batch)
      }
    }
  }

  private static func scheduleCleanup() {
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + maximumAge) {
      cleanupExpiredBatches()
    }
  }
}

private struct HermesManagedFileEntry: Decodable, Identifiable {
  let name: String
  let path: String
  let isDirectory: Bool
  let size: Int?
  let mtime: Double
  let mimeType: String?

  var id: String { path }

  enum CodingKeys: String, CodingKey {
    case name
    case path
    case isDirectory = "is_directory"
    case size
    case mtime
    case mimeType = "mime_type"
  }
}

private struct HermesManagedFilesResponse: Decodable {
  let root: String?
  let path: String
  let parent: String?
  let lockedRoot: String?
  let canChangePath: Bool
  let entries: [HermesManagedFileEntry]

  enum CodingKeys: String, CodingKey {
    case root
    case path
    case parent
    case lockedRoot = "locked_root"
    case canChangePath = "can_change_path"
    case entries
  }

  static func decode(_ json: String?) -> HermesManagedFilesResponse? {
    guard let json, let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(HermesManagedFilesResponse.self, from: data)
  }
}

private struct HermesFilesPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let files: [HermesFileSnapshot]
  let accountFilesJSON: String?
  let managedFilesJSON: String?
  let onAction: HermesRouteActionSink
  @State private var search = ""
  @State private var importerOpen = false
  @State private var managedImporterOpen = false
  @State private var managedMode = false
  @State private var managedPathInput = ""
  @State private var folderCreateOpen = false
  @State private var folderPath = ""
  @State private var filterByDate = false
  @State private var selectedDate = Date()
  @State private var sourceFilter = HermesFileSourceFilter.all

  private var managedListing: HermesManagedFilesResponse? {
    HermesManagedFilesResponse.decode(managedFilesJSON)
  }

  private var filtered: [HermesFileSnapshot] {
    files.filter { file in
      let matchesSearch = search.isEmpty
        || file.name.localizedCaseInsensitiveContains(search)
        || file.detail.localizedCaseInsensitiveContains(search)
      let matchesSource = switch sourceFilter {
      case .all: true
      case .model: file.source == "model_output"
      case .user: file.source == "user_upload"
      }
      let matchesDate: Bool
      if filterByDate, let timestamp = file.createdAt {
        matchesDate = Calendar.current.isDate(
          Date(timeIntervalSince1970: timestamp / 1000),
          inSameDayAs: selectedDate
        )
      } else {
        matchesDate = !filterByDate
      }
      return matchesSearch && matchesSource && matchesDate
    }
  }

  private var sections: [HermesFileSection] {
    Dictionary(grouping: filtered) { $0.dateLabel ?? (chinese ? "未知日期" : "Unknown Date") }
      .map { label, entries in
        HermesFileSection(
          id: label,
          files: entries.sorted { ($0.createdAt ?? 0) > ($1.createdAt ?? 0) },
          timestamp: entries.map { $0.createdAt ?? 0 }.max() ?? 0
        )
      }
      .sorted { $0.timestamp > $1.timestamp }
  }

  @ViewBuilder
  private var managedContent: some View {
    let listing = managedListing
    List {
      Section(chinese ? "托管工作区" : "Managed workspace") {
        HStack(spacing: 8) {
          TextField(
            chinese ? "服务器路径" : "Server path",
            text: $managedPathInput
          )
          .font(HermesFonts.mono(12))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          Button(chinese ? "打开" : "Open") {
            let path = managedPathInput.trimmingCharacters(in: .whitespacesAndNewlines)
            onAction(.managedFilesOpen, HermesRouteActionPayload(route: "files", value: path))
          }
          .buttonStyle(.borderedProminent)
          .disabled(managedPathInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        if let lockedRoot = listing?.lockedRoot, !lockedRoot.isEmpty {
          Text(chinese ? "锁定根目录：\(lockedRoot)" : "Locked root: \(lockedRoot)")
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
        }
      }
      if let listing {
        if let parent = listing.parent {
          Button {
            managedPathInput = parent
            onAction(.managedFilesOpen, HermesRouteActionPayload(route: "files", value: parent))
          } label: {
            Label(chinese ? "返回上级" : "Parent directory", systemImage: "arrow.up")
          }
        }
        if listing.entries.isEmpty {
          ContentUnavailableView(
            chinese ? "目录为空" : "Directory is empty",
            systemImage: "folder",
            description: Text(listing.path)
          )
        } else {
          Section(listing.path) {
            ForEach(listing.entries) { entry in
              HStack(spacing: 10) {
                Image(systemName: entry.isDirectory ? "folder" : "doc")
                  .foregroundStyle(entry.isDirectory ? appearance.palette.warning : appearance.palette.primary)
                Button {
                  if entry.isDirectory {
                    managedPathInput = entry.path
                    onAction(.managedFilesOpen, HermesRouteActionPayload(route: "files", value: entry.path))
                  } else {
                    onAction(.managedFileDownload, HermesRouteActionPayload(route: "files", id: entry.path, name: entry.name, value: entry.path))
                  }
                } label: {
                  VStack(alignment: .leading, spacing: 3) {
                    Text(entry.name).font(HermesFonts.bodyBold(14))
                    Text(entry.path).font(HermesFonts.mono(10)).foregroundStyle(appearance.palette.secondary)
                  }
                  .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                if !entry.isDirectory {
                  Button {
                    onAction(.managedFileDownload, HermesRouteActionPayload(route: "files", id: entry.path, name: entry.name, value: entry.path))
                  } label: {
                    Image(systemName: "arrow.down.circle")
                  }
                  .buttonStyle(.borderless)
                }
                Button(role: .destructive) {
                  onAction(.managedFileDelete, HermesRouteActionPayload(route: "files", id: entry.path, value: entry.path, enabled: entry.isDirectory))
                } label: {
                  Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
              }
              .padding(.vertical, 5)
            }
          }
        }
      } else {
        ContentUnavailableView(
          chinese ? "托管工作区不可用" : "Managed workspace unavailable",
          systemImage: "externaldrive.badge.questionmark",
          description: Text(chinese ? "请检查服务器版本和权限。" : "Check the server version and permissions.")
        )
      }
    }
    .hermesListStyle()
    .background(appearance.palette.background)
    .refreshable {
      let path = listing?.path ?? managedPathInput
      onAction(.managedFilesOpen, HermesRouteActionPayload(route: "files", value: path))
    }
    .toolbar {
      ToolbarItemGroup(placement: .navigationBarTrailing) {
        Button {
          managedImporterOpen = true
        } label: {
          Label(chinese ? "上传文件" : "Upload file", systemImage: "square.and.arrow.up")
        }
        .disabled((listing?.path ?? managedPathInput).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        Button {
          folderPath = listing?.path ?? managedPathInput
          folderCreateOpen = true
        } label: {
          Label(chinese ? "新建文件夹" : "New folder", systemImage: "folder.badge.plus")
        }
        .disabled((listing?.path ?? managedPathInput).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
  }

  var body: some View {
    let content = List {
      if sections.isEmpty {
        ContentUnavailableView(
          LocalizedStringKey(
            search.isEmpty
              ? (chinese ? "暂无云端文件" : "No Cloud Files")
              : (chinese ? "没有匹配的文件" : "No Matching Files")
          ),
          systemImage: search.isEmpty ? "icloud" : "doc.text.magnifyingglass"
        )
      }
      ForEach(sections) { section in
        Section(section.id) {
          ForEach(section.files) { file in
          Button {
            guard file.status == "available" else { return }
            onAction(
              .fileDownload,
              HermesRouteActionPayload(route: "files", id: file.id, name: file.name)
            )
          } label: {
            HStack(spacing: 12) {
              Image(systemName: symbol(for: file))
                .foregroundStyle(file.source == "model_output" ? appearance.palette.accent : appearance.palette.primary)
                .frame(width: 26)
              VStack(alignment: .leading, spacing: 3) {
                Text(file.name).font(HermesFonts.bodyBold(15))
                Text(file.detail)
                  .font(HermesFonts.body(11))
                  .foregroundStyle(appearance.palette.secondary)
                Label(
                  file.source == "model_output"
                    ? (chinese ? "Hermes 生成" : "Generated by Hermes")
                    : (chinese ? "用户上传" : "Uploaded by User"),
                  systemImage: file.source == "model_output" ? "sparkles" : "person.crop.circle"
                )
                .font(HermesFonts.body(10))
                .foregroundStyle(appearance.palette.secondary)
              }
              Spacer()
              if file.status == "uploading" {
                ProgressView().controlSize(.small)
              } else if file.status == "failed" {
                Image(systemName: "exclamationmark.circle.fill")
                  .foregroundStyle(appearance.palette.destructive)
              } else {
                Image(systemName: "chevron.right")
                  .font(.caption.weight(.semibold))
                  .foregroundStyle(appearance.palette.secondary.opacity(0.6))
              }
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .swipeActions {
            Button(role: .destructive) {
              onAction(
                .fileDelete,
                HermesRouteActionPayload(route: "files", id: file.id)
              )
            } label: {
              Label(chinese ? "删除" : "Delete", systemImage: "trash")
            }
            if file.status == "available" {
              Button {
                onAction(
                  .fileShare,
                  HermesRouteActionPayload(route: "files", id: file.id, name: file.name)
                )
              } label: {
                Label(chinese ? "分享" : "Share", systemImage: "square.and.arrow.up")
              }
              .tint(appearance.palette.primary)
            }
          }
        }
      }
    }
    }
    let searchableContent = content
      .hermesListStyle()
    .background(appearance.palette.background)
    .searchable(text: $search, prompt: chinese ? "搜索文件" : "Search files")
    .refreshable {
      onAction(.refresh, HermesRouteActionPayload(route: "files"))
    }
    let toolbarContent = searchableContent
      .toolbar {
      ToolbarItemGroup(placement: .navigationBarTrailing) {
        Menu {
          Picker(chinese ? "来源" : "Source", selection: $sourceFilter) {
            Text(chinese ? "全部" : "All").tag(HermesFileSourceFilter.all)
            Text(chinese ? "用户上传" : "User Uploads").tag(HermesFileSourceFilter.user)
            Text(chinese ? "模型生成" : "Model Outputs").tag(HermesFileSourceFilter.model)
          }
          Toggle(chinese ? "按日期筛选" : "Filter by Date", isOn: $filterByDate)
          if filterByDate {
            DatePicker(
              chinese ? "日期" : "Date",
              selection: $selectedDate,
              displayedComponents: .date
            )
          }
        } label: {
          Label(chinese ? "筛选" : "Filter", systemImage: "line.3.horizontal.decrease.circle")
        }
        Button {
          importerOpen = true
        } label: {
          Label(chinese ? "导入文件" : "Import file", systemImage: "square.and.arrow.down")
        }
        Button {
          folderPath = managedMode ? (managedListing?.path ?? managedPathInput) : ""
          folderCreateOpen = true
        } label: {
          Label(chinese ? "新建文件夹" : "New folder", systemImage: "folder.badge.plus")
        }
      }
    }
    return Group {
      if managedMode {
        managedContent
      } else {
        HermesAccountFilesPagedContent(
          chinese: chinese,
          initialFiles: files,
          pageJSON: accountFilesJSON,
          onAction: onAction,
          onImport: { importerOpen = true },
          onCreateFolder: {
            folderPath = ""
            folderCreateOpen = true
          }
        )
      }
    }
      .safeAreaInset(edge: .top, spacing: 0) {
        Picker(chinese ? "文件范围" : "File scope", selection: $managedMode) {
          Text(chinese ? "云端文件" : "Cloud files").tag(false)
          Text(chinese ? "托管工作区" : "Managed workspace").tag(true)
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(appearance.palette.background)
      }
      .onAppear {
        if managedPathInput.isEmpty { managedPathInput = managedListing?.path ?? "" }
      }
      .fileImporter(isPresented: $importerOpen, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
      if case let .success(urls) = result {
        DispatchQueue.global(qos: .userInitiated).async {
          let stagedURLs = HermesFileImportStaging.stage(urls)
          guard !stagedURLs.isEmpty else { return }
          DispatchQueue.main.async {
            onAction(
              .fileImport,
              HermesRouteActionPayload(
                route: "files",
                requestId: "file-import-\(UUID().uuidString.lowercased())",
                fields: ["stagedImport": "true"],
                uris: stagedURLs.map(\.absoluteString)
              )
            )
          }
        }
      }
      }
      .fileImporter(isPresented: $managedImporterOpen, allowedContentTypes: [.data], allowsMultipleSelection: true) { result in
        guard case let .success(urls) = result else { return }
        let path = (managedListing?.path ?? managedPathInput).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else { return }
        DispatchQueue.global(qos: .userInitiated).async {
          let stagedURLs = HermesFileImportStaging.stage(urls)
          guard !stagedURLs.isEmpty else { return }
          DispatchQueue.main.async {
            onAction(
              .managedFileImport,
              HermesRouteActionPayload(
                route: "files",
                value: path,
                requestId: "managed-file-import-\(UUID().uuidString.lowercased())",
                fields: ["stagedImport": "true"],
                uris: stagedURLs.map(\.absoluteString)
              )
            )
          }
        }
      }
      .sheet(isPresented: $folderCreateOpen) {
        NavigationStack {
          Form {
            Section {
              TextField(
                chinese ? "服务器文件夹路径" : "Server folder path",
                text: $folderPath
              )
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .keyboardType(.URL)
            } header: {
              Text(chinese ? "托管工作区" : "Managed workspace")
            } footer: {
              Text(chinese
                ? "填写 Hermes 服务器上的路径，例如 workspace/results。创建操作直接调用官方 /api/files/mkdir。"
                : "Enter a path on the Hermes server, for example workspace/results. This calls the official /api/files/mkdir contract directly.")
            }
          }
          .scrollContentBackground(.hidden)
          .background(appearance.palette.background)
          .navigationTitle(chinese ? "新建文件夹" : "New folder")
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button(chinese ? "取消" : "Cancel") {
                folderCreateOpen = false
              }
            }
            ToolbarItem(placement: .confirmationAction) {
              Button(chinese ? "创建" : "Create") {
                let path = folderPath.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !path.isEmpty else { return }
                onAction(
                  .folderCreate,
                  HermesRouteActionPayload(route: "files", value: path)
                )
                folderCreateOpen = false
              }
              .disabled(folderPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
          }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
      }
  }

  private func symbol(for file: HermesFileSnapshot) -> String {
    switch file.fileType {
    case "image": "photo"
    case "video": "film"
    case "audio": "waveform"
    case "archive": "archivebox"
    case "code": "chevron.left.forwardslash.chevron.right"
    case "document": "doc.text"
    default: "doc"
    }
  }
}

private struct HermesAnalyticsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let analytics: HermesAnalyticsSnapshot
  let chinese: Bool
  let renderChart: Bool
  let onAction: HermesRouteActionSink

  private var points: [HermesAnalyticsPointSnapshot] { analytics.points }

  var body: some View {
    HermesPage(subtitle: chinese ? "令牌使用、费用和模型活动" : "Token usage, cost, and model activity") {
      Grid(horizontalSpacing: 12, verticalSpacing: 12) {
        GridRow {
          HermesMetric(title: chinese ? "输入令牌" : "Input Tokens", value: analytics.inputTokens, symbol: "arrow.down.circle")
          HermesMetric(title: chinese ? "输出令牌" : "Output Tokens", value: analytics.outputTokens, symbol: "arrow.up.circle", tint: appearance.palette.primary)
        }
        GridRow {
          HermesMetric(title: chinese ? "本月费用" : "Monthly Cost", value: analytics.monthlyCost, symbol: "dollarsign.circle", tint: appearance.palette.warning)
          HermesMetric(title: chinese ? "成功率" : "Success Rate", value: analytics.successRate, symbol: "checkmark.seal", tint: appearance.palette.success)
        }
      }

      HermesPanel {
        VStack(alignment: .leading, spacing: 14) {
          Text(chinese ? "最近 7 天" : "Last 7 Days")
            .font(HermesFonts.display(15))
          if renderChart {
            Chart(points) { point in
              LineMark(x: .value("Day", point.label), y: .value("Input", point.input))
                .foregroundStyle(appearance.palette.accent)
                .interpolationMethod(.catmullRom)
              AreaMark(x: .value("Day", point.label), y: .value("Input", point.input))
                .foregroundStyle(appearance.palette.accent.opacity(0.12))
                .interpolationMethod(.catmullRom)
              LineMark(x: .value("Day", point.label), y: .value("Output", point.output))
                .foregroundStyle(appearance.palette.primary)
                .interpolationMethod(.catmullRom)
            }
            .chartLegend(.hidden)
            .frame(height: 240)
          } else {
            Color.clear
              .frame(height: 240)
              .accessibilityHidden(true)
          }
        }
      }
    }
    .refreshable {
      onAction(.refresh, HermesRouteActionPayload(route: "analytics"))
    }
  }
}

private struct HermesModelsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let detectedModels: [String]
  let models: [HermesModelSnapshot]
  let auxiliary: HermesModelAuxiliarySnapshot
  let moa: HermesModelMoaSnapshot
  let modelMoaJSON: String?
  let providerOauthJSON: String?
  let providerOauthPendingJSON: String?
  let credentialPoolJSON: String?
  let customProviderEndpointsJSON: String?
  let confirmation: HermesModelConfirmationSnapshot?
  let operation: HermesRouteOperationSnapshot?
  let onAction: HermesRouteActionSink
  @State private var apiKey = ""
  @State private var apiKeyAction = "preserve"
  @State private var apiMode = "chat_completions"
  @State private var baseUrl = ""
  @State private var contextLength = "131072"
  @State private var displayedDetectedModels: [String] = []
  @State private var detectedModelsExpanded = false
  @State private var modelName = ""
  @State private var reasoningEffort = "none"
  @State private var presentedConfirmation: HermesModelConfirmationSnapshot?
  @State private var providerOauthID = ""
  @State private var providerOauthCode = ""
  @State private var moaEditorJSON = ""
  @FocusState private var moaEditorFocused: Bool
  @State private var credentialProvider = ""
  @State private var credentialLabel = ""
  @State private var credentialKey = ""
  @State private var customEndpointJSON = "{}"
  @State private var customEndpointID = ""

  private var configuration: HermesModelSnapshot? {
    models.first { $0.provider == "custom" && !$0.baseUrl.isEmpty }
  }
  private var fields: [String: String] {
    [
      "apiKey": apiKey,
      "apiKeyAction": apiKeyAction,
      "apiMode": apiMode,
      "baseUrl": baseUrl,
      "contextLength": contextLength,
      "model": modelName,
      "reasoningEffort": reasoningEffort
    ]
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        availableModelsPanel
        auxiliaryPanel
        customModelPanel
        providerConnectionsPanel
        credentialPoolPanel
        customProviderEndpointsPanel
      }
      .padding(14)
    }
    .background(appearance.palette.background)
    .refreshable {
      onAction(.refresh, HermesRouteActionPayload(route: "models"))
    }
    .onAppear {
      apply(configuration)
      displayedDetectedModels = detectedModels
      moaEditorJSON = modelMoaJSON ?? "{}"
    }
    .onAppear { presentedConfirmation = confirmation }
    .onChange(of: configuration) { _, next in apply(next) }
    .onChange(of: detectedModels) { _, next in
      displayedDetectedModels = next
      if let first = next.first, !next.contains(modelName) { modelName = first }
      if !next.isEmpty { detectedModelsExpanded = true }
    }
    .onChange(of: baseUrl) { _, next in
      if next != (configuration?.baseUrl ?? "") { invalidateDetectedModels() }
    }
    .onChange(of: apiKey) { _, next in
      if !next.isEmpty {
        apiKeyAction = "replace"
        invalidateDetectedModels()
      } else if apiKeyAction == "replace" {
        apiKeyAction = "preserve"
      }
    }
    .onChange(of: operation) { _, next in
      guard next?.action == "model.discover", next?.state == "success" else { return }
      displayedDetectedModels = detectedModels
      if let first = detectedModels.first, !detectedModels.contains(modelName) {
        modelName = first
      }
      detectedModelsExpanded = !detectedModels.isEmpty
    }
    .onChange(of: confirmation) { _, next in presentedConfirmation = next }
    .onChange(of: modelMoaJSON) { _, next in
      if !moaEditorFocused { moaEditorJSON = next ?? "{}" }
    }
    .alert(
      chinese ? "确认模型费用" : "Confirm model pricing",
      isPresented: Binding(
        get: { presentedConfirmation != nil },
        set: { if !$0 { presentedConfirmation = nil } }
      ),
      presenting: presentedConfirmation
    ) { pending in
      Button(chinese ? "取消" : "Cancel", role: .cancel) {
        onAction(
          .modelSelectCancel,
          HermesRouteActionPayload(route: "models", id: pending.id)
        )
        presentedConfirmation = nil
      }
      Button(chinese ? "仍然切换" : "Switch anyway", role: .destructive) {
        onAction(
          .modelSelect,
          HermesRouteActionPayload(
            route: "models",
            id: pending.id,
            fields: ["confirmExpensiveModel": "true"]
          )
        )
        presentedConfirmation = nil
      }
    } message: { pending in
      Text(pending.message)
    }
  }

  @ViewBuilder private var availableModelsPanel: some View {
    HermesPanel {
      VStack(alignment: .leading, spacing: 12) {
        Label(chinese ? "可用模型" : "Available models", systemImage: "square.stack.3d.up")
          .font(HermesFonts.display(17))

        if models.isEmpty {
          Text(chinese ? "当前没有可选择的模型" : "No models are available")
            .font(HermesFonts.body(13))
            .foregroundStyle(appearance.palette.secondary)
        } else {
          LazyVStack(spacing: 0) {
            ForEach(models) { model in
              modelRow(model)
              if model.id != models.last?.id {
                Divider()
              }
            }
          } header: {
            Text(chinese ? "可分叉消息" : "Branchable messages")
          }
        }
      }
    }
  }

  @ViewBuilder private var auxiliaryPanel: some View {
    HermesPanel {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Label(chinese ? "辅助任务模型" : "Auxiliary task models", systemImage: "slider.horizontal.3")
            .font(HermesFonts.display(15))
          Spacer()
          if !moa.activePreset.isEmpty { HermesStatusPill(text: "MoA: \(moa.activePreset)") }
        }
        if auxiliary.tasks.isEmpty {
          Text(chinese ? "未配置辅助槽位" : "No auxiliary slots configured")
            .font(HermesFonts.body(12)).foregroundStyle(appearance.palette.secondary)
        } else {
          ForEach(auxiliary.tasks) { task in
            HStack {
              Text(task.task).font(HermesFonts.bodyBold(12))
              Spacer()
              Text([task.provider, task.model].filter { !$0.isEmpty }.joined(separator: "/"))
                .font(HermesFonts.mono(11)).foregroundStyle(appearance.palette.secondary)
            }
          }
        }
        HStack {
          Text(moa.enabled ? (chinese ? "MoA 已启用" : "MoA enabled") : (chinese ? "MoA 未启用" : "MoA disabled"))
            .font(HermesFonts.body(11)).foregroundStyle(moa.enabled ? appearance.palette.success : appearance.palette.secondary)
          if moa.presetCount > 0 { Text("· \(moa.presetCount) presets").font(HermesFonts.mono(10)).foregroundStyle(appearance.palette.secondary) }
        }
        if modelMoaJSON != nil {
          TextEditor(text: $moaEditorJSON)
            .font(HermesFonts.mono(11))
            .frame(minHeight: 150)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($moaEditorFocused)
          Button {
            moaEditorFocused = false
            onAction(.modelMoaSave, HermesRouteActionPayload(route: "models", detail: moaEditorJSON))
          } label: {
            Label(chinese ? "保存 MoA 配置" : "Save MoA configuration", systemImage: "square.and.arrow.down")
          }
          .buttonStyle(.bordered)
          .disabled(moaEditorJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
    }
  }

  @ViewBuilder private func modelRow(_ model: HermesModelSnapshot) -> some View {
    Button {
      if !model.active && model.selectable != false {
        onAction(
          .modelSelect,
          HermesRouteActionPayload(route: "models", id: model.id)
        )
      }
    } label: {
      HStack(spacing: 12) {
        Image(systemName: model.active ? "checkmark.circle.fill" : "circle")
          .font(.system(size: 18, weight: .semibold))
          .foregroundStyle(
            model.active ? appearance.palette.success : appearance.palette.secondary
          )
          .frame(width: 24, height: 24)

        VStack(alignment: .leading, spacing: 3) {
          Text(model.model)
            .font(HermesFonts.bodyBold(14))
            .foregroundStyle(appearance.palette.foreground)
            .lineLimit(2)
          HStack(spacing: 8) {
            Text(model.provider)
            if !model.context.isEmpty {
              Text(model.context)
            }
          }
          .font(HermesFonts.body(11))
          .foregroundStyle(appearance.palette.secondary)
          if let warning = model.warning, !warning.isEmpty {
            Text(warning)
              .font(HermesFonts.body(11))
              .foregroundStyle(appearance.palette.destructive)
              .fixedSize(horizontal: false, vertical: true)
          }
          HStack(spacing: 8) {
            if model.free == true { Text(chinese ? "免费" : "Free") }
            if let input = model.priceInput, !input.isEmpty {
              Text("in \(input)")
            }
            if let output = model.priceOutput, !output.isEmpty {
              Text("out \(output)")
            }
            if model.supportsFast == true { Text("Fast") }
            if model.supportsReasoning == true { Text(chinese ? "推理" : "Reasoning") }
          }
          .font(HermesFonts.body(10))
          .foregroundStyle(appearance.palette.secondary)
        }

        Spacer(minLength: 8)
      }
      .contentShape(Rectangle())
      .padding(.vertical, 11)
    }
    .buttonStyle(.plain)
    .disabled(model.selectable == false)
    .opacity(model.selectable == false ? 0.55 : 1)
    .accessibilityIdentifier("hermes-model-\(model.provider)-\(model.model)")
  }

  @ViewBuilder private var customModelPanel: some View {
    HermesPanel {
      VStack(alignment: .leading, spacing: 14) {
        Label(chinese ? "自定义模型" : "Custom model", systemImage: "cpu")
          .font(HermesFonts.display(17))

        modelField("Base URL", text: $baseUrl, keyboard: .URL)
        modelField(chinese ? "API 密钥（可选）" : "API key (optional)", text: $apiKey, secure: true)
        if apiKey.isEmpty, let configuration, configuration.apiKeyConfigured {
          Text(chinese
            ? "已保存密钥 \(configuration.apiKeyPreview)。留空将继续使用已保存密钥。"
            : "Saved key \(configuration.apiKeyPreview). Leave blank to keep it.")
            .font(HermesFonts.body(11))
            .foregroundStyle(appearance.palette.secondary)
          Button(role: apiKeyAction == "delete" ? nil : .destructive) {
            apiKey = ""
            apiKeyAction = apiKeyAction == "delete" ? "preserve" : "delete"
          } label: {
            Label(
              apiKeyAction == "delete"
                ? (chinese ? "保存时删除密钥，点此撤销" : "Delete on save; tap to undo")
                : (chinese ? "删除已保存密钥" : "Delete saved API key"),
              systemImage: "trash"
            )
          }
          .buttonStyle(.borderless)
          .foregroundStyle(
            apiKeyAction == "delete"
              ? appearance.palette.destructive
              : appearance.palette.secondary
          )
        }
        detectModelsControl
        modelNameField
        apiProtocolPicker
        modelField(
          chinese ? "上下文长度" : "Context length",
          text: $contextLength,
          keyboard: .numberPad
        )
        reasoningEffortPicker
        modelActionButtons
        operationStatus
      }
    }
  }
  private var pendingProviderOauth: HermesProviderOauthPendingSnapshot? {
    HermesProviderOauthPendingSnapshot.decode(providerOauthPendingJSON)
  }
  private var credentialPool: HermesCredentialPoolSnapshot? {
    HermesCredentialPoolSnapshot.decode(credentialPoolJSON)
  }

  @ViewBuilder private var providerConnectionsPanel: some View {
    if let metadata = providerOauthJSON, !metadata.isEmpty {
      HermesPanel {
        VStack(alignment: .leading, spacing: 10) {
          Label(chinese ? "官方 Provider OAuth" : "Official provider OAuth", systemImage: "person.badge.key")
            .font(HermesFonts.display(15))
          Text(metadata).font(HermesFonts.mono(10)).foregroundStyle(appearance.palette.secondary).textSelection(.enabled).lineLimit(8)
          if let pending = pendingProviderOauth, !pending.cancelled {
            HStack(spacing: 10) {
              ProgressView().controlSize(.small)
              VStack(alignment: .leading, spacing: 2) {
                Text(pending.provider).font(HermesFonts.bodyBold(12))
                Text(chinese ? "正在等待授权：\(pending.status)" : "Waiting for authorization: \(pending.status)")
                  .font(HermesFonts.body(11))
                  .foregroundStyle(appearance.palette.secondary)
              }
              Spacer()
              Button(role: .cancel) {
                onAction(.providerOauthCancel, HermesRouteActionPayload(
                  route: "models",
                  id: pending.provider,
                  value: pending.sessionId
                ))
              } label: {
                Label(chinese ? "取消" : "Cancel", systemImage: "xmark.circle")
              }
              .buttonStyle(.bordered)
            }
          }
          HStack {
            TextField(chinese ? "Provider 标识符" : "Provider id", text: $providerOauthID)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button {
              onAction(.providerOauthStart, HermesRouteActionPayload(route: "models", id: providerOauthID))
            } label: { Label(chinese ? "连接" : "Connect", systemImage: "link") }
              .buttonStyle(.borderedProminent)
              .disabled(
                providerOauthID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                  || (pendingProviderOauth?.cancelled == false)
              )
          }
          HStack {
            TextField(chinese ? "授权码（若 Provider 要求）" : "Authorization code (if required)", text: $providerOauthCode)
              .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button {
              onAction(.providerOauthSubmit, HermesRouteActionPayload(route: "models", id: providerOauthID, fields: ["code": providerOauthCode]))
            } label: { Label(chinese ? "提交" : "Submit", systemImage: "paperplane") }
              .buttonStyle(.bordered)
              .disabled(providerOauthID.isEmpty || providerOauthCode.isEmpty)
          }
          Text(chinese ? "连接会打开官方 OAuth 页面，并在后台轮询完成状态。" : "The official OAuth page opens and completion is polled in the background.")
            .font(HermesFonts.body(11)).foregroundStyle(appearance.palette.secondary)
        }
      }
    }
  }

  @ViewBuilder private var credentialPoolPanel: some View {
    if let pool = credentialPool {
      HermesPanel {
        VStack(alignment: .leading, spacing: 12) {
          Label(chinese ? "凭据池" : "Credential pool", systemImage: "key.horizontal")
            .font(HermesFonts.display(15))
          ForEach(pool.providers) { provider in
            VStack(alignment: .leading, spacing: 6) {
              Text(provider.provider).font(HermesFonts.bodyBold(13))
              if provider.entries.isEmpty {
                Text(chinese ? "没有凭据" : "No credentials")
                  .font(HermesFonts.body(11))
                  .foregroundStyle(appearance.palette.secondary)
              }
              ForEach(provider.entries, id: \.index) { entry in
                HStack(alignment: .top, spacing: 10) {
                  VStack(alignment: .leading, spacing: 2) {
                    Text((entry.label?.isEmpty == false ? entry.label : nil) ?? "#\(entry.index)")
                      .font(HermesFonts.bodyBold(12))
                    Text([
                      entry.authType,
                      entry.source,
                      entry.lastStatus,
                      entry.requestCount.map { "\(Int($0)) requests" },
                    ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                      .font(HermesFonts.body(10))
                      .foregroundStyle(appearance.palette.secondary)
                  }
                  Spacer()
                  Button(role: .destructive) {
                    onAction(.credentialPoolDelete, HermesRouteActionPayload(
                      route: "models",
                      id: provider.provider,
                      position: entry.index
                    ))
                  } label: {
                    Image(systemName: "trash")
                  }
                  .buttonStyle(.borderless)
                  .accessibilityLabel(chinese ? "删除凭据" : "Delete credential")
                }
              }
            }
          }
          Divider()
          TextField(chinese ? "Provider 标识符" : "Provider id", text: $credentialProvider)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
          TextField(chinese ? "标签（可选）" : "Label (optional)", text: $credentialLabel)
          SecureField(chinese ? "新密钥" : "New secret", text: $credentialKey)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
          Button {
            let secret = credentialKey
            credentialKey = ""
            onAction(.credentialPoolAdd, HermesRouteActionPayload(
              route: "models",
              id: credentialProvider,
              name: credentialLabel,
              detail: secret
            ))
          } label: {
            Label(chinese ? "添加凭据" : "Add credential", systemImage: "plus")
          }
          .buttonStyle(.borderedProminent)
          .disabled(
            credentialProvider.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              || credentialKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
          )
        }
      }
    }
  }

  @ViewBuilder private var customProviderEndpointsPanel: some View {
    if let endpoints = customProviderEndpointsJSON, !endpoints.isEmpty {
      HermesPanel {
        VStack(alignment: .leading, spacing: 10) {
          Label(chinese ? "自定义 Provider 端点" : "Custom provider endpoints", systemImage: "point.3.connected.trianglepath.dotted")
            .font(HermesFonts.display(15))
          Text(endpoints).font(HermesFonts.mono(10)).foregroundStyle(appearance.palette.secondary).textSelection(.enabled).lineLimit(8)
          TextEditor(text: $customEndpointJSON)
            .font(HermesFonts.mono(11)).frame(minHeight: 110)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
          HStack {
            Button { onAction(.customEndpointValidate, HermesRouteActionPayload(route: "models", value: customEndpointJSON)) } label: { Label(chinese ? "验证" : "Validate", systemImage: "checkmark.shield") }.buttonStyle(.bordered)
            Button { onAction(.customEndpointSave, HermesRouteActionPayload(route: "models", value: customEndpointJSON)) } label: { Label(chinese ? "保存端点" : "Save endpoint", systemImage: "square.and.arrow.down") }.buttonStyle(.borderedProminent)
          }
          TextField(chinese ? "端点 ID（激活/删除）" : "Endpoint id (activate / delete)", text: $customEndpointID)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
          HStack {
            Button { onAction(.customEndpointActivate, HermesRouteActionPayload(route: "models", id: customEndpointID)) } label: { Label(chinese ? "激活" : "Activate", systemImage: "checkmark.circle") }.buttonStyle(.bordered)
            Button(role: .destructive) { onAction(.customEndpointDelete, HermesRouteActionPayload(route: "models", id: customEndpointID)) } label: { Label(chinese ? "删除" : "Delete", systemImage: "trash") }.buttonStyle(.bordered)
          }
          .disabled(customEndpointID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
    }
  }

  @ViewBuilder private var detectModelsControl: some View {
    VStack(spacing: 0) {
      HStack(spacing: 6) {
        Button {
          if displayedDetectedModels.isEmpty {
            detectModels()
          } else {
            withAnimation(.easeInOut(duration: 0.18)) {
              detectedModelsExpanded.toggle()
            }
          }
        } label: {
          HStack(spacing: 9) {
            if isDiscovering {
              ProgressView().controlSize(.small)
            } else {
              Image(systemName: "magnifyingglass")
            }
            Text(chinese ? "检测可用模型" : "Detect models")
              .font(HermesFonts.bodyBold(13))
            Spacer(minLength: 8)
            if !displayedDetectedModels.isEmpty {
              Text("\(displayedDetectedModels.count)")
                .font(HermesFonts.mono(11))
                .foregroundStyle(appearance.palette.secondary)
              Image(systemName: detectedModelsExpanded ? "chevron.up" : "chevron.down")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(appearance.palette.secondary)
            }
          }
          .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canDiscover || isBusy)
        .accessibilityIdentifier("hermes-detect-models")

        if !displayedDetectedModels.isEmpty {
          Button { detectModels() } label: {
            Image(systemName: "arrow.clockwise")
              .font(.system(size: 14, weight: .semibold))
              .frame(width: 38, height: 38)
          }
          .buttonStyle(.plain)
          .disabled(!canDiscover || isBusy)
          .accessibilityLabel(chinese ? "重新检测可用模型" : "Detect models again")
        }
      }
      .padding(.horizontal, 10)

      if detectedModelsExpanded && !displayedDetectedModels.isEmpty {
        Divider()
        LazyVStack(spacing: 0) {
          ForEach(displayedDetectedModels, id: \.self) { model in
            Button {
              modelName = model
              withAnimation(.easeInOut(duration: 0.18)) {
                detectedModelsExpanded = false
              }
            } label: {
              HStack(spacing: 10) {
                Image(systemName: modelName == model ? "checkmark.circle.fill" : "circle")
                  .foregroundStyle(
                    modelName == model
                      ? appearance.palette.success
                      : appearance.palette.secondary
                  )
                Text(model)
                  .font(HermesFonts.mono(12))
                  .foregroundStyle(appearance.palette.foreground)
                  .lineLimit(2)
                Spacer(minLength: 8)
              }
              .padding(.horizontal, 12)
              .padding(.vertical, 10)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if model != displayedDetectedModels.last { Divider().padding(.leading, 42) }
          }
        }
      }
    }
    .background(appearance.palette.surface)
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .stroke(appearance.palette.border, lineWidth: 1)
    }
  }

  @ViewBuilder private var modelNameField: some View {
    if displayedDetectedModels.isEmpty {
      modelField(chinese ? "模型名称" : "Model", text: $modelName)
    }
  }

  @ViewBuilder private var apiProtocolPicker: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(chinese ? "接口协议" : "API protocol")
        .font(HermesFonts.bodyBold(12))
        .foregroundStyle(appearance.palette.secondary)
      Picker(chinese ? "接口协议" : "API protocol", selection: $apiMode) {
        Text("OpenAI Chat Completions").tag("chat_completions")
        Text("Anthropic Messages").tag("anthropic_messages")
        Text("OpenAI Responses").tag("codex_responses")
      }
      .pickerStyle(.menu)
    }
  }

  @ViewBuilder private var reasoningEffortPicker: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(chinese ? "推理强度" : "Reasoning effort")
        .font(HermesFonts.bodyBold(12))
        .foregroundStyle(appearance.palette.secondary)
      Picker(chinese ? "推理强度" : "Reasoning effort", selection: $reasoningEffort) {
        ForEach(
          ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
          id: \.self
        ) { effort in
          Text(reasoningLabel(effort)).tag(effort)
        }
      }
      .pickerStyle(.menu)
    }
  }

  @ViewBuilder private var modelActionButtons: some View {
    HStack(spacing: 10) {
      Button {
        onAction(
          .modelTest,
          HermesRouteActionPayload(route: "models", fields: fields)
        )
      } label: {
        Label(
          chinese ? "测试连接" : "Test connection",
          systemImage: "bolt.horizontal.circle"
        )
      }
      .buttonStyle(.bordered)
      .disabled(!isValid || isBusy)

      Button {
        onAction(
          .modelSave,
          HermesRouteActionPayload(route: "models", fields: fields)
        )
      } label: {
        Label(chinese ? "保存" : "Save", systemImage: "checkmark")
      }
      .buttonStyle(.borderedProminent)
      .tint(appearance.palette.accent)
      .disabled(!isValid || isBusy)
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
  }

  @ViewBuilder private var operationStatus: some View {
    if let operation {
      HStack(alignment: .top, spacing: 9) {
        if operation.state == "running" {
          ProgressView().controlSize(.small)
        } else {
          Image(systemName: operation.state == "success" ? "checkmark.circle.fill" : "xmark.circle.fill")
            .foregroundStyle(
              operation.state == "success"
                ? appearance.palette.success
                : appearance.palette.destructive
            )
        }
        Text(operation.message)
          .font(HermesFonts.body(12))
          .foregroundStyle(appearance.palette.foreground)
          .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
      }
      .padding(10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(appearance.palette.surface)
      .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      .accessibilityIdentifier("hermes-model-operation-status")
    }
  }

  private var isBusy: Bool { operation?.state == "running" }
  private var isDiscovering: Bool {
    operation?.action == "model.discover" && operation?.state == "running"
  }
  private var canDiscover: Bool {
    !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func detectModels() {
    invalidateDetectedModels()
    onAction(
      .modelDiscover,
      HermesRouteActionPayload(
        route: "models",
        fields: ["apiKey": apiKey, "baseUrl": baseUrl]
      )
    )
  }

  private func invalidateDetectedModels() {
    displayedDetectedModels = []
    detectedModelsExpanded = false
  }

  private var isValid: Bool {
    !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && !modelName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && (Int(contextLength) ?? 0) > 0
  }

  @ViewBuilder private func modelField(
    _ title: String,
    text: Binding<String>,
    secure: Bool = false,
    keyboard: UIKeyboardType = .default
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(HermesFonts.bodyBold(12))
        .foregroundStyle(appearance.palette.secondary)
      Group {
        if secure {
          SecureField(title, text: text)
            .textContentType(.password)
        } else {
          TextField(title, text: text)
        }
      }
      .keyboardType(keyboard)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
      .padding(.horizontal, 12)
      .frame(minHeight: 44)
      .background(appearance.palette.surface)
      .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .stroke(appearance.palette.border, lineWidth: 1)
      }
    }
  }

  private func apply(_ value: HermesModelSnapshot?) {
    guard let value else { return }
    apiKey = ""
    apiKeyAction = "preserve"
    apiMode = value.apiMode
    baseUrl = value.baseUrl
    contextLength = String(value.contextLength > 0 ? value.contextLength : 131072)
    modelName = value.model
    reasoningEffort = value.reasoningEffort
  }

  private func reasoningLabel(_ value: String) -> String {
    guard chinese else { return value.capitalized }
    switch value {
    case "none": return "关闭"
    case "minimal": return "极低"
    case "low": return "低"
    case "medium": return "中"
    case "high": return "高"
    case "xhigh": return "很高"
    case "max": return "最大"
    case "ultra": return "超高"
    default: return value
    }
  }
}

private struct HermesLogsPage: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let logs: [HermesLogSnapshot]
  let onAction: HermesRouteActionSink
  @State private var level = "ALL"
  @State private var search = ""

  private var filteredLogs: [HermesLogSnapshot] {
    logs.filter { entry in
      let matchesLevel = level == "ALL" || entry.level == level
      let matchesSearch = search.isEmpty
        || entry.level.localizedCaseInsensitiveContains(search)
        || entry.message.localizedCaseInsensitiveContains(search)
        || entry.time.localizedCaseInsensitiveContains(search)
      return matchesLevel && matchesSearch
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      Picker(chinese ? "日志级别" : "Log level", selection: $level) {
        ForEach(["ALL", "INFO", "WARN", "ERROR"], id: \.self) { Text($0).tag($0) }
      }
      .pickerStyle(.segmented)
      .padding(12)

      List {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
          HermesFrameRateLogRow(
            chinese: chinese,
            snapshot: HermesFrameRateController.shared.snapshot()
          )
        }
        ForEach(filteredLogs) { log in
          HStack(alignment: .top, spacing: 10) {
            Text(log.time)
              .font(HermesFonts.mono(10))
              .foregroundStyle(appearance.palette.tertiary)
            Text(log.level)
              .font(HermesFonts.mono(10))
              .foregroundStyle(log.level == "WARN" ? appearance.palette.warning : appearance.palette.success)
              .frame(width: 38, alignment: .leading)
            Text(log.message)
              .font(HermesFonts.mono(12))
              .textSelection(.enabled)
          }
          .padding(.vertical, 3)
        }
      }
      .hermesListStyle()
      .refreshable {
        onAction(.refresh, HermesRouteActionPayload(route: "logs"))
      }
    }
    .background(appearance.palette.background)
    .searchable(text: $search, prompt: chinese ? "搜索日志" : "Search logs")
    .onChange(of: level) { next in
      onAction(
        .logsFilter,
        HermesRouteActionPayload(route: "logs", value: next)
      )
    }
  }
}

private struct HermesFrameRateLogRow: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool
  let snapshot: HermesFrameRateSnapshot

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Text("LIVE")
        .font(HermesFonts.mono(10))
        .foregroundStyle(appearance.palette.tertiary)
      Text("FPS")
        .font(HermesFonts.mono(10))
        .foregroundStyle(
          snapshot.measuredCallbacksPerSecond >= 110
            ? appearance.palette.success
            : appearance.palette.warning
        )
        .frame(width: 38, alignment: .leading)
      Text(message)
        .font(HermesFonts.mono(12))
        .textSelection(.enabled)
    }
    .padding(.vertical, 3)
  }

  private var message: String {
    let measured = String(format: "%.1f", snapshot.measuredCallbacksPerSecond)
    let power = snapshot.lowPowerMode ? (chinese ? "低电量开启" : "Low Power On") : (chinese ? "低电量关闭" : "Low Power Off")
    return "max=\(snapshot.screenMaximumFramesPerSecond) requested=\(snapshot.requestedFramesPerSecond) measured=\(measured) \(power) thermal=\(snapshot.thermalState)"
  }
}
