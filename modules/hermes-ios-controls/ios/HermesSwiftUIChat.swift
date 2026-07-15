import SwiftUI

private struct HermesChatViewportHeightKey: PreferenceKey {
  static var defaultValue: CGFloat = 0

  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
    value = nextValue()
  }
}

struct HermesChatMessage: Identifiable, Equatable {
  enum Role {
    case assistant
    case user
  }

  let id: String
  let role: Role
  let author: String
  let content: String
  var toolEvents: [HermesToolEvent] = []
}

struct HermesToolEvent: Identifiable, Equatable {
  let id: String
  let name: String
  let detail: String
  let output: String
}

private struct HermesChatAttachment: Identifiable, Equatable {
  let id: String
  let name: String
}

struct HermesChatPage: View {
  private static let bottomAnchor = "hermes-chat-bottom"

  @EnvironmentObject private var appearance: HermesAppearanceModel
  let attachmentIds: [String]
  let attachmentNames: [String]
  let chinese: Bool
  let onAction: (String, String?) -> Void

  @State private var messages: [HermesChatMessage] = [
    HermesChatMessage(
      id: "user-1",
      role: .user,
      author: "你",
      content: "帮我检查当前项目的状态。"
    ),
    HermesChatMessage(
      id: "assistant-1",
      role: .assistant,
      author: "Hermes Agent",
      content: "当前项目有未提交的前端修改，我会保留这些改动并继续处理。",
      toolEvents: [
        HermesToolEvent(
          id: "tool-1",
          name: "git status --short",
          detail: "检查工作区状态 · 0.4 s",
          output: "M src/preview/PreviewChatPage.tsx"
        )
      ]
    )
  ]
  @State private var draft = ""
  @State private var sending = false
  @State private var toolsOpen = false
  @State private var selectedModel = "claude-sonnet-4"
  @State private var reasoning = "中"
  @State private var hapticTrigger = 0
  @State private var viewportHeight: CGFloat = 0
  @FocusState private var composerFocused: Bool

  private var attachments: [HermesChatAttachment] {
    attachmentNames.enumerated().map { index, name in
      HermesChatAttachment(
        id: attachmentIds.indices.contains(index) ? attachmentIds[index] : "attachment-\(index)",
        name: name
      )
    }
  }

