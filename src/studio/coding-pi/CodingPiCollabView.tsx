import * as Clipboard from 'expo-clipboard';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Code2,
  Copy,
  Link2,
  LogIn,
  LogOut,
  Palette,
  PanelRight,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Square,
  Terminal,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react-native';
import Markdown from 'react-native-markdown-display';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { HermesCodingPiCollabLinks } from '../../api/hermes-coding-pi';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { multiplyAlpha } from '../../design/control-contracts';
import { resolveNativeFontStack } from '../../design/native-font-faces';
import { useTheme } from '../../design/ThemeProvider';
import { styles as chatStyles } from '../chat/chat-presentation-styles';
import type { CodingPiController } from './useCodingPiController';
import type { CodingPiCollabController } from './useCodingPiCollabController';
import {
  type CollabActiveTool,
  type CollabAgentProgress,
  type CollabAgentSnapshot,
  type CollabSessionState,
  type CollabSnapshot,
  type CollabSubagentLifecyclePayload,
  type CollabSubagentProgressPayload,
  type CollabUiRequest,
  useNativeCollabSnapshot,
  NativeCollabClient,
} from './collab-native-client';
import { CodingPiToolCard } from './CodingPiToolCard';
import {
  contentText,
  isRecord,
  numberValue,
  stringifyPiValue,
  stringValue,
  toolResultText,
  type CodingPiActivity,
} from './coding-pi-model';

const BODY_FONT = 'HermesGoogle-IBMPlexSans-400-Normal';
const BODY_MEDIUM = 'HermesGoogle-IBMPlexSans-500-Normal';
const BODY_SEMIBOLD = 'HermesGoogle-IBMPlexSans-600-Normal';
const BODY_BOLD = 'HermesGoogle-IBMPlexSans-700-Normal';
const MONO_FONT = 'HermesTerminal-JetBrainsMono-400-Normal';
const DISPLAY_FONT = 'SpaceGrotesk_700Bold';

export interface CodingPiCollabViewProps {
  compact: boolean;
  controller: CodingPiController;
  collabController: CodingPiCollabController;
  isChinese: boolean;
  safeAreaBottom: number;
  safeAreaLeft: number;
  safeAreaRight: number;
}

/**
 * The complete native Hermes adaptation of omp's collab-web App. The
 * information architecture remains official; only the surface primitives,
 * typography, spacing, and iOS interaction affordances come from Hermes.
 */
