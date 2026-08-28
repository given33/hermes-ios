import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import {
  Maximize,
  MessagesSquare,
  RefreshCw,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react-native';

import { NativeButton } from '../../components/ui/NativeButton';
import { PreviewText } from '../PreviewPrimitives';
import { useTheme } from '../../design/ThemeProvider';
import { resolveNativeFontStack } from '../../design/native-font-faces';
import type { HermesApiClient } from '../../api/HermesApiClient';
import { hermesCloudApiFor } from '../../api/hermes-api-registry';
import {
  managedNodeGatewayStatuses,
  type ManagedNodeGatewayState,
} from '../../api/managed-node-status';

type WorkspaceAgentState = ManagedNodeGatewayState;

interface WorkspaceAgent {
  id: string;
  name: string;
  role: string;
  state: WorkspaceAgentState;
  x: number;
  y: number;
}

interface Facility {
  id: string;
  title: string;
  description: string;
  detail: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const SCENE_WIDTH = 320;
const SCENE_HEIGHT = 180;
const ZOOM_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;

function stateColor(state: WorkspaceAgentState, palette: Record<string, string>) {
  return state === 'online'
    ? palette.success
    : state === 'degraded'
      ? palette.warning
      : state === 'offline'
        ? palette.destructive
        : palette.muted;
}

function agentMood(state: WorkspaceAgentState, tick: number) {
  const online = ['专注', '好奇', '稳定', '轻快'];
  const degraded = ['警觉', '认真', '急切'];
  const offline = ['安静', '困倦', '等待'];
  const pool = state === 'online' ? online : state === 'degraded' ? degraded : offline;
  return pool[tick % pool.length];
}

function agentAction(state: WorkspaceAgentState, tick: number) {
  const online = ['巡检设施', '整理记忆', '校准工具', '绘制计划'];
  const degraded = ['排查链路', '重试握手', '检查心跳'];
  const offline = ['保存进度', '低功耗待机', '监听信号'];
  const pool = state === 'online' ? online : state === 'degraded' ? degraded : offline;
  return pool[(tick + 1) % pool.length];
}

function stateLabel(state: WorkspaceAgentState, isChinese: boolean) {
  if (state === 'online') return isChinese ? '在线' : 'Online';
  if (state === 'degraded') return isChinese ? '降级' : 'Degraded';
  if (state === 'offline') return isChinese ? '离线' : 'Offline';
  return isChinese ? '未知' : 'Unknown';
}

export function AgentWorkspacePage({
  client,
  compact,
  fixtureMode,
  isChinese,
  navigate,
  notify,
}: {
  client?: HermesApiClient | null;
  compact?: boolean;
  fixtureMode?: boolean;
  isChinese: boolean;
  navigate(path: string): void;
  notify(message: string): void;
}) {
  const { tokens } = useTheme();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const wideLayout = compact === false || windowWidth > windowHeight;
  const [tick, setTick] = useState(0);
  const [selectedFacility, setSelectedFacility] = useState('command');
  const [selectedAgent, setSelectedAgent] = useState('hermes-manager');
  const [zoomIndex, setZoomIndex] = useState(0);
  const [sceneFrame, setSceneFrame] = useState({ height: 0, width: 0 });
  const [serverOnline, setServerOnline] = useState(fixtureMode && !client);
  const [nodes, setNodes] = useState(() => managedNodeGatewayStatuses({}));
  const [loading, setLoading] = useState(Boolean(client));
  const bodyFont = resolveNativeFontStack(tokens.typography.fontDisplay, 400);
  const cloudApi = useMemo(
    () => (client ? hermesCloudApiFor(client) : null),
    [client],
  );

  const reload = useCallback(async () => {
    if (!cloudApi) {
      setServerOnline(true);
      setNodes(managedNodeGatewayStatuses({
        nodes: [
          { gateway_state: 'ready', id: 'dbb3', observed_at: Date.now(), online: true },
          { gateway_state: 'ready', id: 'wsl', observed_at: Date.now(), online: true },
          { gateway_state: 'ready', id: 'hk', observed_at: Date.now(), online: true },
        ],
      }));
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const system = await cloudApi.getSystem();
      setServerOnline(true);
      setNodes(managedNodeGatewayStatuses(system.managedNodes));
    } catch {
      setServerOnline(false);
      setNodes(managedNodeGatewayStatuses({}));
    } finally {
      setLoading(false);
    }
  }, [cloudApi]);

  useEffect(() => {
    void reload();
    const statusTimer = setInterval(() => { void reload(); }, 12_000);
    const lifeTimer = setInterval(() => setTick((value) => value + 1), 3_200);
    return () => {
      clearInterval(statusTimer);
      clearInterval(lifeTimer);
    };
  }, [reload]);

  const nodeState = (id: string) => (
    nodes.find((node) => node.id === id)?.state ?? 'unknown'
  );
  const agents = useMemo<WorkspaceAgent[]>(() => [
    {
      id: 'hermes-manager',
      name: 'Hermes Manager',
      role: isChinese ? '服务器调度' : 'Server planner',
      state: serverOnline ? 'online' : 'offline',
      x: 138,
      y: 82,
    },
    {
      id: 'dbb3-worker',
      name: 'DBB3 Worker',
      role: isChinese ? 'DBB3 执行' : 'DBB3 runner',
      state: nodeState('dbb3'),
      x: 78,
      y: 104,
    },
    {
      id: 'pc-worker',
      name: 'WSL Worker',
      role: isChinese ? 'WSL 执行' : 'WSL runner',
      state: nodeState('wsl'),
      x: 198,
      y: 104,
    },
    {
      id: 'hk-worker',
      name: 'HK Worker',
      role: isChinese ? '香港执行' : 'Hong Kong runner',
      state: nodeState('hk'),
      x: 138,
      y: 140,
    },
  ], [isChinese, nodes, serverOnline]);

  const facilities = useMemo<Facility[]>(() => [
    {
      id: 'command',
      title: isChinese ? '指挥台' : 'Command deck',
      description: isChinese ? 'Manager 在这里拆解任务。' : 'The manager plans work here.',
      detail: isChinese
        ? '复杂任务会生成计划，再派给 DBB3、WSL 或 HK。普通聊天绕过这里，直接走快速路径。'
        : 'Complex tasks become plans before dispatch to DBB3, WSL, or Hong Kong.',
      x: 118,
      y: 62,
      width: 84,
      height: 34,
    },
    {
      id: 'memory',
      title: isChinese ? '记忆书架' : 'Memory shelf',
      description: isChinese ? '长期上下文按账号隔离。' : 'Account-scoped long-term context.',
      detail: isChinese
        ? '切换账号时清空本地缓存，避免旧会话串进新身份。'
        : 'Local cache resets when the account changes.',
      x: 22,
      y: 58,
      width: 58,
      height: 30,
    },
    {
      id: 'forge',
      title: isChinese ? '工具工坊' : 'Tool forge',
      description: isChinese ? '工具调用在这里预热。' : 'Warm tool execution.',
      detail: isChinese
        ? 'Worker 保持连接和预热，减少第一次工具调用的等待。'
        : 'Workers stay warm to reduce first-tool latency.',
      x: 240,
      y: 58,
      width: 58,
      height: 30,
    },
    {
      id: 'relay',
      title: isChinese ? '事件中继' : 'Event relay',
      description: isChinese ? '增量事件推送到 iOS。' : 'Streams deltas to iOS.',
      detail: isChinese
        ? '模型正文、Todo、工具状态共用同一条有序事件流。'
        : 'One ordered stream feeds every UI surface.',
      x: 24,
      y: 112,
      width: 54,
      height: 28,
    },
    {
      id: 'rest',
      title: isChinese ? '休整舱' : 'Rest pod',
      description: isChinese ? '离线节点保留恢复点。' : 'Offline nodes keep checkpoints.',
      detail: isChinese
        ? '断线任务进入可恢复队列，重连后按 cursor 补齐。'
        : 'Durable tasks resume after reconnect.',
      x: 242,
      y: 112,
      width: 54,
      height: 28,
    },
  ], [isChinese]);

  const activeFacility = facilities.find((item) => item.id === selectedFacility) || facilities[0];
  const activeAgent = agents.find((item) => item.id === selectedAgent) || agents[0];
  const zoom = ZOOM_STEPS[zoomIndex];
  const sceneScale = sceneFrame.width && sceneFrame.height
    ? Math.min(sceneFrame.width / SCENE_WIDTH, sceneFrame.height / SCENE_HEIGHT)
    : 0;
  const sceneContent = {
    height: SCENE_HEIGHT * sceneScale,
    left: (sceneFrame.width - SCENE_WIDTH * sceneScale) / 2,
    top: (sceneFrame.height - SCENE_HEIGHT * sceneScale) / 2,
    width: SCENE_WIDTH * sceneScale,
  };
  const palette = {
    success: tokens.colors.success,
    warning: tokens.colors.warning,
    destructive: tokens.colors.destructive,
    muted: tokens.colors.textTertiary,
  };

  return (
    <ScrollView contentContainerStyle={[styles.content, wideLayout && styles.contentWide]}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Sparkles color={tokens.colors.primary} size={18} />
          <PreviewText variant="heading">
            {isChinese ? 'Agent 空间' : 'Agent Workspace'}
          </PreviewText>
        </View>
        <View style={styles.headerActions}>
          <NativeButton
            ghost
            onPress={() => navigate('/agent-group')}
            prefix={<MessagesSquare size={14} />}
            size="sm"
          >
            {isChinese ? '房间' : 'Rooms'}
          </NativeButton>
          <NativeButton
            accessibilityLabel={isChinese ? '刷新节点状态' : 'Refresh node status'}
            ghost
            onPress={() => {
              void reload();
              notify(isChinese ? '正在刷新 Agent 状态' : 'Refreshing agent status');
            }}
            prefix={<RefreshCw size={14} />}
            size="sm"
          >
            {isChinese ? '刷新' : 'Refresh'}
          </NativeButton>
        </View>
      </View>

      <View style={[styles.workspaceLayout, wideLayout && styles.workspaceLayoutWide]}>
        <View style={[styles.sceneColumn, wideLayout && styles.sceneColumnWide]}>
          <View
            onLayout={(event) => {
              const { height, width } = event.nativeEvent.layout;
              setSceneFrame((current) => (
                Math.abs(current.height - height) < 0.5
                  && Math.abs(current.width - width) < 0.5
                  ? current
                  : { height, width }
              ));
            }}
            style={[
              styles.sceneFrame,
              { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border },
              {
                maxHeight: Math.max(
                  210,
                  Math.min(windowHeight * (wideLayout ? 0.68 : 0.52), windowWidth),
                ),
              },
            ]}
          >
            {sceneScale > 0 ? (
              <View
                style={[
                  styles.sceneContent,
                  {
                    height: sceneContent.height,
                    left: sceneContent.left,
                    top: sceneContent.top,
                    transform: [{ scale: zoom }],
                    width: sceneContent.width,
                  },
                ]}
              >
                <Svg height="100%" viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`} width="100%">
                  <Rect fill={tokens.colors.background} height={SCENE_HEIGHT} width={SCENE_WIDTH} />
                  {[...Array(9)].map((_, index) => (
                    <Rect
                      fill={index % 2 ? '#2A4A72' : '#1F3A5F'}
                      height={4}
                      key={`star-${index}`}
                      opacity={0.7}
                      width={4}
                      x={12 + index * 35}
                      y={8 + (index % 3) * 6}
                    />
                  ))}
                  <Rect fill="#12314F" height={94} width={SCENE_WIDTH - 16} x={8} y={26} />
                  {[...Array(6)].map((_, row) => (
                    [...Array(10)].map((__, column) => (
                      <Rect
                        fill={(row + column) % 2 ? '#20476E' : '#183A5C'}
                        height={9}
                        key={`floor-${row}-${column}`}
                        width={15}
                        x={8 + column * 15}
                        y={120 + row * 9}
                      />
                    ))
                  ))}
                  {facilities.map((facility) => (
                    <Rect
                      fill={facility.id === activeFacility.id ? tokens.colors.primary : '#31567F'}
                      height={facility.height}
                      key={facility.id}
                      opacity={facility.id === activeFacility.id ? 0.28 : 0.85}
                      rx={2}
                      stroke={facility.id === activeFacility.id ? tokens.colors.primary : '#4A7BA8'}
                      strokeWidth={facility.id === activeFacility.id ? 2 : 1}
                      width={facility.width}
                      x={facility.x}
                      y={facility.y}
                    />
                  ))}
                </Svg>

                {facilities.map((facility) => (
                  <Pressable
                    accessibilityLabel={facility.title}
                    accessibilityRole="button"
                    key={facility.id}
                    onPress={() => setSelectedFacility(facility.id)}
                    style={{
                      alignItems: 'center',
                      height: facility.height,
                      justifyContent: 'center',
                      left: facility.x,
                      position: 'absolute',
                      top: facility.y,
                      width: facility.width,
                    }}
                  >
                    <PreviewText numberOfLines={1} style={{ color: tokens.colors.foreground }} variant="tiny">
                      {facility.title}
                    </PreviewText>
                  </Pressable>
                ))}
                {agents.map((agent) => (
                  <Pressable
                    accessibilityLabel={agent.name}
                    accessibilityRole="button"
                    hitSlop={4}
                    key={agent.id}
                    onPress={() => setSelectedAgent(agent.id)}
                    style={{
                      bottom: SCENE_HEIGHT - agent.y - 20,
                      left: agent.x,
                      position: 'absolute',
                    }}
                  >
                    <View
                      style={[
                        styles.sprite,
                        {
                          backgroundColor: stateColor(agent.state, palette),
                          height: Math.max(10, 12 * sceneScale),
                          marginBottom: Math.max(3, 4 * sceneScale),
                          width: Math.max(8, 10 * sceneScale),
                        },
                        agent.id === selectedAgent && styles.spriteSelected,
                      ]}
                    />
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={[styles.zoomBar, { backgroundColor: multiplyAlpha(tokens.colors.background, 0.82) }]}>
              <NativeButton
                accessibilityLabel={isChinese ? '缩小界面' : 'Zoom out'}
                disabled={zoomIndex === 0}
                ghost
                onPress={() => setZoomIndex((value) => Math.max(0, value - 1))}
                size="icon"
              >
                <ZoomOut color={tokens.colors.foreground} size={15} />
              </NativeButton>
              <NativeButton
                accessibilityLabel={isChinese ? '重置缩放' : 'Reset zoom'}
                disabled={zoomIndex === 0}
                ghost
                onPress={() => setZoomIndex(0)}
                size="icon"
              >
                <Maximize color={tokens.colors.foreground} size={15} />
              </NativeButton>
              <NativeButton
                accessibilityLabel={isChinese ? '放大界面' : 'Zoom in'}
                disabled={zoomIndex === ZOOM_STEPS.length - 1}
                ghost
                onPress={() => setZoomIndex((value) => Math.min(ZOOM_STEPS.length - 1, value + 1))}
                size="icon"
              >
                <ZoomIn color={tokens.colors.foreground} size={15} />
              </NativeButton>
            </View>
          </View>
        </View>

        <View style={[styles.sideColumn, wideLayout && styles.sideColumnWide]}>
          <View style={[styles.panel, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
            <PreviewText variant="label">{activeFacility.title}</PreviewText>
            <PreviewText style={{ color: tokens.colors.foreground }} variant="body">
              {activeFacility.description}
            </PreviewText>
            <PreviewText style={{ color: tokens.colors.textSecondary }} variant="tiny">
              {activeFacility.detail}
            </PreviewText>
          </View>

          <View style={[styles.panel, { backgroundColor: tokens.colors.card, borderColor: tokens.colors.border }]}>
            <View style={styles.agentHeader}>
              <View>
                <PreviewText variant="label">{activeAgent.name}</PreviewText>
                <PreviewText style={{ color: tokens.colors.textSecondary }} variant="tiny">
                  {activeAgent.role}
                </PreviewText>
              </View>
              <View style={[styles.statePill, { backgroundColor: multiplyAlpha(stateColor(activeAgent.state, palette), 0.14) }]}>
                <PreviewText
                  style={{
                    color: stateColor(activeAgent.state, palette),
                    fontFamily: bodyFont,
                    fontSize: 11,
                  }}
                >
                  {stateLabel(activeAgent.state, isChinese)}
                </PreviewText>
              </View>
            </View>
            <PreviewText style={{ color: tokens.colors.foreground }} variant="body">
              {isChinese
                ? `心情：${agentMood(activeAgent.state, tick)} · 动作：${agentAction(activeAgent.state, tick)}`
                : `Mood ${agentMood(activeAgent.state, tick)} · ${agentAction(activeAgent.state, tick)}`}
            </PreviewText>
            <NativeButton
              loading={loading}
              onPress={() => {
                void reload();
                notify(isChinese
                  ? `${activeAgent.name} 收到检查指令`
                  : `${activeAgent.name} received a check command`);
              }}
              prefix={<RefreshCw size={14} />}
              size="sm"
            >
              {isChinese ? '让 Agent 自检' : 'Run self-check'}
            </NativeButton>
          </View>

          <View style={styles.agentRow}>
            {agents.map((agent) => (
              <Pressable
                accessibilityLabel={agent.name}
                accessibilityRole="button"
                key={agent.id}
                onPress={() => setSelectedAgent(agent.id)}
                style={[
                  styles.agentChip,
                  {
                    backgroundColor: tokens.colors.card,
                    borderColor: agent.id === selectedAgent ? tokens.colors.primary : tokens.colors.border,
                  },
                ]}
              >
                <View style={[styles.dot, { backgroundColor: stateColor(agent.state, palette) }]} />
                <PreviewText numberOfLines={1} style={{ color: tokens.colors.foreground }} variant="tiny">
                  {agent.name}
                </PreviewText>
              </Pressable>
            ))}
          </View>

          {!client && !fixtureMode ? (
            <PreviewText style={{ color: tokens.colors.warning }} variant="tiny">
              {isChinese
                ? '未连接服务器，当前显示本地演示状态。'
                : 'Server unavailable; showing the local demo.'}
            </PreviewText>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

function multiplyAlpha(color: string, alpha: number) {
  const hex = color.replace('#', '');
  const full = hex.length === 3
    ? hex.split('').map((part) => part + part).join('')
    : hex;
  if (full.length !== 6) return color;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    padding: 16,
  },
  contentWide: {
    alignSelf: 'center',
    maxWidth: 1180,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  titleBlock: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  workspaceLayout: {
    gap: 12,
  },
  workspaceLayoutWide: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
  },
  sceneColumn: {
    minWidth: 0,
    width: '100%',
  },
  sceneColumnWide: {
    flex: 1,
    minWidth: 0,
    width: 'auto',
  },
  sideColumn: {
    gap: 12,
    width: '100%',
  },
  sideColumnWide: {
    flexBasis: 330,
    flexGrow: 0,
    flexShrink: 0,
    maxWidth: 380,
  },
  sceneFrame: {
    aspectRatio: 16 / 9,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  sceneContent: {
    position: 'absolute',
  },
  zoomBar: {
    borderRadius: 999,
    flexDirection: 'row',
    padding: 2,
    position: 'absolute',
    right: 8,
    top: 8,
    zIndex: 2,
  },
  sprite: {
    borderRadius: 2,
  },
  spriteSelected: {
    boxShadow: '0 0 0 2px rgba(255,255,255,0.72)',
  },
  panel: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  agentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statePill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  agentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  agentChip: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  dot: {
    borderRadius: 5,
    height: 7,
    width: 7,
  },
});