  var body: some View {
    ZStack {
      HermesDitherBackground()
      VStack(spacing: 0) {
        chatHeader
        messageStream
      }
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      composer
    }
    .sheet(isPresented: $toolsOpen) {
      modelToolsSheet
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
    .hermesImpact(trigger: hapticTrigger)
  }

  private var chatHeader: some View {
    HStack(spacing: 12) {
      ZStack {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .fill(appearance.palette.primary)
        Image(systemName: "sparkles")
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(.white)
      }
      .frame(width: 36, height: 36)

      VStack(alignment: .leading, spacing: 2) {
        Text("Hermes Agent")
          .font(HermesFonts.display(15))
          .foregroundStyle(appearance.palette.foreground)
        HStack(spacing: 6) {
          Circle()
            .fill(appearance.palette.success)
            .frame(width: 7, height: 7)
          Text(selectedModel)
            .font(HermesFonts.mono(10))
            .foregroundStyle(appearance.palette.secondary)
        }
      }

      Spacer()

      Button {
        toolsOpen = true
        hapticTrigger += 1
      } label: {
        Label(chinese ? "模型与工具" : "Model & Tools", systemImage: "slider.horizontal.3")
          .font(HermesFonts.bodyBold(13))
          .labelStyle(.iconOnly)
          .frame(width: 38, height: 38)
      }
      .buttonStyle(HermesPressStyle(scale: 0.93, opacity: 0.72))
      .accessibilityLabel(chinese ? "模型与工具" : "Model and tools")
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .background(appearance.palette.background)
  }

  private var messageStream: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(spacing: 16) {
          if messages.isEmpty {
            VStack(spacing: 14) {
              Image(systemName: "sparkles")
                .font(.system(size: 32, weight: .light))
                .foregroundStyle(appearance.palette.accent)
              Text(chinese ? "直接告诉 Hermes 你想做什么" : "Tell Hermes what you want to do")
                .font(HermesFonts.display(18))
              Text(chinese ? "当前窗口持续使用同一个会话" : "This window continues in one session")
                .font(HermesFonts.body(14))
                .foregroundStyle(appearance.palette.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 320)
          }

          ForEach(messages) { message in
            HermesMessageBubble(message: message, chinese: chinese)
              .id(message.id)
              .transition(
                .asymmetric(
                  insertion: .move(edge: .bottom).combined(with: .opacity),
                  removal: .opacity
                )
              )
          }

          if sending {
            HermesThinkingIndicator(chinese: chinese)
              .id("thinking")
              .transition(.move(edge: .bottom).combined(with: .opacity))
          }

          Color.clear
            .frame(height: 1)
            .id(Self.bottomAnchor)
        }
        .frame(maxWidth: 920)
        .padding(.horizontal, 16)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity)
      }
      .background {
        GeometryReader { geometry in
          Color.clear.preference(
            key: HermesChatViewportHeightKey.self,
            value: geometry.size.height
          )
        }
      }
      .onPreferenceChange(HermesChatViewportHeightKey.self) { nextHeight in
        viewportHeight = nextHeight
      }
      .contentShape(Rectangle())
      .simultaneousGesture(
        TapGesture().onEnded {
          composerFocused = false
        }
      )
      .scrollDismissesKeyboard(.interactively)
      .onAppear {
        Task { @MainActor in
          await Task.yield()
          proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
      }
      .onChange(of: messages.count) {
        withAnimation(.spring(response: 0.38, dampingFraction: 0.9)) {
          proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
      }
      .onChange(of: sending) {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.9)) {
          proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
      }
      .onChange(of: attachments.count) {
        withAnimation(.spring(response: 0.34, dampingFraction: 0.9)) {
          proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
      }
      .onChange(of: viewportHeight) {
        withAnimation(.easeOut(duration: 0.2)) {
          proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
      }
      .onChange(of: composerFocused) { _, focused in
        guard focused else { return }
        Task { @MainActor in
          await Task.yield()
          withAnimation(.spring(response: 0.32, dampingFraction: 0.9)) {
            proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
          }
        }
      }
    }
  }

  private var composer: some View {
    VStack(spacing: 0) {
      if !attachments.isEmpty {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(attachments) { attachment in
              HStack(spacing: 7) {
                Image(systemName: "doc.fill")
                  .foregroundStyle(appearance.palette.accent)
                Text(attachment.name)
                  .font(HermesFonts.body(12))
                  .lineLimit(1)
                  .frame(maxWidth: 170)
                Button {
                  onAction("remove-attachment", attachment.id)
                } label: {
                  Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(appearance.palette.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(chinese ? "移除" : "Remove") \(attachment.name)")
              }
              .padding(.leading, 10)
              .padding(.trailing, 7)
              .frame(height: 34)
              .background(appearance.palette.elevated.opacity(0.82))
              .clipShape(Capsule())
              .overlay {
                Capsule().stroke(appearance.palette.border)
              }
            }
          }
          .padding(.horizontal, 12)
          .padding(.top, 8)
        }
        .frame(maxWidth: 920)
        .transition(.move(edge: .bottom).combined(with: .opacity))
      }
      HStack(alignment: .bottom, spacing: 8) {
        Menu {
          Button {
            onAction("photo-library", nil)
          } label: {
            Label(chinese ? "照片图库" : "Photo Library", systemImage: "photo.on.rectangle")
          }
          Button {
            onAction("camera", nil)
          } label: {
            Label(chinese ? "拍照" : "Take Photo", systemImage: "camera")
          }
          Button {
            onAction("file-picker", nil)
          } label: {
            Label(chinese ? "系统文件" : "Choose File", systemImage: "folder")
          }
        } label: {
          Image(systemName: "plus")
            .font(.system(size: 18, weight: .semibold))
            .frame(width: 38, height: 38)
            .contentShape(Rectangle())
        }
        .buttonStyle(HermesPressStyle(scale: 0.9, opacity: 0.7))
        .accessibilityLabel(chinese ? "添加附件" : "Add attachment")

        TextField(
          chinese ? "输入消息" : "Type a message",
          text: $draft,
          axis: .vertical
        )
        .font(HermesFonts.body(16))
        .lineLimit(1...6)
        .focused($composerFocused)
        .submitLabel(.send)
        .onSubmit(send)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(appearance.palette.background.opacity(0.42))
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 13, style: .continuous)
            .stroke(
              composerFocused ? appearance.palette.accent : appearance.palette.border,
              lineWidth: composerFocused ? 1.5 : 1
            )
            .animation(.easeOut(duration: 0.16), value: composerFocused)
        }

        Button(action: send) {
          Image(systemName: sending ? "ellipsis" : "arrow.up")
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 38, height: 38)
            .background(appearance.palette.accent)
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(HermesPressStyle(scale: 0.9, opacity: 0.76))
        .disabled(!canSend)
        .opacity(canSend ? 1 : 0.38)
        .accessibilityLabel(chinese ? "发送消息" : "Send message")
      }
      .frame(maxWidth: 920)
      .padding(.horizontal, 12)
      .padding(.top, 9)
      .padding(.bottom, 8)
      .frame(maxWidth: .infinity)
      .background(appearance.palette.background)
    }
    .animation(.spring(response: 0.34, dampingFraction: 0.88), value: attachments)
  }