export function CodingPiCollabView({
  compact,
  controller,
  collabController,
  isChinese,
  safeAreaBottom,
  safeAreaLeft,
  safeAreaRight,
}: CodingPiCollabViewProps) {
  const { tokens } = useTheme();
  const snapshot = collabController.snapshot;
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const previousSubagentCountRef = useRef(0);
  const currentLinks = controller.activeSession?.collab;

  useEffect(() => {
    const subagentCount = snapshot?.agents.filter((agent) => agent.kind === 'sub').length || 0;
    if (subagentCount > 0 && previousSubagentCountRef.current === 0) setAgentsOpen(true);
    if (subagentCount === 0) setSelectedAgentId(null);
    previousSubagentCountRef.current = subagentCount;
  }, [snapshot?.agents]);

  if (!collabController.client || !snapshot) {
    return (
      <CodingPiConnectScreen
        collabController={collabController}
        controller={controller}
        currentLinks={currentLinks}
        isChinese={isChinese}
        safeAreaBottom={safeAreaBottom}
        safeAreaLeft={safeAreaLeft}
        safeAreaRight={safeAreaRight}
      />
    );
  }

  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedAgentId) || null;
  const mainFont = resolveNativeFontStack(tokens.typography.fontSans, 400) || BODY_FONT;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
      style={[chatStyles.main, { backgroundColor: tokens.colors.background }]}
    >
      <CollabHeader
        compact={compact}
        isChinese={isChinese}
        onLeave={collabController.leave}
        onToggleAgents={() => setAgentsOpen((current) => !current)}
        onToggleShare={() => setShareOpen((current) => !current)}
        shareOpen={shareOpen}
        agentsOpen={agentsOpen}
        snapshot={snapshot}
      />

      {shareOpen ? (
        <CollabSharePanel
          fallbackLink={collabController.link}
          isChinese={isChinese}
          links={currentLinks}
          onClose={() => setShareOpen(false)}
        />
      ) : null}

      <View style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <CollabBanner
          isChinese={isChinese}
          onNewLink={collabController.leave}
          onRejoin={collabController.rejoin}
          snapshot={snapshot}
        />
        <CollabTranscript
          compact={compact}
          isChinese={isChinese}
          onOpenAgent={(agentId) => {
            if (snapshot.agents.some((agent) => agent.id === agentId)) setSelectedAgentId(agentId);
          }}
          safeAreaBottom={safeAreaBottom}
          snapshot={snapshot}
        />
        <CollabComposer
          client={collabController.client}
          isChinese={isChinese}
          safeAreaBottom={safeAreaBottom}
          snapshot={snapshot}
        />

        {agentsOpen ? (
          <View style={{ ...overlayStyle, backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.16) }}>
            <IOSPressable
              accessibilityLabel={isChinese ? '关闭 Agent 面板' : 'Close agents panel'}
              onPress={() => setAgentsOpen(false)}
              style={{ flex: 1 }}
            />
            <View style={[panelStyle, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}> 
              <CollabAgentsPanel
                isChinese={isChinese}
                onClose={() => setAgentsOpen(false)}
                onSelect={(agent) => setSelectedAgentId(agent.id)}
                progress={snapshot.progress}
                lifecycle={snapshot.lifecycle}
                agents={snapshot.agents}
              />
            </View>
          </View>
        ) : null}
      </View>

      <CollabToasts isChinese={isChinese} notices={snapshot.notices} />

      {selectedAgent ? (
        <CollabAgentDrawer
          agent={selectedAgent}
          client={collabController.client}
          isChinese={isChinese}
          lifecycle={snapshot.lifecycle.get(selectedAgent.id)}
          onClose={() => setSelectedAgentId(null)}
          progress={snapshot.progress.get(selectedAgent.id)}
          readOnly={snapshot.readOnly}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function CodingPiConnectScreen({
  collabController,
  controller,
  currentLinks,
  isChinese,
  safeAreaBottom,
  safeAreaLeft,
  safeAreaRight,
}: {
  collabController: CodingPiCollabController;
  controller: CodingPiController;
  currentLinks?: HermesCodingPiCollabLinks | null;
  isChinese: boolean;
  safeAreaBottom: number;
  safeAreaLeft: number;
  safeAreaRight: number;
}) {
  const { tokens } = useTheme();
  const [linkDraft, setLinkDraft] = useState(collabController.link);
  const [nameDraft, setNameDraft] = useState(collabController.name);
  const [showSessions, setShowSessions] = useState(true);
  const autoCreateAttemptedRef = useRef(false);
  const bodyFont = resolveNativeFontStack(tokens.typography.fontSans, 400) || BODY_FONT;

  // Coding is a zero-setup surface: when the Pi service is reachable, keep a
  // persistent session alive automatically instead of asking for a join link.
  // A failed auto-create resets so the next visit retries once the service
  // or session list has recovered.
  useEffect(() => {
    if (controller.error) {
      autoCreateAttemptedRef.current = false;
      return;
    }
    if (controller.available !== true || controller.loading) return;
    if (controller.sessions.length === 0) {
      if (autoCreateAttemptedRef.current) return;
      autoCreateAttemptedRef.current = true;
      void controller.createSession();
      return;
    }
    if (!controller.activeSessionId && controller.sessions[0]?.id) {
      controller.selectSession(controller.sessions[0].id);
    }
  }, [controller]);

  useEffect(() => {
    if (!linkDraft && collabController.link) setLinkDraft(collabController.link);
  }, [collabController.link, linkDraft]);
  useEffect(() => {
    if (nameDraft === 'guest' && collabController.name !== 'guest') setNameDraft(collabController.name);
  }, [collabController.name, nameDraft]);

  const connect = () => {
    collabController.setName(nameDraft);
    collabController.connect(linkDraft, nameDraft);
  };
  const connectCurrent = () => {
    const next = currentLinks?.link || currentLinks?.web_link || '';
    if (!next) return;
    setLinkDraft(next);
    collabController.connect(next, nameDraft);
  };
  const currentLink = currentLinks?.link || currentLinks?.web_link || '';

  return (
    <ScrollView
      contentContainerStyle={{
        alignItems: 'center',
        flexGrow: 1,
        justifyContent: 'center',
        paddingBottom: 26 + safeAreaBottom,
        paddingHorizontal: 22 + Math.max(safeAreaLeft, safeAreaRight),
        paddingTop: 24,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: tokens.colors.background, flex: 1 }}
    >
      <View style={{ maxWidth: 560, width: '100%' }}>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', backgroundColor: multiplyAlpha(tokens.colors.primary, 0.14), borderRadius: 14, height: 42, justifyContent: 'center', width: 42 }}>
            <Text style={{ color: tokens.colors.primary, fontFamily: DISPLAY_FONT, fontSize: 23 }}>π</Text>
          </View>
          <View>
            <Text style={{ color: tokens.colors.foreground, fontFamily: DISPLAY_FONT, fontSize: 21, lineHeight: 28 }}>
              {isChinese ? 'Pi Coding' : 'Pi Coding'}
            </Text>
            <Text style={{ color: tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 9, letterSpacing: 0.6, marginTop: 2 }}>
              {isChinese ? '官方 collab-web 原生界面' : 'official collab-web · native Hermes surface'}
            </Text>
          </View>
          <CodingThemeToggle isChinese={isChinese} />
        </View>

        <View style={{ backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, borderRadius: 14, borderWidth: 1, marginTop: 22, padding: 15 }}>
          <Text style={{ color: tokens.colors.foreground, fontFamily: BODY_BOLD, fontSize: 14 }}>
            {isChinese ? '连接 Pi 会话' : 'Connect to a Pi session'}
          </Text>
          <Text style={{ color: tokens.colors.textSecondary, fontFamily: bodyFont, fontSize: 11, lineHeight: 17, marginTop: 5 }}>
            {isChinese
              ? 'Coding 会自动连接当前 Pi 持久会话；也可以粘贴个人写入链接或只读链接。'
              : 'Coding auto-connects to the current persistent Pi room. You can also paste a write or read-only link.'}
          </Text>

          <Text style={fieldLabel(tokens)}>{isChinese ? 'Join link' : 'Join link'}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setLinkDraft}
            onSubmitEditing={connect}
            placeholder="ws://host:8787/r/room.key"
            placeholderTextColor={tokens.colors.textDisabled}
            selectionColor={tokens.colors.primary}
            style={[fieldInput(tokens), { fontFamily: MONO_FONT }]}
            value={linkDraft}
          />
          <Text style={{ color: tokens.colors.textTertiary, fontFamily: bodyFont, fontSize: 10, lineHeight: 15, marginTop: 5 }}>
            {isChinese ? '支持官方 web_link、原生 ws(s) 链接和 room.key。' : 'Accepts an official web_link, native ws(s) link, or room.key.'}
          </Text>

          <Text style={fieldLabel(tokens)}>{isChinese ? '显示名称' : 'Display name'}</Text>
          <TextInput
            autoCapitalize="sentences"
            autoCorrect={false}
            maxLength={32}
            onChangeText={(value) => { setNameDraft(value); collabController.setName(value); }}
            onSubmitEditing={connect}
            placeholder="guest"
            placeholderTextColor={tokens.colors.textDisabled}
            selectionColor={tokens.colors.primary}
            style={[fieldInput(tokens), { fontFamily: bodyFont }]}
            value={nameDraft}
          />

          {collabController.error ? (
            <View style={{ backgroundColor: multiplyAlpha(tokens.colors.destructive, 0.1), borderColor: multiplyAlpha(tokens.colors.destructive, 0.38), borderRadius: 8, borderWidth: 1, marginTop: 10, padding: 9 }}>
              <Text style={{ color: tokens.colors.destructive, fontFamily: bodyFont, fontSize: 11, lineHeight: 16 }}>{collabController.error}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 13 }}>
            <IOSPressable
              accessibilityLabel={isChinese ? '连接 Pi' : 'Connect Pi'}
              disabled={!linkDraft.trim()}
              onPress={connect}
              pressedStyle={{ backgroundColor: tokens.colors.accent }}
              style={{ alignItems: 'center', backgroundColor: tokens.colors.primary, borderRadius: 8, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 38, opacity: linkDraft.trim() ? 1 : 0.45, paddingHorizontal: 13 }}
            >
              <LogIn color={tokens.colors.primaryForeground} size={14} />
              <Text style={{ color: tokens.colors.primaryForeground, fontFamily: BODY_BOLD, fontSize: 11 }}>{isChinese ? '连接' : 'Connect'}</Text>
            </IOSPressable>
            <IOSPressable
              accessibilityLabel={isChinese ? '连接当前 Pi 会话' : 'Connect current Pi session'}
              disabled={!currentLink}
              onPress={connectCurrent}
              pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.08) }}
              style={{ alignItems: 'center', borderColor: tokens.colors.border, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 38, opacity: currentLink ? 1 : 0.45, paddingHorizontal: 12 }}
            >
              <Zap color={tokens.colors.primary} size={14} />
              <Text style={{ color: tokens.colors.foreground, fontFamily: BODY_SEMIBOLD, fontSize: 11 }}>{isChinese ? '当前 Pi' : 'Current Pi'}</Text>
            </IOSPressable>
            <IOSPressable
              accessibilityLabel={isChinese ? '刷新 Pi 会话' : 'Refresh Pi sessions'}
              onPress={() => { void controller.refresh(); }}
              pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.08) }}
              style={{ alignItems: 'center', borderColor: tokens.colors.border, borderRadius: 8, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 }}
            >
              <RefreshCw color={tokens.colors.textSecondary} size={14} />
            </IOSPressable>
            <IOSPressable
              accessibilityLabel={isChinese ? '新建 Pi 会话' : 'Create a new Pi session'}
              disabled={controller.loading}
              onPress={() => { void controller.createSession({ name: nameDraft }); }}
              pressedStyle={{ backgroundColor: tokens.colors.accent }}
              style={{ alignItems: 'center', borderColor: tokens.colors.border, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 5, height: 38, justifyContent: 'center', opacity: controller.loading ? 0.45 : 1, paddingHorizontal: 10 }}
            >
              <Plus color={tokens.colors.primary} size={14} />
              <Text style={{ color: tokens.colors.foreground, fontFamily: BODY_SEMIBOLD, fontSize: 10 }}>{isChinese ? '新会话' : 'New session'}</Text>
            </IOSPressable>
          </View>
        </View>

        <IOSPressable
          accessibilityLabel={isChinese ? '显示 Pi 会话列表' : 'Show Pi session list'}
          onPress={() => setShowSessions((current) => !current)}
          pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.06) }}
          style={{ alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 15, paddingHorizontal: 5, paddingVertical: 7 }}
        >
          <ChevronDown color={tokens.colors.textSecondary} size={14} style={showSessions ? { transform: [{ rotate: '180deg' }] } : undefined} />
          <Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_SEMIBOLD, fontSize: 11 }}>{isChinese ? 'Pi 会话' : 'Pi sessions'}</Text>
          <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 10 }}>{controller.sessions.length}</Text>
        </IOSPressable>

        {showSessions ? (
          <View style={{ gap: 5 }}>
            {controller.sessions.length === 0 ? (
              <Text style={{ color: tokens.colors.textTertiary, fontFamily: bodyFont, fontSize: 11, paddingHorizontal: 7 }}>
                {controller.loading ? (isChinese ? '正在加载 Pi 会话…' : 'Loading Pi sessions…') : (isChinese ? '暂无可用会话' : 'No Pi sessions available')}
              </Text>
            ) : controller.sessions.map((session) => (
              <IOSPressable
                accessibilityLabel={`${isChinese ? '连接 Pi 会话' : 'Connect Pi session'} ${session.title}`}
                disabled={!session.collab?.link}
                key={session.id}
                onPress={() => {
                  controller.selectSession(session.id);
                  if (session.collab?.link) {
                    setLinkDraft(session.collab.link);
                    collabController.connect(session.collab.link, nameDraft);
                  }
                }}
                pressedStyle={{ backgroundColor: tokens.colors.accent }}
                style={{ backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, borderRadius: 8, borderWidth: 1, opacity: session.collab?.link ? 1 : 0.55, paddingHorizontal: 10, paddingVertical: 9 }}
              >
                <View style={{ alignItems: 'center', flexDirection: 'row', gap: 7 }}>
                  <View style={{ backgroundColor: session.status === 'running' ? tokens.colors.success : tokens.colors.textTertiary, borderRadius: 4, height: 7, width: 7 }} />
                  <Text numberOfLines={1} style={{ color: tokens.colors.foreground, flex: 1, fontFamily: BODY_SEMIBOLD, fontSize: 11 }}>{session.title || 'Coding session'}</Text>
                  <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 9 }}>{session.status}</Text>
                </View>
                <Text numberOfLines={1} style={{ color: tokens.colors.textSecondary, fontFamily: bodyFont, fontSize: 10, marginTop: 4 }}>{session.preview || session.workspace}</Text>
              </IOSPressable>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function CollabHeader({
  compact,
  isChinese,
  onLeave,
  onToggleAgents,
  onToggleShare,
  shareOpen,
  agentsOpen,
  snapshot,
}: {
  compact: boolean;
  isChinese: boolean;
  onLeave(): void;
  onToggleAgents(): void;
  onToggleShare(): void;
  shareOpen: boolean;
  agentsOpen: boolean;
  snapshot: CollabSnapshot;
}) {
  const { tokens } = useTheme();
  const state = snapshot.state;
  const title = snapshot.header?.title || state?.sessionName || 'session';
  const usage = state?.contextUsage;
  const percent = usage?.percent
    ?? (usage?.tokens !== null && usage?.tokens !== undefined && usage?.contextWindow
      ? (usage.tokens / usage.contextWindow) * 100
      : undefined);
  const phaseColor = snapshot.phase === 'live'
    ? tokens.colors.success
    : snapshot.phase === 'ended'
      ? tokens.colors.destructive
      : tokens.colors.warning;
  return (
    <View style={{ borderBottomColor: tokens.colors.border, borderBottomWidth: 1, paddingHorizontal: compact ? 9 : 13, paddingTop: 8 }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 32 }}>
        <View style={{ alignItems: 'center', backgroundColor: multiplyAlpha(tokens.colors.primary, 0.14), borderRadius: 9, height: 28, justifyContent: 'center', width: 28 }}>
          <Code2 color={tokens.colors.primary} size={15} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: tokens.colors.foreground, fontFamily: DISPLAY_FONT, fontSize: compact ? 12 : 14, lineHeight: 18 }}>{title}</Text>
          <Text numberOfLines={1} style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 9, lineHeight: 13, marginTop: 1 }}>{state?.cwd || snapshot.header?.cwd || 'Pi workspace'}</Text>
        </View>
        {snapshot.readOnly ? <HeaderChip label={isChinese ? '只读' : 'read-only'} tone="muted" /> : null}
        {state?.model?.name ? <HeaderChip label={state.model.name} tone="meta" /> : null}
        {state?.thinkingLevel ? <HeaderChip label={state.thinkingLevel} tone="meta" /> : null}
        {percent !== undefined ? (
          <View style={{ alignItems: 'flex-end', minWidth: 44 }}>
            <Text style={{ color: percent > 80 ? tokens.colors.warning : tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>{`ctx ${Math.round(percent)}%`}</Text>
            <View style={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.1), borderRadius: 2, height: 3, marginTop: 2, overflow: 'hidden', width: 44 }}>
              <View style={{ backgroundColor: percent > 80 ? tokens.colors.warning : tokens.colors.primary, height: 3, width: `${Math.max(0, Math.min(100, percent))}%` }} />
            </View>
          </View>
        ) : null}
        <View style={{ backgroundColor: phaseColor, borderRadius: 5, height: 8, shadowColor: phaseColor, shadowOpacity: 0.55, shadowRadius: 4, width: 8 }} />
        <CodingThemeToggle isChinese={isChinese} />
        <IOSPressable
            accessibilityLabel={isChinese ? '分享 Pi 会话' : 'Share Pi session'}
          onPress={onToggleShare}
          pressedStyle={{ backgroundColor: tokens.colors.accent }}
          style={[headerButtonStyle(tokens), shareOpen && { backgroundColor: tokens.colors.accent }]}
        >
          <Share2 color={tokens.colors.foreground} size={14} />
        </IOSPressable>
        <IOSPressable
          accessibilityLabel={isChinese ? '打开 Agent 面板' : 'Open agents panel'}
          onPress={onToggleAgents}
          pressedStyle={{ backgroundColor: tokens.colors.accent }}
          style={[headerButtonStyle(tokens), agentsOpen && { backgroundColor: tokens.colors.accent }]}
        >
          <PanelRight color={tokens.colors.foreground} size={14} />
          {snapshot.agents.some((agent) => agent.kind === 'sub') ? <View style={{ backgroundColor: tokens.colors.primary, borderRadius: 4, height: 7, position: 'absolute', right: 3, top: 3, width: 7 }} /> : null}
        </IOSPressable>
        <IOSPressable
          accessibilityLabel={isChinese ? '离开 Pi 会话' : 'Leave Pi session'}
          onPress={onLeave}
          pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.destructive, 0.16) }}
          style={headerButtonStyle(tokens)}
        >
          <LogOut color={tokens.colors.textSecondary} size={14} />
        </IOSPressable>
      </View>
      {state?.participants?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 5 }}>
          <View style={{ flexDirection: 'row', gap: 5, paddingBottom: 7 }}>
            {state.participants.map((participant, index) => (
              <HeaderChip key={`${participant.name}-${index}`} label={`${participant.name} · ${participant.role}`} tone={participant.role === 'host' ? 'accent' : 'meta'} />
            ))}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

