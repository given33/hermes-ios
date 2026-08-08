import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import Reanimated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { HermesApiClient } from '../api/HermesApiClient';
import type {
  CustomModelConfiguration,
  CustomModelConnectionResult,
} from '../api/HermesCloudApi';
import { customModelApiKeyAction } from '../api/cloud/models';
import { hermesCloudApiFor } from '../api/hermes-api-registry';
import { IOSPressable } from '../components/ios/IOSPressable';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { ScreenState } from '../components/ui/ScreenState';
import { MOTION, useMotion } from '../design/motion';
import { useTheme } from '../design/ThemeProvider';
import {
  PreviewBadge,
  PreviewCard,
  PreviewPage,
  PreviewSegmented,
  PreviewText,
} from '../studio/PreviewPrimitives';

interface ModelsManagementPageProps {
  client: HermesApiClient;
  locale?: 'en' | 'zh';
  notify(message: string): void;
  profile: string;
}

type ModelOperationState = {
  kind: 'discover' | 'save' | 'test';
  message: string;
  state: 'error' | 'running' | 'success';
} | null;

export function ModelsManagementPage({
  client,
  locale = 'zh',
  notify,
  profile,
}: ModelsManagementPageProps) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const api = useMemo(() => hermesCloudApiFor(client), [client]);
  const chinese = locale === 'zh';
  const [apiKey, setApiKey] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyDeleteRequested, setApiKeyDeleteRequested] = useState(false);
  const [apiKeyPreview, setApiKeyPreview] = useState('');
  const [apiMode, setApiMode] = useState<CustomModelConfiguration['apiMode']>('chat_completions');
  const [baseUrl, setBaseUrl] = useState('');
  const [contextLength, setContextLength] = useState('131072');
  const [detectedExpanded, setDetectedExpanded] = useState(false);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState('');
  const [operation, setOperation] = useState<ModelOperationState>(null);
  const [reasoningEffort, setReasoningEffort] = useState<CustomModelConfiguration['reasoningEffort']>('medium');
  // Disclosure chevron rotates with the shared control timing instead of the
  // previous instant transform swap; withTiming retargets mid-flight, so fast
  // taps stay interruptible, and Reduce Motion collapses it to a snap.
  const chevronTurns = useSharedValue(0);
  useEffect(() => {
    chevronTurns.value = withTiming(detectedExpanded ? 180 : 0, {
      duration: motion.duration(MOTION.duration.control),
      easing: Easing.bezier(...MOTION.easing.standard),
    });
  }, [chevronTurns, detectedExpanded, motion]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronTurns.value}deg` }],
  }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = await api.getCustomModel(profile);
      setApiKey('');
      setApiKeyConfigured(current.apiKeyConfigured === true);
      setApiKeyDeleteRequested(false);
      setApiKeyPreview(current.apiKeyConfigured ? current.apiKeyPreview || '********' : '');
      setApiMode(current.apiMode);
      setBaseUrl(current.baseUrl);
      setContextLength(String(current.contextLength || 131072));
      setModel(current.model);
      setReasoningEffort(current.reasoningEffort);
    } catch (error) {
      setOperation({ kind: 'save', message: modelPageError(error, chinese), state: 'error' });
    } finally {
      setLoading(false);
    }
  }, [api, chinese, profile]);

  useEffect(() => { void load(); }, [load]);

  const configuration = useCallback((): CustomModelConfiguration => ({
    apiKey,
    apiKeyAction: customModelApiKeyAction(apiKey, {
      deleteRequested: apiKeyDeleteRequested,
      preview: apiKeyPreview,
    }),
    apiMode,
    baseUrl,
    contextLength: Number.parseInt(contextLength, 10) || 0,
    model,
    reasoningEffort,
  }), [
    apiKey,
    apiKeyDeleteRequested,
    apiKeyPreview,
    apiMode,
    baseUrl,
    contextLength,
    model,
    reasoningEffort,
  ]);

  const invalidateDetection = () => {
    setDetectedExpanded(false);
    setDetectedModels([]);
  };

  // Stable handler so the memoized detected-model rows keep identical props
  // while unrelated form fields re-render the page on every keystroke.
  const selectDetectedModel = useCallback((entry: string) => {
    setModel(entry);
    setDetectedExpanded(false);
  }, []);

  const discover = async () => {
    setOperation({
      kind: 'discover',
      message: chinese ? '正在检测可用模型...' : 'Detecting available models...',
      state: 'running',
    });
    try {
      const result = await api.discoverCustomModels(baseUrl, apiKey, profile, apiMode);
      if (!result.ok) throw new Error(modelConnectionFailure(chinese ? '模型检测' : 'Model detection', result, chinese));
      setDetectedModels(result.models);
      if (!result.models.includes(model)) setModel(result.models[0] || '');
      setDetectedExpanded(true);
      const message = chinese
        ? `检测到 ${result.models.length} 个可用模型（${result.latency_ms} ms）`
        : `Detected ${result.models.length} models in ${result.latency_ms} ms`;
      setOperation({ kind: 'discover', message, state: 'success' });
      notify(message);
    } catch (error) {
      const message = modelPageError(error, chinese);
      setOperation({ kind: 'discover', message, state: 'error' });
      notify(message);
    }
  };

  const testConnection = async () => {
    setOperation({
      kind: 'test',
      message: chinese ? '正在测试模型连接...' : 'Testing model connection...',
      state: 'running',
    });
    try {
      const result = await api.testCustomModel(configuration(), profile);
      if (!result.ok || !result.reachable) {
        throw new Error(modelConnectionFailure(chinese ? '连接测试' : 'Connection test', result, chinese));
      }
      const message = chinese
        ? `连接成功（HTTP ${result.status}，${result.latency_ms} ms）`
        : `Connected (HTTP ${result.status}, ${result.latency_ms} ms)`;
      setOperation({ kind: 'test', message, state: 'success' });
      notify(message);
    } catch (error) {
      const message = modelPageError(error, chinese);
      setOperation({ kind: 'test', message, state: 'error' });
      notify(message);
    }
  };

  const save = async () => {
    setOperation({
      kind: 'save',
      message: chinese ? '正在保存模型配置...' : 'Saving model configuration...',
      state: 'running',
    });
    try {
      const saved = await api.saveCustomModel(configuration(), profile);
      const preview = typeof saved.api_key_preview === 'string' ? saved.api_key_preview : '';
      const configured = saved.api_key_configured === true;
      setApiKeyConfigured(configured);
      setApiKeyPreview(configured ? preview || '********' : '');
      setApiKeyDeleteRequested(false);
      setApiKey('');
      const message = chinese ? '模型配置已保存' : 'Model configuration saved';
      setOperation({ kind: 'save', message, state: 'success' });
      notify(message);
    } catch (error) {
      const message = modelPageError(error, chinese);
      setOperation({ kind: 'save', message, state: 'error' });
      notify(message);
    }
  };

  const valid = Boolean(baseUrl.trim() && model.trim() && Number(contextLength) > 0);
  const busy = operation?.state === 'running';
  if (loading) {
    return (
      <ScreenState
        kind="loading"
        message={chinese ? '正在读取模型配置' : 'Loading model configuration'}
      />
    );
  }

  return (
    <PreviewPage title={chinese ? '模型' : 'Models'}>
      <PreviewCard title={chinese ? '当前模型' : 'Current model'}>
        {/* Loaded form fades in over the loading state instead of popping. */}
        <Reanimated.View
          entering={motion.animate(FadeIn.duration(MOTION.duration.transition))}
          style={styles.fields}
        >
          <PreviewText variant="label">Base URL</PreviewText>
          <NativeInput
            autoCapitalize="none"
            onChangeText={(value) => {
              setBaseUrl(value);
              invalidateDetection();
            }}
            placeholder="https://example.com/v1"
            value={baseUrl}
          />
          <PreviewText variant="label">{chinese ? 'API 密钥' : 'API key'}</PreviewText>
          <NativeInput
            autoCapitalize="none"
            onChangeText={(value) => {
              setApiKey(value);
              if (value.trim()) setApiKeyDeleteRequested(false);
              invalidateDetection();
            }}
            placeholder={apiKeyPreview
              ? `${chinese ? '已保存' : 'Saved'} ${apiKeyPreview}`
              : chinese ? '输入 API 密钥' : 'Enter API key'}
            secureTextEntry
            value={apiKey}
          />
          {apiKeyConfigured ? (
            <IOSPressable
              accessibilityLabel={apiKeyDeleteRequested
                ? (chinese ? '取消删除已保存密钥' : 'Keep saved API key')
                : (chinese ? '删除已保存密钥' : 'Delete saved API key')}
              disabled={busy}
              onPress={() => {
                setApiKey('');
                setApiKeyDeleteRequested((current) => !current);
              }}
              style={styles.keyAction}
            >
              <Trash2
                color={apiKeyDeleteRequested
                  ? tokens.colors.destructive
                  : tokens.colors.textSecondary}
                size={16}
              />
              <PreviewText variant="label">
                {apiKeyDeleteRequested
                  ? (chinese ? '保存时删除密钥，点此撤销' : 'Delete on save; tap to undo')
                  : (chinese ? '删除已保存密钥' : 'Delete saved API key')}
              </PreviewText>
            </IOSPressable>
          ) : null}

          <View style={[styles.detectionBox, { borderColor: tokens.colors.border }]}>
            <View style={styles.detectionHeader}>
              <IOSPressable
                disabled={busy || !baseUrl.trim()}
                onPress={() => {
                  if (!detectedModels.length) void discover();
                  else setDetectedExpanded((current) => !current);
                }}
                style={styles.detectionMain}
              >
                {operation?.kind === 'discover' && operation.state === 'running'
                  ? <ActivityIndicator color={tokens.colors.foreground} size="small" />
                  : <Search color={tokens.colors.foreground} size={16} />}
                <PreviewText variant="label">{chinese ? '检测可用模型' : 'Detect models'}</PreviewText>
                <View style={styles.spacer} />
                {detectedModels.length ? (
                  <>
                    <PreviewBadge tone="outline">{String(detectedModels.length)}</PreviewBadge>
                    <Reanimated.View style={chevronStyle}>
                      <ChevronDown color={tokens.colors.textSecondary} size={15} />
                    </Reanimated.View>
                  </>
                ) : null}
              </IOSPressable>
              {detectedModels.length ? (
                <IOSPressable
                  accessibilityLabel={chinese ? '重新检测可用模型' : 'Detect models again'}
                  disabled={busy || !baseUrl.trim()}
                  onPress={() => { void discover(); }}
                  style={styles.refreshButton}
                >
                  <RefreshCw color={tokens.colors.foreground} size={15} />
                </IOSPressable>
              ) : null}
            </View>
            {detectedExpanded ? (
              <Reanimated.View
                entering={motion.animate(FadeIn.duration(MOTION.duration.transition))}
              >
                {detectedModels.map((entry) => (
                  <DetectedModelRow
                    borderColor={tokens.colors.border}
                    emptyColor={tokens.colors.textTertiary}
                    entry={entry}
                    key={entry}
                    onSelect={selectDetectedModel}
                    selected={model === entry}
                    selectedColor={tokens.colors.success}
                  />
                ))}
              </Reanimated.View>
            ) : null}
          </View>

          {!detectedModels.length ? (
            <>
              <PreviewText variant="label">{chinese ? '模型名称' : 'Model'}</PreviewText>
              <NativeInput autoCapitalize="none" onChangeText={setModel} value={model} />
            </>
          ) : null}
          <PreviewText variant="label">{chinese ? '接口协议' : 'API protocol'}</PreviewText>
          <PreviewSegmented
            onChange={(value) => setApiMode(value as CustomModelConfiguration['apiMode'])}
            options={[
              { label: 'Chat Completions', value: 'chat_completions' },
              { label: 'Responses', value: 'codex_responses' },
              { label: 'Anthropic', value: 'anthropic_messages' },
            ]}
            value={apiMode}
          />
          <PreviewText variant="label">{chinese ? '上下文长度' : 'Context length'}</PreviewText>
          <NativeInput keyboardType="number-pad" onChangeText={setContextLength} value={contextLength} />
          <PreviewText variant="label">{chinese ? '推理强度' : 'Reasoning effort'}</PreviewText>
          <PreviewSegmented
            onChange={(value) => setReasoningEffort(value as CustomModelConfiguration['reasoningEffort'])}
            options={[
              { label: chinese ? '关闭' : 'None', value: 'none' },
              { label: chinese ? '中' : 'Medium', value: 'medium' },
              { label: chinese ? '高' : 'High', value: 'high' },
              { label: chinese ? '极高' : 'XHigh', value: 'xhigh' },
            ]}
            value={reasoningEffort as 'none' | 'medium' | 'high' | 'xhigh'}
          />
          <View style={styles.actions}>
            <NativeButton
              disabled={!valid || busy}
              onPress={() => { void testConnection(); }}
              outlined
            >
              {chinese ? '测试连接' : 'Test connection'}
            </NativeButton>
            <NativeButton disabled={!valid || busy} onPress={() => { void save(); }}>
              {chinese ? '保存' : 'Save'}
            </NativeButton>
          </View>
          {operation ? (
            <Reanimated.View
              entering={motion.animate(FadeIn.duration(MOTION.duration.control))}
              style={[
                styles.operation,
                {
                  backgroundColor: tokens.colors.muted,
                  borderColor: operation.state === 'error'
                    ? tokens.colors.destructive
                    : operation.state === 'success'
                      ? tokens.colors.success
                      : tokens.colors.border,
                },
              ]}
            >
              {operation.state === 'running'
                ? <ActivityIndicator color={tokens.colors.foreground} size="small" />
                : operation.state === 'success'
                  ? <CheckCircle2 color={tokens.colors.success} size={17} />
                  : <AlertCircle color={tokens.colors.destructive} size={17} />}
              <PreviewText>{operation.message}</PreviewText>
            </Reanimated.View>
          ) : null}
        </Reanimated.View>
      </PreviewCard>
    </PreviewPage>
  );
}

// Memoized row: model catalogs can run to hundreds of entries, and every
// keystroke in the surrounding form re-renders this page. With a stable
// onSelect the untouched rows bail out in memo() instead of re-rendering.
const DetectedModelRow = memo(function DetectedModelRow({
  borderColor,
  emptyColor,
  entry,
  onSelect,
  selected,
  selectedColor,
}: {
  borderColor: string;
  emptyColor: string;
  entry: string;
  onSelect(entry: string): void;
  selected: boolean;
  selectedColor: string;
}) {
  return (
    <IOSPressable
      onPress={() => onSelect(entry)}
      style={[styles.detectedRow, { borderTopColor: borderColor }]}
    >
      {selected
        ? <CheckCircle2 color={selectedColor} size={16} />
        : <View style={[styles.emptyCircle, { borderColor: emptyColor }]} />}
      <PreviewText variant="mono">{entry}</PreviewText>
    </IOSPressable>
  );
});

function modelConnectionFailure(
  label: string,
  result: Pick<CustomModelConnectionResult, 'message' | 'reachable' | 'status'>,
  chinese: boolean,
): string {
  if (result.status === 401) return chinese ? `${label}失败：API 密钥被拒绝（HTTP 401）` : `${label} failed: API key rejected (HTTP 401)`;
  if (result.status === 403) return chinese ? `${label}失败：密钥权限不足（HTTP 403）` : `${label} failed: insufficient permission (HTTP 403)`;
  if (result.status === 404) return chinese ? `${label}失败：接口路径不存在（HTTP 404）` : `${label} failed: endpoint not found (HTTP 404)`;
  if (result.status === 429) return chinese ? `${label}失败：请求过多（HTTP 429）` : `${label} failed: rate limited (HTTP 429)`;
  if (result.status >= 400) return chinese ? `${label}失败：模型服务返回 HTTP ${result.status}` : `${label} failed: model service returned HTTP ${result.status}`;
  if (!result.reachable) return chinese ? `${label}失败：模型服务连接超时或不可达` : `${label} failed: model service timed out or is unreachable`;
  return chinese
    ? `${label}失败：${result.message || '模型服务没有返回有效结果'}`
    : `${label} failed: ${result.message || 'model service returned no valid result'}`;
}

function modelPageError(error: unknown, chinese: boolean): string {
  const message = error instanceof Error && error.message
    ? error.message
    : chinese ? '模型操作失败，请重试' : 'Model operation failed';
  return message.replace(/^服务器操作失败[：:]\s*/, '');
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
  },
  detectedRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  detectionBox: {
    borderRadius: 6,
    borderWidth: 1,
    overflow: 'hidden',
  },
  detectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 46,
  },
  detectionMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  emptyCircle: {
    borderRadius: 8,
    borderWidth: 1.5,
    height: 16,
    width: 16,
  },
  fields: {
    gap: 10,
  },
  keyAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 7,
    minHeight: 36,
    paddingHorizontal: 2,
  },
  operation: {
    alignItems: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 10,
  },
  refreshButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 42,
  },
  spacer: {
    flex: 1,
  },
});