  private var modelToolsSheet: some View {
    NavigationStack {
      Form {
        Section {
          Button {
            withAnimation(.spring(response: 0.36, dampingFraction: 0.88)) {
              messages.removeAll()
            }
            toolsOpen = false
          } label: {
            Label(chinese ? "新建对话" : "New chat", systemImage: "square.and.pencil")
          }
        }
        Section(chinese ? "模型" : "Model") {
          Picker(chinese ? "当前模型" : "Current model", selection: $selectedModel) {
            Text("claude-sonnet-4").tag("claude-sonnet-4")
            Text("gpt-5.6-sol").tag("gpt-5.6-sol")
            Text("gemini-3-pro").tag("gemini-3-pro")
          }
        }
        Section(chinese ? "推理强度" : "Reasoning effort") {
          Picker(chinese ? "推理强度" : "Reasoning", selection: $reasoning) {
            ForEach(chinese ? ["低", "中", "高"] : ["Low", "Medium", "High"], id: \.self) {
              Text($0).tag($0)
            }
          }
          .pickerStyle(.segmented)
        }
        Section(chinese ? "工具事件流" : "Tool events") {
          LabeledContent(chinese ? "状态" : "Status") {
            HermesStatusPill(text: chinese ? "在线" : "Live")
          }
          Text(chinese ? "等待下一次工具调用" : "Waiting for the next tool call")
            .foregroundStyle(appearance.palette.secondary)
        }
      }
      .navigationTitle(chinese ? "模型与工具" : "Model & Tools")
    }
    .preferredColorScheme(appearance.theme.colorScheme)
  }

  private func send() {
    let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard canSend else { return }
    hapticTrigger += 1
    draft = ""
    withAnimation(.spring(response: 0.36, dampingFraction: 0.88)) {
      messages.append(HermesChatMessage(
        id: "user-\(Date().timeIntervalSince1970)",
        role: .user,
        author: chinese ? "你" : "You",
        content: content.isEmpty
              ? (chinese ? "已添加 \(attachments.count) 个附件" : "\(attachments.count) attachments")
          : content
      ))
      sending = true
    }
    onAction("clear-attachments", nil)

    Task {
      try? await Task.sleep(nanoseconds: 650_000_000)
      await MainActor.run {
        withAnimation(.spring(response: 0.42, dampingFraction: 0.9)) {
          sending = false
          messages.append(HermesChatMessage(
            id: "assistant-\(Date().timeIntervalSince1970)",
            role: .assistant,
            author: "Hermes Agent",
            content: chinese
              ? "已收到。任务执行过程和完整结果会持续显示在当前会话中。"
              : "Received. The complete task process and result will remain in this conversation."
          ))
        }
      }
    }
  }