function HeaderChip({ label, tone }: { label: string; tone: 'accent' | 'meta' | 'muted' }) {
  const { tokens } = useTheme();
  return (
    <View style={{ backgroundColor: tone === 'accent' ? multiplyAlpha(tokens.colors.primary, 0.12) : tokens.colors.card, borderColor: tone === 'accent' ? multiplyAlpha(tokens.colors.primary, 0.4) : tokens.colors.border, borderRadius: 5, borderWidth: 1, maxWidth: 128, paddingHorizontal: 5, paddingVertical: 3 }}>
      <Text numberOfLines={1} style={{ color: tone === 'accent' ? tokens.colors.primary : tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 8 }}>{label}</Text>
    </View>
  );
}

/**
 * The official collab page exposes a theme toggle in both its connect and
 * session headers. Hermes already owns the active theme, so the native
 * adaptation cycles the same global theme catalog instead of creating a
 * second collab-only color store.
 */
function CodingThemeToggle({ isChinese }: { isChinese: boolean }) {
  const { availableThemes, setTheme, themeName, tokens } = useTheme();
  const names = availableThemes.map((theme) => theme.name).filter(Boolean);
  const onPress = () => {
    if (names.length === 0) return;
    const currentIndex = Math.max(0, names.indexOf(themeName));
    void setTheme(names[(currentIndex + 1) % names.length]);
  };
  return (
    <IOSPressable
      accessibilityLabel={isChinese ? '切换 Coding 主题' : 'Switch Coding theme'}
      onPress={onPress}
      pressedStyle={{ backgroundColor: tokens.colors.accent }}
      style={headerButtonStyle(tokens)}
    >
      <Palette color={tokens.colors.foreground} size={14} />
    </IOSPressable>
  );
}

function CollabTranscript({
  compact,
  isChinese,
  onOpenAgent,
  safeAreaBottom,
  snapshot,
}: {
  compact: boolean;
  isChinese: boolean;
  onOpenAgent?(agentId: string): void;
  safeAreaBottom: number;
  snapshot: CollabSnapshot;
}) {
  const { tokens } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [followTail, setFollowTail] = useState(true);
  const results = useMemo(() => {
    const map = new Map<string, any>();
    for (const entry of snapshot.entries) {
      if (isMessageEntry(entry) && entry.message.role === 'toolResult') map.set(String(entry.message.toolCallId), entry.message);
    }
    return map;
  }, [snapshot.entries]);
  const renderedToolIds = new Set<string>();
  for (const entry of snapshot.entries) {
    const message = messageFromEntry(entry);
    if (message?.role === 'assistant') {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (isRecord(block) && block.type === 'toolCall' && typeof block.id === 'string') renderedToolIds.add(block.id);
      }
    }
  }
  if (isAssistantMessage(snapshot.stream)) {
    for (const block of snapshot.stream.content) {
      if (isRecord(block) && block.type === 'toolCall' && typeof block.id === 'string') renderedToolIds.add(block.id);
    }
  }
  const tailTools = [...snapshot.activeTools.values()].filter((tool) => !renderedToolIds.has(tool.toolCallId));
  useEffect(() => {
    if (!followTail) return;
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [snapshot.entries, snapshot.stream, snapshot.activeTools, snapshot.working, followTail]);

  return (
    <ScrollView
      contentContainerStyle={{ gap: compact ? 8 : 11, paddingBottom: 18 + safeAreaBottom, paddingHorizontal: compact ? 11 : 17, paddingTop: 15 }}
      decelerationRate="normal"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        setFollowTail(contentSize.height - contentOffset.y - layoutMeasurement.height < 50);
      }}
      ref={scrollRef}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
    >
      {snapshot.entries.length === 0 && !snapshot.stream && !snapshot.working ? (
        <View style={{ alignItems: 'center', paddingVertical: 45 }}>
          <Terminal color={tokens.colors.textTertiary} size={26} />
          <Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_MEDIUM, fontSize: 12, marginTop: 8 }}>{isChinese ? '暂无活动' : 'No activity yet'}</Text>
        </View>
      ) : null}
      {snapshot.entries.map((entry, index) => (
        <CollabEntryRow
          compact={compact}
           entry={entry}
           isChinese={isChinese}
           key={entryKey(entry, index)}
           onOpenAgent={onOpenAgent}
           results={results}
          snapshot={snapshot}
        />
      ))}
      {isAssistantMessage(snapshot.stream) ? (
        <CollabAssistantRow
          compact={compact}
          isChinese={isChinese}
           message={snapshot.stream}
           onOpenAgent={onOpenAgent}
           pending={!snapshot.streamDone}
          results={results}
          snapshot={snapshot}
        />
      ) : null}
      {tailTools.length ? (
        <View style={{ alignSelf: 'flex-start', gap: 4, maxWidth: '96%', width: '96%' }}>
          {tailTools.map((tool) => <ToolActivity key={tool.toolCallId} activity={activityForActiveTool(tool)} compact={compact} isChinese={isChinese} onOpenAgent={onOpenAgent} />)}
        </View>
      ) : null}
      {snapshot.working && !snapshot.stream && snapshot.activeTools.size === 0 ? (
        <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
          <View style={{ backgroundColor: tokens.colors.primary, borderRadius: 4, height: 8, marginTop: 5, width: 8 }} />
          <Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_MEDIUM, fontSize: 12 }}>{isChinese ? 'Pi 正在思考…' : 'Pi is thinking…'}</Text>
        </View>
      ) : null}
      {!followTail ? (
        <IOSPressable
          accessibilityLabel={isChinese ? '回到最新消息' : 'Jump to latest activity'}
          onPress={() => { setFollowTail(true); scrollRef.current?.scrollToEnd({ animated: true }); }}
          pressedStyle={{ backgroundColor: tokens.colors.accent }}
          style={{ alignItems: 'center', alignSelf: 'center', backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, borderRadius: 15, borderWidth: 1, bottom: 7, height: 30, justifyContent: 'center', position: 'absolute', width: 30 }}
        >
          <ChevronDown color={tokens.colors.textSecondary} size={16} />
        </IOSPressable>
      ) : null}
    </ScrollView>
  );
}

