import { ChevronDown, ChevronRight, Check, Search, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { HermesCloudApi } from '../../api/HermesCloudApi';
import { IOSPressable } from '../../components/ios/IOSPressable';
import { useTheme } from '../../design/ThemeProvider';
import { configuredChatModels, type ChatModelOption } from './chat-model-options';
import { hostedTurnTransportFailure } from '../../api/hosted-turn-delivery-state';

const modelSelections = new WeakMap<HermesCloudApi, Map<string, {
  choices: ChatModelOption[]; selected: string; provider: string; loadedAt: number;
}>>();

export function ChatModelControl({ api, profile, conversationId, busy, isChinese, notify, onBusyChange }: {
  api: HermesCloudApi | null; profile: string; busy: boolean; isChinese: boolean; notify(message: string): void;
  conversationId?: string;
  onBusyChange?(busy: boolean): void;
}) {
  const { tokens } = useTheme();
  const cacheKey = JSON.stringify([profile, conversationId || '']);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const [choices, setChoices] = useState<ChatModelOption[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [expandedProvider, setExpandedProvider] = useState('');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ choice: ChatModelOption; message: string } | null>(null);
  const generation = useRef(0);
  const loadedAt = useRef(0);
  const loadInFlight = useRef<Promise<void> | null>(null);
  const saveInFlight = useRef(false);
  const selectionRevision = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    if (!api) return;
    if (loadInFlight.current) return loadInFlight.current;
    if (Date.now() - loadedAt.current < 180_000) return;
    const version = generation.current;
    const revision = selectionRevision.current;
    setLoading(true);
    const request = (async () => { try {
      const [options, session] = await Promise.all([
        api.getModelOptions(profile, true),
        conversationId ? api.executeMobileHostedCommand(conversationId, 'model', '', 'status') : null,
      ]);
      if (version !== generation.current) return;
      const configured = configuredChatModels(options);
      setChoices(configured);
      loadedAt.current = Date.now();
      if (revision === selectionRevision.current) {
        const provider = session?.provider || options.provider;
        const selection = JSON.stringify([provider, session?.model || options.model]);
        setSelected(selection);
        setDeferred(Boolean(session?.deferred));
        setExpandedProvider(provider || '');
        let cached = modelSelections.get(api);
        if (!cached) { cached = new Map(); modelSelections.set(api, cached); }
        cached.set(cacheKey, { choices: configured, selected: selection, provider: provider || '', loadedAt: loadedAt.current });
      }
      retryAttempt.current = 0;
      setError('');
    } catch (cause) {
      if (version === generation.current) {
        const failure = hostedTurnTransportFailure(cause);
        setError(failure.retryable
          ? (isChinese ? '连接恢复中' : 'Reconnecting') : failure.message);
        if (failure.retryable) {
          if (retryTimer.current !== null) clearTimeout(retryTimer.current);
          const delay = Math.min(15_000, 2_000 * 2 ** Math.min(3, retryAttempt.current++));
          retryTimer.current = setTimeout(() => { retryTimer.current = null; void load(); }, delay);
        }
      }
    } finally {
      if (version === generation.current) setLoading(false);
    } })();
    loadInFlight.current = request;
    try { await request; } finally { if (loadInFlight.current === request) loadInFlight.current = null; }
  }, [api, profile, conversationId, cacheKey, isChinese]);
  useEffect(() => {
    generation.current += 1;
    const cached = api ? modelSelections.get(api)?.get(cacheKey) : undefined;
    loadedAt.current = cached?.loadedAt || 0;
    loadInFlight.current = null;
    setChoices(cached?.choices || []);
    setSelected(cached?.selected || '');
    setExpandedProvider(cached?.provider || '');
    setConfirmation(null);
    setSaving(false);
    setDeferred(false);
    void load();
    return () => {
      generation.current += 1;
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    };
  }, [load]);
  const choose = async (choice: ChatModelOption, confirmed = false) => {
    if (!api || saveInFlight.current) return;
    if (choice.key === selected && !confirmed) { setOpen(false); return; }
    const version = generation.current;
    const previous = selected;
    selectionRevision.current += 1;
    saveInFlight.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setSelected(choice.key);
    setOpen(false);
    setError('');
    try {
      const sessionResult = conversationId
        ? await api.executeMobileHostedCommand(conversationId, 'model', `${choice.model} --provider ${choice.provider} --session`, '', confirmed)
        : null;
      const result = sessionResult ? {
        confirmRequired: sessionResult.confirm_required,
        confirmMessage: sessionResult.confirm_message,
        model: choice.model, provider: choice.provider,
      } : await api.setModel(choice.provider, choice.model, profile, confirmed);
      if (version !== generation.current) return;
      if (result.confirmRequired) {
        setSelected(previous);
        setOpen(true);
        setConfirmation({ choice, message: result.confirmMessage || (isChinese ? '确认切换此模型？' : 'Confirm this model?') });
        return;
      }
      setSelected(JSON.stringify([result.provider, result.model]));
      setDeferred(Boolean(sessionResult?.deferred || busy));
      modelSelections.get(api)?.set(cacheKey, { choices, selected: JSON.stringify([result.provider, result.model]), provider: result.provider, loadedAt: Date.now() });
      setConfirmation(null);
      setOpen(false);
    } catch (cause) {
      if (version !== generation.current) return;
      // A lost response may follow a successful save. Reconcile before
      // reporting failure or restoring the previous selection.
      const actual = await (conversationId
        ? api.executeMobileHostedCommand(conversationId, 'model', '', 'status')
        : api.getModelOptions(profile, true)).catch(() => null);
      if (version !== generation.current) return;
      if (actual?.provider === choice.provider && actual.model === choice.model) {
        setSelected(choice.key);
      } else {
        setSelected(actual?.model ? JSON.stringify([actual.provider, actual.model]) : previous);
        const message = isChinese ? '模型切换未完成，请重试' : 'Model switch did not complete. Try again.';
        setError(message);
        notify(message);
      }
    } finally {
      saveInFlight.current = false;
      onBusyChange?.(false);
      if (version === generation.current) setSaving(false);
    }
  };
  const close = () => { if (!saving) { setOpen(false); setConfirmation(null); } };
  const current = choices.find((choice) => choice.key === selected);
  const selectedModel = (() => {
    try { const value = JSON.parse(selected); return Array.isArray(value) && typeof value[1] === 'string' ? value[1] : ''; }
    catch { return ''; }
  })();
  const modelLabel = current?.model || selectedModel;
  const visible = choices.filter((choice) => `${choice.model} ${choice.providerName}`.toLowerCase().includes(query.toLowerCase()));
  const providers = [...new Set(visible.map((choice) => choice.provider))];
  return <>
    <IOSPressable accessibilityLabel={isChinese ? '切换模型' : 'Switch model'}
      accessibilityValue={{ text: modelLabel }} disabled={!api || saving}
      onPress={() => { setQuery(''); setOpen(true); void load(); }}
      style={{ maxWidth: 190, flexShrink: 1, minHeight: 36, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
      <View style={{ flexShrink: 1 }}>
      <Text numberOfLines={1} style={{ fontSize: 12, flexShrink: 1, color: tokens.colors.textSecondary }}>{modelLabel || (isChinese ? '模型' : 'Model')}</Text>
      {deferred && busy ? <Text style={{ fontSize: 10, color: tokens.colors.textTertiary }}>{isChinese ? '下轮生效' : 'Next turn'}</Text> : null}
      </View>
      {saving ? <ActivityIndicator size="small" /> : <ChevronDown size={13} color={tokens.colors.textSecondary} />}
    </IOSPressable>
    <Modal transparent visible={open} animationType="none" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <Pressable accessibilityLabel={isChinese ? '关闭模型选择' : 'Close model selector'} onPress={close}
          style={{ position: 'absolute', inset: 0, backgroundColor: '#00000055' }} />
        <View style={{ width: '100%', maxWidth: 440, maxHeight: '75%', borderRadius: 8, borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: tokens.colors.card, padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: tokens.colors.foreground }}>{isChinese ? '选择模型' : 'Select model'}</Text>
            <IOSPressable accessibilityLabel={isChinese ? '关闭' : 'Close'} disabled={saving} onPress={close} style={{ padding: 6 }}><X size={18} color={tokens.colors.textSecondary} /></IOSPressable>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: tokens.colors.border, paddingVertical: 8 }}>
            <Search size={16} color={tokens.colors.textTertiary} /><TextInput accessibilityLabel={isChinese ? '搜索模型' : 'Search models'} placeholder={isChinese ? '搜索模型' : 'Search models'} value={query} onChangeText={setQuery} style={{ flex: 1, color: tokens.colors.foreground, fontSize: 14 }} />
          </View>
          {error ? <Text accessibilityRole="alert" style={{ fontSize: 13, color: tokens.colors.destructive }}>{error}</Text> : null}
          {confirmation ? <View style={{ gap: 12 }}>
            <Text style={{ color: tokens.colors.foreground, fontSize: 14 }}>{confirmation.message}</Text>
            <IOSPressable disabled={saving} accessibilityLabel={isChinese ? '确认切换' : 'Confirm switch'} onPress={() => void choose(confirmation.choice, true)} style={{ padding: 12 }}>
              <Text style={{ color: tokens.colors.primary }}>{isChinese ? '确认切换' : 'Confirm switch'}</Text>
            </IOSPressable>
          </View> : loading && !choices.length ? <ActivityIndicator accessibilityLabel={isChinese ? '正在加载模型' : 'Loading models'} /> : <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
            {providers.map((provider) => <View key={provider}>
              <IOSPressable accessibilityRole="button" accessibilityLabel={visible.find((choice) => choice.provider === provider)?.providerName}
                accessibilityState={{ expanded: Boolean(query) || expandedProvider === provider }}
                onPress={() => setExpandedProvider((current) => current === provider ? '' : provider)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 }}>
                {query || expandedProvider === provider ? <ChevronDown size={16} color={tokens.colors.textSecondary} /> : <ChevronRight size={16} color={tokens.colors.textSecondary} />}
                <Text style={{ flex: 1, color: tokens.colors.foreground, fontSize: 14, fontWeight: '600' }}>{visible.find((choice) => choice.provider === provider)?.providerName}</Text>
                <Text style={{ color: tokens.colors.textTertiary, fontSize: 12 }}>{visible.filter((choice) => choice.provider === provider).length}</Text>
              </IOSPressable>
            {query || expandedProvider === provider ? visible.filter((choice) => choice.provider === provider).map((choice) => <IOSPressable key={choice.key} accessibilityRole="button" accessibilityLabel={`${choice.model}, ${choice.providerName}`} accessibilityState={{ selected: choice.key === selected }}
              disabled={saving} onPress={() => void choose(choice)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 }}>
              <View style={{ flex: 1, paddingLeft: 24 }}><Text style={{ color: tokens.colors.foreground, fontSize: 14 }}>{choice.model}</Text></View>
              {choice.key === selected ? <Check size={18} color={tokens.colors.primary} /> : null}
            </IOSPressable>) : null}</View>)}
            {!visible.length ? <Text style={{ paddingVertical: 16, color: tokens.colors.textSecondary }}>{isChinese ? '没有匹配的已配置模型' : 'No matching configured models'}</Text> : null}
          </ScrollView>}
          {saving ? <ActivityIndicator accessibilityLabel={isChinese ? '正在切换模型' : 'Switching model'} /> : null}
        </View>
      </View>
    </Modal>
  </>;
}