  private var canSend: Bool {
    !sending && (
      !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || !attachments.isEmpty
    )
  }
}

private struct HermesMessageBubble: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let message: HermesChatMessage
  let chinese: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 9) {
      if message.role == .user { Spacer(minLength: 28) }
      if message.role == .assistant { avatar }

      VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 5) {
        HStack(spacing: 6) {
          Text(message.author)
            .font(HermesFonts.bodyBold(12))
          if message.role == .assistant {
            Text("HERMES AGENT")
              .font(HermesFonts.condensed(9))
              .foregroundStyle(appearance.palette.secondary)
          }
        }

        Text(message.content)
          .font(HermesFonts.body(15))
          .foregroundStyle(
            message.role == .user ? Color.white : appearance.palette.foreground
          )
          .textSelection(.enabled)
          .padding(.horizontal, 12)
          .padding(.vertical, 10)
          .background(
            message.role == .user
              ? appearance.palette.primary.opacity(0.92)
              : appearance.palette.surface.opacity(0.94)
          )
          .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
          .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
              .stroke(appearance.palette.border, lineWidth: 1)
          }

        ForEach(message.toolEvents) { event in
          HermesToolDisclosure(event: event, chinese: chinese)
        }
      }
      .frame(maxWidth: 720, alignment: message.role == .user ? .trailing : .leading)

      if message.role == .user { userAvatar }
      if message.role == .assistant { Spacer(minLength: 28) }
    }
    .frame(maxWidth: .infinity)
  }

  private var avatar: some View {
    RoundedRectangle(cornerRadius: 8, style: .continuous)
      .fill(appearance.palette.primary)
      .frame(width: 28, height: 28)
      .overlay {
        Image(systemName: "sparkles")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(.white)
      }
  }

  private var userAvatar: some View {
    Circle()
      .fill(appearance.palette.foreground)
      .frame(width: 28, height: 28)
      .overlay {
        Text(chinese ? "你" : "Y")
          .font(HermesFonts.bodyBold(10))
          .foregroundStyle(appearance.palette.primary)
      }
  }
}

private struct HermesToolDisclosure: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let event: HermesToolEvent
  let chinese: Bool
  @State private var expanded = false

  var body: some View {
    DisclosureGroup(isExpanded: $expanded) {
      VStack(alignment: .leading, spacing: 7) {
        Text(event.output)
          .font(HermesFonts.mono(12))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(9)
          .background(appearance.palette.background.opacity(0.62))
      }
      .padding(.top, 8)
    } label: {
      VStack(alignment: .leading, spacing: 3) {
        Label(event.name, systemImage: "terminal")
          .font(HermesFonts.mono(12))
        Text(event.detail)
          .font(HermesFonts.body(11))
          .foregroundStyle(appearance.palette.secondary)
      }
    }
    .tint(appearance.palette.accent)
    .padding(10)
    .background(appearance.palette.surface)
    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 9, style: .continuous)
        .stroke(appearance.palette.border)
    }
    .animation(.spring(response: 0.34, dampingFraction: 0.88), value: expanded)
  }
}

private struct HermesThinkingIndicator: View {
  @EnvironmentObject private var appearance: HermesAppearanceModel
  let chinese: Bool

  var body: some View {
    HStack(spacing: 9) {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .fill(appearance.palette.primary)
        .frame(width: 28, height: 28)
        .overlay {
          Image(systemName: "sparkles")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(.white)
        }
      TimelineView(.animation(minimumInterval: 1.0 / 120.0)) { timeline in
        let phase = timeline.date.timeIntervalSinceReferenceDate * 4
        HStack(spacing: 5) {
          ForEach(0..<3, id: \.self) { index in
            Circle()
              .fill(appearance.palette.accent)
              .frame(width: 6, height: 6)
              .scaleEffect(0.72 + 0.28 * (sin(phase + Double(index) * 1.3) + 1) * 0.5)
          }
        }
      }
      .frame(width: 42, height: 24)
      Text(chinese ? "正在处理" : "Working")
        .font(HermesFonts.body(12))
        .foregroundStyle(appearance.palette.secondary)
      Spacer()
    }
  }
}