function CollabEntryRow({
  compact,
  entry,
  isChinese,
  onOpenAgent,
  results,
  snapshot,
}: {
  compact: boolean;
  entry: unknown;
  isChinese: boolean;
  onOpenAgent?(agentId: string): void;
  results: ReadonlyMap<string, any>;
  snapshot: CollabSnapshot;
}) {
  const message = messageFromEntry(entry);
  if (message) {
    if (message.role === 'toolResult' || message.role === 'developer') return null;
    if (message.role === 'user') return <CollabUserRow content={message.content} label="host" isChinese={isChinese} />;
    if (message.role === 'assistant') {
      return <CollabAssistantRow compact={compact} isChinese={isChinese} message={message} onOpenAgent={onOpenAgent} pending={false} results={results} snapshot={snapshot} />;
    }
  }
  if (isRecord(entry) && entry.type === 'custom_message') {
    const details = isRecord(entry.details) ? entry.details : {};
    // Official collab-web always renders the guest prompt custom entry. Other
    // custom entries remain hidden unless the host marks them displayable.
    if (entry.customType === 'collab-prompt') {
      return <CollabUserRow content={entry.content} label={stringValue(details.from, 'guest')} isChinese={isChinese} />;
    }
    if (entry.display !== true) return null;
    return <CollabCustomRow content={entry.content} customType={stringValue(entry.customType, 'custom')} />;
  }
  if (isRecord(entry) && entry.type === 'compaction') {
    return <TimelineMarker label={`${isChinese ? '上下文已压缩' : 'context compacted'} · ${entry.tokensBefore || 0} tokens`} />;
  }
  if (isRecord(entry) && entry.type === 'branch_summary') return <TimelineMarker label={isChinese ? '分支摘要' : 'branch summary'} />;
  if (isRecord(entry) && entry.type === 'model_change') return <TimelineMarker label={`model → ${stringValue(entry.model, 'unknown')}`} />;
  if (isRecord(entry) && entry.type === 'thinking_level_change') return <TimelineMarker label={`thinking → ${stringValue(entry.thinkingLevel, 'off')}`} />;
  return null;
}

function CollabUserRow({ content, label, isChinese }: { content: unknown; label: string; isChinese: boolean }) {
  const { tokens } = useTheme();
  return (
    <View style={{ alignItems: 'flex-end', alignSelf: 'flex-end', maxWidth: '88%' }}>
      <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8, marginBottom: 3, marginHorizontal: 3 }}>{label || (isChinese ? '用户' : 'user')}</Text>
      <View style={{ backgroundColor: multiplyAlpha(tokens.colors.primary, 0.13), borderColor: multiplyAlpha(tokens.colors.primary, 0.34), borderRadius: 9, borderTopRightRadius: 3, borderWidth: 1, maxWidth: '100%', paddingHorizontal: 11, paddingVertical: 8 }}>
        <CollabContent content={content} />
      </View>
    </View>
  );
}

function CollabCustomRow({ content, customType }: { content: unknown; customType: string }) {
  const { tokens } = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '96%', width: '96%' }}>
      <View style={{ backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, borderRadius: 9, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 }}>
        <View style={{ alignSelf: 'flex-start', backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.06), borderColor: tokens.colors.border, borderRadius: 5, borderWidth: 1, marginBottom: 6, paddingHorizontal: 6, paddingVertical: 3 }}>
          <Text style={{ color: tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 9 }}>{customType}</Text>
        </View>
        <CollabContent content={content} />
      </View>
    </View>
  );
}

function CollabAssistantRow({
  compact,
  isChinese,
  message,
  onOpenAgent,
  pending,
  results,
  snapshot,
}: {
  compact: boolean;
  isChinese: boolean;
  message: any;
  onOpenAgent?(agentId: string): void;
  pending: boolean;
  results: ReadonlyMap<string, any>;
  snapshot: CollabSnapshot;
}) {
  const { tokens } = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: '96%', width: '96%' }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 3, marginHorizontal: 3 }}>
        <View style={{ alignItems: 'center', backgroundColor: multiplyAlpha(tokens.colors.primary, 0.15), borderRadius: 7, height: 18, justifyContent: 'center', width: 18 }}><Code2 color={tokens.colors.primary} size={11} /></View>
        <Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_BOLD, fontSize: 10 }}>{isChinese ? 'Pi Agent' : 'Pi Agent'}</Text>
        {pending ? <Text style={{ color: tokens.colors.warning, fontFamily: MONO_FONT, fontSize: 8 }}>{isChinese ? '运行中' : 'streaming'}</Text> : null}
      </View>
      <View style={{ backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, borderRadius: 9, borderTopLeftRadius: 3, borderWidth: 1, paddingHorizontal: compact ? 9 : 11, paddingVertical: 8 }}>
        <AssistantBlocks compact={compact} isChinese={isChinese} message={message} onOpenAgent={onOpenAgent} pending={pending} results={results} snapshot={snapshot} />
      </View>
    </View>
  );
}

function AssistantBlocks({
  compact,
  isChinese,
  message,
  onOpenAgent,
  pending,
  results,
  snapshot,
}: {
  compact: boolean;
  isChinese: boolean;
  message: any;
  onOpenAgent?(agentId: string): void;
  pending: boolean;
  results: ReadonlyMap<string, any>;
  snapshot: CollabSnapshot;
}) {
  const { tokens } = useTheme();
  const blocks = Array.isArray(message.content) ? message.content : [];
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((block: any, index: number) => {
        if (!isRecord(block)) return null;
        if (block.type === 'thinking') return <ThinkingBlock key={`thinking-${index}`} text={stringValue(block.thinking, stringValue(block.text))} />;
        if (block.type === 'redactedThinking') return <ThinkingBlock key={`redacted-${index}`} redacted />;
        if (block.type === 'text') return <CollabContent key={`text-${index}`} content={block.text} />;
        if (block.type === 'image') return <CollabContent key={`image-${index}`} content={[block]} />;
        if (block.type === 'toolCall') {
          const id = stringValue(block.id, `tool-${index}`);
          const active = snapshot.activeTools.get(id);
          const result = results.get(id);
          return (
            <ToolActivity
              activity={activityForToolCall(block, active, result, pending)}
              compact={compact}
              isChinese={isChinese}
              key={id}
              onOpenAgent={onOpenAgent}
            />
          );
        }
        return null;
      })}
      {!pending && (message.stopReason === 'error' || message.stopReason === 'aborted') ? (
        <View style={{ alignItems: 'center', backgroundColor: multiplyAlpha(tokens.colors.destructive, 0.1), borderRadius: 6, flexDirection: 'row', gap: 5, padding: 7 }}>
          <CircleAlert color={tokens.colors.destructive} size={12} />
          <Text style={{ color: tokens.colors.destructive, fontFamily: BODY_MEDIUM, fontSize: 10 }}>{stringValue(message.errorMessage, message.stopReason)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ThinkingBlock({ text, redacted = false }: { text?: string; redacted?: boolean }) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ backgroundColor: multiplyAlpha(tokens.colors.primary, 0.055), borderColor: multiplyAlpha(tokens.colors.primary, 0.17), borderRadius: 7, borderWidth: 1, overflow: 'hidden' }}>
      <IOSPressable onPress={() => setOpen((current) => !current)} pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.primary, 0.1) }} style={{ alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 26, paddingHorizontal: 7 }}>
        <ChevronRight color={tokens.colors.primary} size={11} style={open ? { transform: [{ rotate: '90deg' }] } : undefined} />
        <Text style={{ color: tokens.colors.primary, fontFamily: BODY_SEMIBOLD, fontSize: 10 }}>{redacted ? 'thinking · redacted' : 'thinking'}</Text>
      </IOSPressable>
      {open ? <Text selectable style={{ color: tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 10, lineHeight: 15, padding: 8 }}>{redacted ? '(redacted by provider)' : text}</Text> : null}
    </View>
  );
}

function CollabContent({ content }: { content: unknown }) {
  const { tokens } = useTheme();
  const markdownStyles = {
    body: { color: tokens.colors.foreground, fontFamily: BODY_FONT, fontSize: 13, lineHeight: 20 },
    code_block: { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, borderRadius: 7, borderWidth: 1, color: tokens.colors.foreground, fontFamily: MONO_FONT, fontSize: 11, lineHeight: 16, padding: 9 },
    code_inline: { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.1), color: tokens.colors.primary, fontFamily: MONO_FONT },
    link: { color: tokens.colors.primary },
  };
  if (typeof content === 'string') return <Markdown style={markdownStyles}>{content}</Markdown>;
  if (!Array.isArray(content)) return null;
  return (
    <View style={{ gap: 6 }}>
      {content.map((block: any, index: number) => {
        if (!isRecord(block)) return null;
        if (block.type === 'text') return <Markdown key={index} style={markdownStyles}>{stringValue(block.text)}</Markdown>;
        if (block.type === 'image' && typeof block.data === 'string') return <Image key={index} resizeMode="contain" source={{ uri: `data:${stringValue(block.mimeType, 'image/png')};base64,${block.data}` }} style={{ borderRadius: 7, height: 180, maxWidth: '100%', width: 260 }} />;
        return null;
      })}
    </View>
  );
}

function TimelineMarker({ label }: { label: string }) {
  const { tokens } = useTheme();
  return <View style={{ alignItems: 'center', flexDirection: 'row', gap: 7, justifyContent: 'center', paddingVertical: 6 }}><View style={{ backgroundColor: tokens.colors.border, flex: 1, height: 1 }} /><Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>{label}</Text><View style={{ backgroundColor: tokens.colors.border, flex: 1, height: 1 }} /></View>;
}

function ToolActivity({ activity, compact, isChinese, onOpenAgent }: { activity: CodingPiActivity; compact: boolean; isChinese: boolean; onOpenAgent?(agentId: string): void }) {
  return <CodingPiToolCard activity={activity} compact={compact} isChinese={isChinese} onOpenAgent={onOpenAgent} />;
}

function activityForToolCall(block: any, active: CollabActiveTool | undefined, result: any, pending: boolean): CodingPiActivity {
  const failed = result?.isError === true;
  const done = Boolean(result);
  return {
    id: stringValue(block.id, active?.toolCallId || `tool-${Date.now()}`),
    title: stringValue(block.name, active?.toolName || 'tool'),
    detail: done ? toolResultText(result) : stringifyPiValue(block.arguments ?? active?.args),
    status: failed ? 'error' : done ? 'done' : pending || active ? 'running' : 'info',
    updatedAt: Date.now(),
    toolName: stringValue(block.name, active?.toolName || 'tool'),
    args: active?.args ?? block.arguments,
    result,
    partialResult: active?.partialResult,
    intent: stringValue(block.intent, active?.intent) || undefined,
  };
}

function activityForActiveTool(tool: CollabActiveTool): CodingPiActivity {
  return {
    id: tool.toolCallId,
    title: tool.toolName,
    detail: stringifyPiValue(tool.args),
    status: 'running',
    updatedAt: Date.now(),
    toolName: tool.toolName,
    args: tool.args,
    partialResult: tool.partialResult,
    intent: tool.intent,
  };
}

function CollabComposer({
  client,
  isChinese,
  safeAreaBottom,
  snapshot,
}: {
  client: NativeCollabClient;
  isChinese: boolean;
  safeAreaBottom: number;
  snapshot: CollabSnapshot;
}) {
  const { tokens } = useTheme();
  const [text, setText] = useState('');
  const [uiDraft, setUiDraft] = useState('');
  const inputRef = useRef<TextInput>(null);
  const request = snapshot.uiRequest;
  const canPrompt = snapshot.phase === 'live' && !snapshot.readOnly;
  const send = () => {
    if (!text.trim() || !canPrompt) return;
    client.sendPrompt(text);
    setText('');
  };
  useEffect(() => {
    setUiDraft(request?.kind === 'editor' ? request.prefill || '' : '');
  }, [request?.reqId]);
  return (
    <View style={{ backgroundColor: tokens.colors.background, paddingBottom: 7 + safeAreaBottom, paddingHorizontal: 9, paddingTop: 7 }}>
      {request && canPrompt ? (
        <View style={{ backgroundColor: tokens.colors.card, borderColor: tokens.colors.primary, borderRadius: 12, borderWidth: 1, padding: 10 }}>
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}><CircleAlert color={tokens.colors.primary} size={14} /><Text style={{ color: tokens.colors.foreground, flex: 1, fontFamily: BODY_BOLD, fontSize: 12 }}>{request.title}</Text></View>
          {request.kind === 'select' ? (
            <View style={{ gap: 4, marginTop: 8 }}>
              {request.helpText ? <Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_FONT, fontSize: 10, lineHeight: 15 }}>{request.helpText}</Text> : null}
              {request.options.map((option, index) => {
                const label = typeof option === 'string' ? option : option.label;
                const checked = request.checkedIndices?.includes(index) ?? false;
                return <IOSPressable key={`${request.reqId}-${index}`} onPress={() => client.sendUiResponse(request.reqId, label)} pressedStyle={{ backgroundColor: tokens.colors.accent }} style={{ alignItems: 'center', borderColor: checked ? tokens.colors.primary : tokens.colors.border, borderRadius: 7, borderWidth: 1, flexDirection: 'row', gap: 7, paddingHorizontal: 8, paddingVertical: 7 }}><View style={{ alignItems: 'center', borderColor: checked ? tokens.colors.primary : tokens.colors.textTertiary, borderRadius: request.selectionMarker === 'checkbox' ? 3 : 7, borderWidth: 1, height: 14, justifyContent: 'center', width: 14 }}>{checked ? <Check color={tokens.colors.primary} size={10} /> : null}</View><View style={{ flex: 1 }}><Text style={{ color: tokens.colors.foreground, fontFamily: BODY_MEDIUM, fontSize: 11 }}>{label}</Text>{typeof option !== 'string' && option.description ? <Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_FONT, fontSize: 9, marginTop: 2 }}>{option.description}</Text> : null}</View></IOSPressable>;
              })}
            </View>
          ) : (
            <TextInput autoFocus multiline onChangeText={setUiDraft} placeholder={isChinese ? '输入回复…' : 'Type your response…'} placeholderTextColor={tokens.colors.textDisabled} style={[composerInput(tokens), { fontFamily: BODY_FONT, minHeight: 64 }]} value={uiDraft} />
          )}
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'flex-end', marginTop: 7 }}>
            <IOSPressable onPress={() => client.sendUiResponse(request.reqId)} style={smallButtonStyle(tokens)}><Text style={smallButtonText(tokens)}>{isChinese ? '取消' : 'Cancel'}</Text></IOSPressable>
            {request.kind === 'editor' ? <IOSPressable onPress={() => client.sendUiResponse(request.reqId, uiDraft)} style={[smallButtonStyle(tokens), { backgroundColor: tokens.colors.primary }]}><Text style={{ color: tokens.colors.primaryForeground, fontFamily: BODY_BOLD, fontSize: 10 }}>{isChinese ? '提交' : 'Submit'}</Text></IOSPressable> : null}
            {snapshot.working ? <IOSPressable onPress={() => client.sendAbort()} style={[smallButtonStyle(tokens), { borderColor: multiplyAlpha(tokens.colors.destructive, 0.5) }]}><Square color={tokens.colors.destructive} size={11} /><Text style={{ color: tokens.colors.destructive, fontFamily: BODY_BOLD, fontSize: 10 }}>{isChinese ? '停止' : 'Stop'}</Text></IOSPressable> : null}
          </View>
        </View>
      ) : (
        <View style={{ backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, borderRadius: 13, borderWidth: 1, overflow: 'hidden' }}>
          <TextInput
            blurOnSubmit={false}
            editable={canPrompt}
            multiline
            onChangeText={setText}
            onSubmitEditing={send}
            placeholder={snapshot.readOnly ? (isChinese ? '只读会话 · 仅查看' : 'read-only session · watching only') : snapshot.phase === 'live' ? (isChinese ? '向 Pi Agent 发送任务…' : 'Prompt the Pi agent…') : (isChinese ? '等待 Pi 会话…' : 'Waiting for Pi session…')}
            placeholderTextColor={tokens.colors.textDisabled}
            ref={inputRef}
            returnKeyType="send"
            selectionColor={tokens.colors.primary}
            style={[composerInput(tokens), { color: tokens.colors.foreground, fontFamily: resolveNativeFontStack(tokens.typography.fontSans, 400) || BODY_FONT, opacity: canPrompt ? 1 : 0.6 }]}
            value={text}
          />
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'flex-end', minHeight: 36, paddingBottom: 6, paddingHorizontal: 8 }}>
            {snapshot.working && snapshot.state?.queuedMessageCount ? <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 9 }}>{`${isChinese ? '排队' : 'queued'} ×${snapshot.state.queuedMessageCount}`}</Text> : null}
            {snapshot.working && !snapshot.readOnly ? <IOSPressable onPress={() => client.sendAbort()} style={[smallButtonStyle(tokens), { borderColor: multiplyAlpha(tokens.colors.destructive, 0.5) }]}><Square color={tokens.colors.destructive} size={11} /><Text style={{ color: tokens.colors.destructive, fontFamily: BODY_BOLD, fontSize: 10 }}>{isChinese ? '停止' : 'Stop'}</Text></IOSPressable> : null}
            <IOSPressable accessibilityLabel={isChinese ? '发送 Pi 任务' : 'Send Pi prompt'} disabled={!canPrompt || !text.trim()} onPress={send} pressedStyle={{ backgroundColor: tokens.colors.accent }} style={{ alignItems: 'center', backgroundColor: tokens.colors.primary, borderRadius: 17, height: 32, justifyContent: 'center', opacity: canPrompt && text.trim() ? 1 : 0.4, width: 32 }}><Send color={tokens.colors.primaryForeground} size={14} /></IOSPressable>
          </View>
        </View>
      )}
    </View>
  );
}

function CollabAgentsPanel({
  agents,
  isChinese,
  lifecycle,
  onClose,
  onSelect,
  progress,
}: {
  agents: readonly CollabAgentSnapshot[];
  isChinese: boolean;
  lifecycle: ReadonlyMap<string, CollabSubagentLifecyclePayload>;
  onClose(): void;
  onSelect(agent: CollabAgentSnapshot): void;
  progress: ReadonlyMap<string, CollabSubagentProgressPayload>;
}) {
  const { tokens } = useTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const sorted = [...agents].sort((left, right) => (left.kind === 'main' ? -1 : right.kind === 'main' ? 1 : Number(right.status === 'running') - Number(left.status === 'running')));
  return (
    <View style={{ flex: 1 }}>
      <View style={{ alignItems: 'center', borderBottomColor: tokens.colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: 7, minHeight: 47, paddingHorizontal: 11 }}>
        <Users color={tokens.colors.primary} size={15} /><Text style={{ color: tokens.colors.foreground, flex: 1, fontFamily: DISPLAY_FONT, fontSize: 13 }}>{isChinese ? 'Agents' : 'Agents'}</Text><IOSPressable accessibilityLabel={isChinese ? '关闭 Agent 面板' : 'Close agents panel'} onPress={onClose} style={{ alignItems: 'center', height: 28, justifyContent: 'center', width: 28 }}><X color={tokens.colors.textSecondary} size={16} /></IOSPressable>
      </View>
      <ScrollView contentContainerStyle={{ gap: 6, padding: 9 }} showsVerticalScrollIndicator={false}>
        {sorted.map((agent) => {
          const payload = progress.get(agent.id)?.progress;
          const life = lifecycle.get(agent.id);
          const activity = payload?.currentTool || payload?.lastIntent || life?.status || agent.status;
          const age = agent.lastActivity > 0 ? formatRelativeTime(now - agent.lastActivity) : '';
          const duration = payload?.currentToolStartMs ? formatDuration(now - payload.currentToolStartMs) : payload?.durationMs ? formatDuration(payload.durationMs) : '';
          return (
            <IOSPressable key={agent.id} onPress={() => onSelect(agent)} pressedStyle={{ backgroundColor: tokens.colors.accent }} style={{ backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, borderRadius: 8, borderWidth: 1, padding: 8 }}>
              <View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}>
                <View style={{ backgroundColor: statusColor(agent.status, tokens), borderRadius: 4, height: 8, width: 8 }} />
                <Text numberOfLines={1} style={{ color: tokens.colors.foreground, flex: 1, fontFamily: BODY_SEMIBOLD, fontSize: 11 }}>{agent.displayName || agent.id}</Text>
                <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>{agent.kind}</Text>
              </View>
              <Text numberOfLines={2} style={{ color: tokens.colors.textSecondary, fontFamily: BODY_FONT, fontSize: 10, lineHeight: 14, marginTop: 5 }}>{activity}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 5 }}>
                {payload?.tokens !== undefined ? <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>{formatCount(payload.tokens)} tok</Text> : null}
                {payload?.cost !== undefined ? <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>${payload.cost.toFixed(3)}</Text> : null}
                {payload?.toolCount !== undefined ? <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>{payload.toolCount} tools</Text> : null}
                {duration ? <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>{duration}</Text> : null}
                {age ? <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>{age}</Text> : null}
              </View>
            </IOSPressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function CollabAgentDrawer({
  agent,
  client,
  isChinese,
  lifecycle,
  onClose,
  progress,
  readOnly,
}: {
  agent: CollabAgentSnapshot;
  client: NativeCollabClient;
  isChinese: boolean;
  lifecycle?: CollabSubagentLifecyclePayload;
  onClose(): void;
  progress?: CollabSubagentProgressPayload;
  readOnly: boolean;
}) {
  const { tokens } = useTheme();
  const [chatText, setChatText] = useState('');
  const [transcriptEntries, setTranscriptEntries] = useState<unknown[]>([]);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const transcriptEntriesRef = useRef<unknown[]>([]);
  const transcriptCursorRef = useRef(0);
  const transcriptCarryRef = useRef('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let terminalError = false;
    transcriptEntriesRef.current = [];
    transcriptCursorRef.current = 0;
    transcriptCarryRef.current = '';
    setTranscriptEntries([]);
    setTranscriptError(null);
    const poll = async () => {
      if (!active || inFlight || !agent.hasSessionFile) return;
      inFlight = true;
      try {
        const result = await client.fetchTranscript(agent.id, transcriptCursorRef.current);
        if (!active || !result) return;
        if (result.kind === 'error') {
          terminalError = true;
          setTranscriptError(result.message || (isChinese ? 'transcript 读取失败' : 'transcript read failed'));
          return;
        }
        const parsed = parseTranscriptJsonl(result.text || '', transcriptCarryRef.current);
        transcriptCarryRef.current = parsed.carry;
        if (parsed.items.length > 0) {
          const next = [...transcriptEntriesRef.current, ...parsed.items].slice(-400);
          transcriptEntriesRef.current = next;
          setTranscriptEntries(next);
        }
        transcriptCursorRef.current = Math.max(transcriptCursorRef.current, result.newSize || transcriptCursorRef.current);
      } finally {
        inFlight = false;
        if (active && !terminalError) timer = setTimeout(poll, 1_200);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [agent.hasSessionFile, agent.id, client, isChinese]);
  const sendChat = () => {
    if (!chatText.trim() || readOnly) return;
    client.sendAgentCommand('chat', agent.id, chatText.trim());
    setChatText('');
  };
  const progressState = progress?.progress;
  const contextPercent = progressState?.contextTokens !== undefined && progressState.contextWindow
    ? Math.max(0, Math.min(100, (progressState.contextTokens / progressState.contextWindow) * 100))
    : undefined;
  const canKill = agent.status === 'running' && !readOnly;
  const canRevive = (agent.status === 'parked' || agent.status === 'aborted') && !readOnly;
  const drawerSnapshot: CollabSnapshot = {
    activeTools: new Map(),
    agents: [],
    endedReason: null,
    entries: transcriptEntries,
    header: null,
    lifecycle: new Map(),
    notices: [],
    phase: agent.status === 'running' ? 'live' : 'ended',
    progress: new Map(),
    readOnly,
    state: null,
    stream: null,
    streamDone: false,
    uiRequest: null,
    working: agent.status === 'running' && transcriptError === null,
  };
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={{ backgroundColor: tokens.colors.background, flex: 1, paddingBottom: 10 }}>
        <View style={{ alignItems: 'center', borderBottomColor: tokens.colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: 8, minHeight: 55, paddingHorizontal: 15 }}>
          <IOSPressable accessibilityLabel={isChinese ? '返回 Agent 列表' : 'Back to agents'} onPress={onClose} style={{ alignItems: 'center', height: 32, justifyContent: 'center', width: 32 }}><ChevronLeft color={tokens.colors.foreground} size={22} /></IOSPressable>
          <View style={{ backgroundColor: multiplyAlpha(tokens.colors.primary, 0.14), borderRadius: 9, height: 28, justifyContent: 'center', width: 28 }}><UserRound color={tokens.colors.primary} size={15} style={{ alignSelf: 'center' }} /></View>
          <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: tokens.colors.foreground, fontFamily: DISPLAY_FONT, fontSize: 15 }}>{agent.displayName || agent.id}</Text><Text numberOfLines={1} style={{ color: tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 8, marginTop: 2 }}>{`${agent.kind} · ${agent.status}${progressState?.resolvedModel ? ` · ${progressState.resolvedModel}` : ''}`}</Text></View>
          {canKill ? <IOSPressable accessibilityLabel={isChinese ? '停止 Agent' : 'Kill agent'} onPress={() => client.sendAgentCommand('kill', agent.id)} style={agentActionStyle(tokens, true)}><Text style={{ color: tokens.colors.destructive, fontFamily: BODY_SEMIBOLD, fontSize: 10 }}>{isChinese ? '停止' : 'Kill'}</Text></IOSPressable> : null}
          {canRevive ? <IOSPressable accessibilityLabel={isChinese ? '恢复 Agent' : 'Revive agent'} onPress={() => client.sendAgentCommand('revive', agent.id)} style={agentActionStyle(tokens, false)}><Text style={{ color: tokens.colors.foreground, fontFamily: BODY_SEMIBOLD, fontSize: 10 }}>{isChinese ? '恢复' : 'Revive'}</Text></IOSPressable> : null}
        </View>
        <ScrollView contentContainerStyle={{ gap: 10, padding: 14 }} showsVerticalScrollIndicator={false}>
          <View style={{ backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, borderRadius: 9, borderWidth: 1, padding: 10 }}>
            <Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>{isChinese ? '当前状态' : 'Current activity'}</Text>
            <Text style={{ color: tokens.colors.foreground, fontFamily: BODY_MEDIUM, fontSize: 12, lineHeight: 17, marginTop: 5 }}>{progressState?.currentTool || progressState?.lastIntent || lifecycle?.status || agent.status}</Text>
            {progressState?.contextWindow && progressState.contextTokens !== undefined ? <View style={{ marginTop: 8 }}><View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>context</Text><Text style={{ color: contextPercent && contextPercent > 80 ? tokens.colors.warning : tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8 }}>{`${formatCount(progressState.contextTokens)} / ${formatCount(progressState.contextWindow)} · ${Math.round(contextPercent || 0)}%`}</Text></View><View style={{ backgroundColor: multiplyAlpha(tokens.colors.foreground, 0.1), borderRadius: 3, height: 4, marginTop: 4, overflow: 'hidden' }}><View style={{ backgroundColor: contextPercent && contextPercent > 80 ? tokens.colors.warning : tokens.colors.primary, height: 4, width: `${contextPercent || 0}%` }} /></View></View> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 7 }}><Text style={{ color: tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 9 }}>{progressState?.tokens !== undefined ? `${formatCount(progressState.tokens)} tok` : '—'}</Text><Text style={{ color: tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 9 }}>{progressState?.cost !== undefined ? `$${progressState.cost.toFixed(3)}` : '—'}</Text><Text style={{ color: tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 9 }}>{progressState?.toolCount !== undefined ? `${progressState.toolCount} tools` : '—'}</Text><Text style={{ color: tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 9 }}>{progressState?.durationMs !== undefined ? formatDuration(progressState.durationMs) : '—'}</Text></View>
          </View>
          <View style={{ backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, borderRadius: 9, borderWidth: 1, minHeight: 300, overflow: 'hidden' }}>
            <View style={{ borderBottomColor: tokens.colors.border, borderBottomWidth: 1, paddingHorizontal: 10, paddingVertical: 8 }}><Text style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>{isChinese ? '子 Agent Transcript' : 'Sub-agent transcript'}</Text></View>
            {agent.hasSessionFile ? <View style={{ height: 360 }}><CollabTranscript compact isChinese={isChinese} safeAreaBottom={0} snapshot={drawerSnapshot} /></View> : <Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_FONT, fontSize: 11, padding: 12 }}>{isChinese ? '该 Agent 没有 transcript 文件' : 'No transcript file for this agent'}</Text>}
            {transcriptError ? <Text selectable style={{ color: tokens.colors.destructive, fontFamily: MONO_FONT, fontSize: 9, lineHeight: 14, padding: 10 }}>{`${isChinese ? 'transcript 不可用：' : 'transcript unavailable: '}${transcriptError}`}</Text> : null}
          </View>
        </ScrollView>
        {!readOnly ? <View style={{ borderTopColor: tokens.colors.border, borderTopWidth: 1, padding: 9 }}><View style={{ backgroundColor: tokens.colors.card, borderColor: tokens.colors.border, borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 6, padding: 5 }}><TextInput editable multiline onChangeText={setChatText} onSubmitEditing={sendChat} placeholder={isChinese ? '向 Agent 发送消息…' : 'Chat with this agent…'} placeholderTextColor={tokens.colors.textDisabled} returnKeyType="send" style={{ color: tokens.colors.foreground, flex: 1, fontFamily: BODY_FONT, fontSize: 12, maxHeight: 76, minHeight: 36, paddingHorizontal: 7, paddingTop: 8 }} value={chatText} /><IOSPressable accessibilityLabel={isChinese ? '发送 Agent 消息' : 'Send agent message'} disabled={!chatText.trim()} onPress={sendChat} style={{ alignItems: 'center', backgroundColor: tokens.colors.primary, borderRadius: 16, height: 32, justifyContent: 'center', marginTop: 2, opacity: !chatText.trim() ? 0.4 : 1, width: 32 }}><Send color={tokens.colors.primaryForeground} size={13} /></IOSPressable></View></View> : null}
      </View>
    </Modal>
  );
}

function CollabSharePanel({ fallbackLink, isChinese, links, onClose }: { fallbackLink?: string; isChinese: boolean; links?: HermesCodingPiCollabLinks | null; onClose(): void }) {
  const { tokens } = useTheme();
  const shareLink = async (link: string | undefined) => { if (link) await Share.share({ message: link }).catch(() => undefined); };
  const copyLink = async (link: string | undefined) => { if (link) await Clipboard.setStringAsync(link).catch(() => undefined); };
  return (
    <View style={{ backgroundColor: tokens.colors.card, borderBottomColor: tokens.colors.border, borderBottomWidth: 1, padding: 10 }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 7 }}>
        <Share2 color={tokens.colors.primary} size={14} />
        <Text style={{ color: tokens.colors.foreground, flex: 1, fontFamily: BODY_BOLD, fontSize: 12 }}>{isChinese ? '分享与协作' : 'Share and collaborate'}</Text>
        <IOSPressable onPress={onClose} style={{ alignItems: 'center', height: 25, justifyContent: 'center', width: 25 }}><X color={tokens.colors.textSecondary} size={15} /></IOSPressable>
      </View>
      <Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_FONT, fontSize: 10, lineHeight: 15, marginTop: 4 }}>{isChinese ? '写入链接可以操作 Pi；只读链接只接收 transcript。官方分享链接会由接收方打开 collab-web。' : 'Write links can operate Pi; read-only links only receive the transcript. Official share links open collab-web for recipients.'}</Text>
      <ShareLinkRow label={isChinese ? '当前连接' : 'Current connection'} link={fallbackLink} onCopy={copyLink} onShare={shareLink} />
      <ShareLinkRow label={isChinese ? 'Hermes 原生写入' : 'Hermes native write'} link={links?.link} onCopy={copyLink} onShare={shareLink} />
      <ShareLinkRow label={isChinese ? '官方 collab-web 写入' : 'Official collab-web write'} link={links?.web_link} onCopy={copyLink} onShare={shareLink} />
      <ShareLinkRow label={isChinese ? 'Hermes 原生只读' : 'Hermes native read-only'} link={links?.view_link} onCopy={copyLink} onShare={shareLink} />
      <ShareLinkRow label={isChinese ? '官方 collab-web 只读' : 'Official collab-web read-only'} link={links?.web_view_link} onCopy={copyLink} onShare={shareLink} />
    </View>
  );
}

function ShareLinkRow({ label, link, onCopy, onShare }: { label: string; link?: string; onCopy(link?: string): void; onShare(link?: string): void }) {
  const { tokens } = useTheme();
  if (!link) return null;
  return <View style={{ marginTop: 8 }}><View style={{ alignItems: 'center', flexDirection: 'row', gap: 6 }}><Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_SEMIBOLD, fontSize: 10, flex: 1 }}>{label}</Text><IOSPressable onPress={() => onCopy(link)} style={shareActionStyle(tokens)}><Copy color={tokens.colors.textSecondary} size={12} /></IOSPressable><IOSPressable onPress={() => onShare(link)} style={shareActionStyle(tokens)}><Share2 color={tokens.colors.textSecondary} size={12} /></IOSPressable></View><Text selectable numberOfLines={2} style={{ color: tokens.colors.textTertiary, fontFamily: MONO_FONT, fontSize: 8, lineHeight: 12, marginTop: 4 }}>{link}</Text></View>;
}

function CollabBanner({
  isChinese,
  onNewLink,
  onRejoin,
  snapshot,
}: {
  isChinese: boolean;
  onNewLink(): void;
  onRejoin(): void;
  snapshot: CollabSnapshot;
}) {
  const { tokens } = useTheme();
  if (snapshot.phase === 'live') return null;
  const label = snapshot.phase === 'connecting' ? 'connecting to relay…' : snapshot.phase === 'waiting' ? 'joining session…' : snapshot.phase === 'reconnecting' ? 'reconnecting…' : 'session ended';
  if (snapshot.phase === 'ended') {
    return (
      <View style={{ alignItems: 'center', backgroundColor: multiplyAlpha(tokens.colors.background, 0.96), bottom: 0, justifyContent: 'center', left: 0, padding: 20, position: 'absolute', right: 0, top: 0, zIndex: 30 }}>
        <View style={{ backgroundColor: tokens.colors.card, borderColor: multiplyAlpha(tokens.colors.destructive, 0.42), borderRadius: 13, borderWidth: 1, maxWidth: 430, padding: 16, width: '100%' }}>
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: 7 }}>
            <CircleAlert color={tokens.colors.destructive} size={16} />
            <Text style={{ color: tokens.colors.destructive, fontFamily: BODY_BOLD, fontSize: 13 }}>{isChinese ? '会话已结束' : 'session ended'}</Text>
          </View>
          <Text selectable style={{ color: tokens.colors.textSecondary, fontFamily: BODY_FONT, fontSize: 11, lineHeight: 17, marginTop: 7 }}>{snapshot.endedReason || (isChinese ? 'Pi 房间已不可用。' : 'The Pi room is no longer available.')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
            <IOSPressable onPress={onRejoin} pressedStyle={{ backgroundColor: multiplyAlpha(tokens.colors.primaryForeground, 0.12) }} style={{ alignItems: 'center', backgroundColor: tokens.colors.primary, borderRadius: 8, minHeight: 36, justifyContent: 'center', paddingHorizontal: 12 }}>
              <Text style={{ color: tokens.colors.primaryForeground, fontFamily: BODY_BOLD, fontSize: 11 }}>{isChinese ? '重新加入' : 'Rejoin'}</Text>
            </IOSPressable>
            <IOSPressable onPress={onNewLink} pressedStyle={{ backgroundColor: tokens.colors.accent }} style={{ alignItems: 'center', borderColor: tokens.colors.border, borderRadius: 8, borderWidth: 1, minHeight: 36, justifyContent: 'center', paddingHorizontal: 12 }}>
              <Text style={{ color: tokens.colors.foreground, fontFamily: BODY_SEMIBOLD, fontSize: 11 }}>{isChinese ? '新链接' : 'New link'}</Text>
            </IOSPressable>
          </View>
        </View>
      </View>
    );
  }
  return <View style={{ alignItems: 'center', backgroundColor: multiplyAlpha(tokens.colors.warning, 0.08), borderBottomColor: multiplyAlpha(tokens.colors.warning, 0.25), borderBottomWidth: 1, flexDirection: 'row', gap: 7, paddingHorizontal: 11, paddingVertical: 7 }}><View style={{ backgroundColor: tokens.colors.warning, borderRadius: 4, height: 7, width: 7 }} /><Text style={{ color: tokens.colors.textSecondary, fontFamily: BODY_FONT, fontSize: 10 }}>{label}</Text></View>;
}

function CollabToasts({ isChinese, notices }: { isChinese: boolean; notices: readonly { id: number; level: string; message: string; at: number }[] }) {
  const { tokens } = useTheme();
  const [dismissed, setDismissed] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const timers = notices
      .filter((notice) => notice.level !== 'error' && !dismissed.has(notice.id))
      .map((notice) => {
        const ttl = notice.level === 'info' ? 4_000 : 8_000;
        const remaining = Math.max(0, notice.at + ttl - Date.now());
        return setTimeout(() => setDismissed((current) => new Set(current).add(notice.id)), remaining);
      });
    return () => timers.forEach(clearTimeout);
  }, [dismissed, notices]);
  const visible = notices.filter((notice) => !dismissed.has(notice.id)).slice(-4);
  if (!visible.length) return null;
  return <View style={{ gap: 5, left: 10, position: 'absolute', right: 10, top: 10, zIndex: 20 }}>{visible.map((notice) => <View key={notice.id} style={{ alignItems: 'center', backgroundColor: notice.level === 'error' ? multiplyAlpha(tokens.colors.destructive, 0.94) : tokens.colors.card, borderColor: notice.level === 'error' ? tokens.colors.destructive : tokens.colors.border, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 9, paddingVertical: 7 }}><CircleAlert color={notice.level === 'error' ? tokens.colors.primaryForeground : tokens.colors.warning} size={12} /><Text style={{ color: notice.level === 'error' ? tokens.colors.primaryForeground : tokens.colors.foreground, flex: 1, fontFamily: BODY_FONT, fontSize: 10, lineHeight: 14 }}>{notice.message}</Text>{notice.level === 'error' ? <IOSPressable onPress={() => setDismissed((current) => new Set(current).add(notice.id))} style={{ height: 22, justifyContent: 'center', width: 22 }}><X color={tokens.colors.primaryForeground} size={12} /></IOSPressable> : null}</View>)}</View>;
}

function isMessageEntry(value: unknown): value is { type: 'message'; message: any } {
  return isRecord(value) && value.type === 'message' && isRecord(value.message);
}

function messageFromEntry(value: unknown): any | null {
  return isMessageEntry(value) ? value.message : null;
}

function isAssistantMessage(value: unknown): value is { role: 'assistant'; content: any[]; [key: string]: any } {
  return isRecord(value) && value.role === 'assistant' && Array.isArray(value.content);
}

function entryKey(entry: unknown, index: number): string {
  return isRecord(entry) && typeof entry.id === 'string' ? entry.id : `entry-${index}`;
}

function activityForCurrentTool(tool: CollabActiveTool): CodingPiActivity {
  return activityForActiveTool(tool);
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatRelativeTime(milliseconds: number): string {
  if (milliseconds < 5_000) return 'now';
  if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1_000)}s ago`;
  if (milliseconds < 3_600_000) return `${Math.floor(milliseconds / 60_000)}m ago`;
  if (milliseconds < 86_400_000) return `${Math.floor(milliseconds / 3_600_000)}h ago`;
  return `${Math.floor(milliseconds / 86_400_000)}d ago`;
}

function agentActionStyle(tokens: ReturnType<typeof useTheme>['tokens'], destructive: boolean) {
  return {
    alignItems: 'center' as const,
    borderColor: destructive ? multiplyAlpha(tokens.colors.destructive, 0.45) : tokens.colors.border,
    borderRadius: 7,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center' as const,
    paddingHorizontal: 9,
  };
}

function parseTranscriptJsonl(text: string, carry: string): { items: unknown[]; carry: string } {
  const lines = `${carry}${text}`.split(/\r?\n/);
  let nextCarry = lines.pop() || '';
  const items: unknown[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      items.push(JSON.parse(line));
    } catch {
      // A torn JSONL row is kept as carry on the next poll. Completed rows
      // remain visible even when an extension writes a non-JSON diagnostic.
    }
  }
  // A completed JSONL record may arrive without its final newline. The file
  // cursor has already advanced past it, so it is safe to emit it now rather
  // than waiting forever for another write.
  if (nextCarry.trim()) {
    try {
      items.push(JSON.parse(nextCarry));
      nextCarry = '';
    } catch {
      // Keep an incomplete final row for the next poll.
    }
  }
  return { items, carry: nextCarry };
}

function statusColor(status: string, tokens: ReturnType<typeof useTheme>['tokens']): string {
  return status === 'running' ? tokens.colors.warning : status === 'idle' ? tokens.colors.success : status === 'aborted' || status === 'parked' ? tokens.colors.destructive : tokens.colors.textTertiary;
}

function headerButtonStyle(tokens: ReturnType<typeof useTheme>['tokens']) {
  return { alignItems: 'center' as const, borderColor: tokens.colors.border, borderRadius: 7, borderWidth: 1, height: 28, justifyContent: 'center' as const, position: 'relative' as const, width: 28 };
}

function fieldLabel(tokens: ReturnType<typeof useTheme>['tokens']) {
  return { color: tokens.colors.textSecondary, fontFamily: MONO_FONT, fontSize: 9, letterSpacing: 0.4, marginTop: 12, textTransform: 'uppercase' as const };
}

function fieldInput(tokens: ReturnType<typeof useTheme>['tokens']) {
  return { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, borderRadius: 8, borderWidth: 1, color: tokens.colors.foreground, fontSize: 11, lineHeight: 16, marginTop: 5, minHeight: 38, paddingHorizontal: 9, paddingVertical: 8 };
}

function composerInput(tokens: ReturnType<typeof useTheme>['tokens']) {
  return { color: tokens.colors.foreground, fontSize: 13, lineHeight: 19, maxHeight: 120, minHeight: 54, paddingHorizontal: 13, paddingTop: 12, textAlignVertical: 'top' as const };
}

function smallButtonStyle(tokens: ReturnType<typeof useTheme>['tokens']) {
  return { alignItems: 'center' as const, borderColor: tokens.colors.border, borderRadius: 7, borderWidth: 1, flexDirection: 'row' as const, gap: 5, minHeight: 28, paddingHorizontal: 8 };
}

function smallButtonText(tokens: ReturnType<typeof useTheme>['tokens']) {
  return { color: tokens.colors.textSecondary, fontFamily: BODY_SEMIBOLD, fontSize: 10 };
}

function shareActionStyle(tokens: ReturnType<typeof useTheme>['tokens']) {
  return { alignItems: 'center' as const, borderColor: tokens.colors.border, borderRadius: 6, borderWidth: 1, height: 26, justifyContent: 'center' as const, width: 28 };
}

const overlayStyle = {
  bottom: 0,
  flexDirection: 'row' as const,
  left: 0,
  position: 'absolute' as const,
  right: 0,
  top: 0,
  zIndex: 10,
};

const panelStyle = {
  borderLeftWidth: 1,
  bottom: 0,
  position: 'absolute' as const,
  right: 0,
  top: 0,
  width: 292,
};
