import * as Clipboard from 'expo-clipboard';
import {
  Bell,
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleUserRound,
  Cloud,
  Copy,
  Database,
  HeartPulse,
  LockKeyhole,
  Mic2,
  Palette,
  Route,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import {
  Appearance,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { IOSPressable } from '../components/ios/IOSPressable';
import { NativeButton } from '../components/ui/NativeButton';
import { NativeInput } from '../components/ui/NativeInput';
import { resolveNativeFontStack } from '../design/native-font-faces';
import { useTheme } from '../design/ThemeProvider';
import type { PreviewPageProps } from './PreviewCorePages';
import {
  PreviewBadge,
  PreviewPage,
  PreviewSegmented,
  PreviewSettingRow,
  PreviewText,
  PreviewToggle,
} from '../studio/PreviewPrimitives';

type SettingsTab =
  | 'account'
  | 'display'
  | 'proxy'
  | 'agent'
  | 'memory'
  | 'compression'
  | 'session'
  | 'privacy'
  | 'models'
  | 'voice'
  | 'apple';

interface SettingsTabDefinition {
  id: SettingsTab;
  en: string;
  zh: string;
}

const SETTINGS_TABS: readonly SettingsTabDefinition[] = [
  { id: 'account', en: 'Account', zh: '账户' },
  { id: 'display', en: 'Display', zh: '显示' },
  { id: 'proxy', en: 'Proxy', zh: '代理' },
  { id: 'agent', en: 'Agent', zh: 'Agent' },
  { id: 'memory', en: 'Memory', zh: '记忆' },
  { id: 'compression', en: 'Compression', zh: '压缩' },
  { id: 'session', en: 'Session', zh: '会话' },
  { id: 'privacy', en: 'Privacy', zh: '隐私' },
  { id: 'models', en: 'Models', zh: '模型' },
  { id: 'voice', en: 'Voice', zh: '语音' },
  { id: 'apple', en: 'Apple data', zh: 'Apple 数据' },
] as const;

export function HermesStudioSettingsPage({
  locale = 'zh',
  navigate,
  notify,
}: PreviewPageProps) {
  const chinese = locale === 'zh';
  const { setFont: setThemeFont, setTheme, tokens } = useTheme();
  const [tab, setTab] = useState<SettingsTab>('account');
  const [appearance, setAppearance] = useState<'system' | 'light' | 'dark'>('system');
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable');
  const [font, setFont] = useState<'inter' | 'system' | 'mono'>('inter');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [autoCompress, setAutoCompress] = useState(true);
  const [resumeSessions, setResumeSessions] = useState(true);
  const [diagnostics, setDiagnostics] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyBypass, setProxyBypass] = useState('');
  const [maxTurns, setMaxTurns] = useState('50');
  const [workspace, setWorkspace] = useState('');
  const [retrievalCount, setRetrievalCount] = useState('8');
  const [compressionTrigger, setCompressionTrigger] = useState('96000');
  const [historyBudget, setHistoryBudget] = useState('64000');
  const [tailMessages, setTailMessages] = useState('12');
  const [speechRate, setSpeechRate] = useState('1.0');
  const title = SETTINGS_TABS.find(({ id }) => id === tab);
  const copyAccount = async () => {
    await Clipboard.setStringAsync([
      chinese ? '账户：未登录' : 'Account: signed out',
      'Profile: default',
      chinese ? '服务器：未连接' : 'Server: disconnected',
    ].join('\n'));
    notify(chinese ? '账户信息已复制' : 'Account information copied');
  };
  const save = () => notify(chinese ? '设置已保存' : 'Settings saved');
  const applyAppearance = (value: typeof appearance) => {
    setAppearance(value);
    const colorScheme = value === 'system' ? Appearance.getColorScheme() : value;
    void setTheme(colorScheme === 'dark' ? 'studio-ink-dark' : 'studio-ink-light');
  };
  const applyFont = (value: typeof font) => {
    setFont(value);
    void setThemeFont(
      value === 'inter' ? 'inter' : value === 'mono' ? 'system-mono' : 'system-sans',
    );
  };

  return (
    <PreviewPage
      actions={(
        <NativeButton onPress={save} prefix={<Save />} size="sm">
          {chinese ? '保存' : 'Save'}
        </NativeButton>
      )}
      title={chinese ? '设置' : 'Settings'}
    >
      <ScrollView
        contentContainerStyle={styles.tabsContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabs, { borderBottomColor: tokens.colors.border }]}
      >
        {SETTINGS_TABS.map((definition) => {
          const active = definition.id === tab;
          return (
            <IOSPressable
              accessibilityState={{ selected: active }}
              key={definition.id}
              onPress={() => setTab(definition.id)}
              style={[
                styles.tab,
                active && { borderBottomColor: tokens.colors.foreground },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    color: active ? tokens.colors.foreground : tokens.colors.textSecondary,
                    fontFamily: resolveNativeFontStack(tokens.typography.fontSans, active ? 600 : 400),
                  },
                ]}
              >
                {chinese ? definition.zh : definition.en}
              </Text>
            </IOSPressable>
          );
        })}
      </ScrollView>

      <View style={styles.settingsBody}>
        <View style={styles.settingsHeading}>
          <PreviewText variant="heading">{chinese ? title?.zh : title?.en}</PreviewText>
        </View>
        {tab === 'account' ? (
          <>
            <SettingsSection title={chinese ? '身份' : 'Identity'}>
              <PreviewSettingRow
                detail={chinese ? '未登录' : 'Signed out'}
                label={chinese ? '账户' : 'Account'}
                onPress={() => navigate('/account')}
                trailing={<ChevronRight color={tokens.colors.textTertiary} size={16} />}
              />
              <PreviewSettingRow detail="default" label="Profile" />
              <PreviewSettingRow
                detail={chinese ? '未连接' : 'Disconnected'}
                label={chinese ? '服务器' : 'Server'}
                trailing={<PreviewBadge tone="outline">OFFLINE</PreviewBadge>}
              />
              <NativeButton onPress={() => { void copyAccount(); }} outlined prefix={<Copy />} size="sm">
                {chinese ? '复制账户信息' : 'Copy account information'}
              </NativeButton>
            </SettingsSection>
            <SettingsSection title={chinese ? '账户数据' : 'Account data'}>
              <PreviewSettingRow
                label={chinese ? '加密导出' : 'Encrypted export'}
                onPress={() => navigate('/account')}
                trailing={<LockKeyhole color={tokens.colors.textSecondary} size={16} />}
              />
              <PreviewSettingRow
                label={chinese ? '删除账户' : 'Delete account'}
                onPress={() => navigate('/account')}
                trailing={<ChevronRight color={tokens.colors.destructive} size={16} />}
              />
            </SettingsSection>
          </>
        ) : null}

        {tab === 'display' ? (
          <>
            <SettingsSection title={chinese ? '外观' : 'Appearance'}>
              <Field label={chinese ? '配色' : 'Color scheme'}>
                <PreviewSegmented
                  onChange={(value) => applyAppearance(value as typeof appearance)}
                  options={[
                    { label: chinese ? '跟随系统' : 'System', value: 'system' },
                    { label: chinese ? '浅色' : 'Light', value: 'light' },
                    { label: chinese ? '深色' : 'Dark', value: 'dark' },
                  ]}
                  value={appearance}
                />
              </Field>
              <Field label={chinese ? '字体' : 'Font'}>
                <PreviewSegmented
                  onChange={(value) => applyFont(value as typeof font)}
                  options={[
                    { label: 'Inter', value: 'inter' },
                    { label: chinese ? '系统' : 'System', value: 'system' },
                    { label: chinese ? '等宽' : 'Mono', value: 'mono' },
                  ]}
                  value={font}
                />
              </Field>
              <Field label={chinese ? '密度' : 'Density'}>
                <PreviewSegmented
                  onChange={(value) => setDensity(value as typeof density)}
                  options={[
                    { label: chinese ? '紧凑' : 'Compact', value: 'compact' },
                    { label: chinese ? '舒适' : 'Comfortable', value: 'comfortable' },
                  ]}
                  value={density}
                />
              </Field>
              <PreviewSettingRow
                label={chinese ? '减少动态效果' : 'Reduce motion'}
                trailing={<PreviewToggle accessibilityLabel="Reduce motion" onChange={setReduceMotion} value={reduceMotion} />}
              />
            </SettingsSection>
          </>
        ) : null}

        {tab === 'proxy' ? (
          <SettingsSection title={chinese ? '网络代理' : 'Network proxy'}>
            <PreviewSettingRow
              label={chinese ? '启用代理' : 'Enable proxy'}
              trailing={<PreviewToggle accessibilityLabel="Enable proxy" onChange={setProxyEnabled} value={proxyEnabled} />}
            />
            <Field label={chinese ? '代理地址' : 'Proxy URL'}>
              <NativeInput autoCapitalize="none" editable={proxyEnabled} onChangeText={setProxyUrl} placeholder="http://127.0.0.1:7890" value={proxyUrl} />
            </Field>
            <Field label={chinese ? '绕过地址' : 'Bypass list'}>
              <NativeInput editable={proxyEnabled} onChangeText={setProxyBypass} placeholder="localhost, 127.0.0.1" value={proxyBypass} />
            </Field>
            <NativeButton disabled={!proxyEnabled} onPress={() => notify(chinese ? '代理测试完成' : 'Proxy test completed')} outlined prefix={<Server />} size="sm">
              {chinese ? '测试代理' : 'Test proxy'}
            </NativeButton>
          </SettingsSection>
        ) : null}

        {tab === 'agent' ? (
          <SettingsSection title={chinese ? 'Agent 运行' : 'Agent runtime'}>
            <PreviewSettingRow detail="default" label="Profile" />
            <PreviewSettingRow
              label={chinese ? '模型' : 'Model'}
              onPress={() => navigate('/models')}
              trailing={<ChevronRight color={tokens.colors.textTertiary} size={16} />}
            />
            <Field label={chinese ? '最大轮次' : 'Maximum turns'}>
              <NativeInput keyboardType="number-pad" onChangeText={setMaxTurns} value={maxTurns} />
            </Field>
            <PreviewSettingRow
              label={chinese ? '允许工具调用' : 'Allow tools'}
              trailing={<PreviewToggle accessibilityLabel="Allow tools" onChange={setToolsEnabled} value={toolsEnabled} />}
            />
            <Field label={chinese ? '工作区' : 'Workspace'}>
              <NativeInput onChangeText={setWorkspace} placeholder={chinese ? '选择服务器工作区' : 'Select server workspace'} value={workspace} />
            </Field>
          </SettingsSection>
        ) : null}

        {tab === 'memory' ? (
          <SettingsSection title={chinese ? '长期记忆' : 'Long-term memory'}>
            <PreviewSettingRow
              label={chinese ? '启用记忆' : 'Enable memory'}
              trailing={<PreviewToggle accessibilityLabel="Enable memory" onChange={setMemoryEnabled} value={memoryEnabled} />}
            />
            <PreviewSettingRow detail="builtin" label={chinese ? '提供商' : 'Provider'} />
            <Field label={chinese ? '检索条数' : 'Retrieval count'}>
              <NativeInput editable={memoryEnabled} keyboardType="number-pad" onChangeText={setRetrievalCount} value={retrievalCount} />
            </Field>
            <NativeButton onPress={() => navigate('/skills')} outlined prefix={<Brain />} size="sm">
              {chinese ? '查看记忆与技能' : 'Open memory and skills'}
            </NativeButton>
          </SettingsSection>
        ) : null}

        {tab === 'compression' ? (
          <SettingsSection title={chinese ? '上下文压缩' : 'Context compression'}>
            <PreviewSettingRow
              label={chinese ? '自动压缩' : 'Automatic compression'}
              trailing={<PreviewToggle accessibilityLabel="Automatic compression" onChange={setAutoCompress} value={autoCompress} />}
            />
            <Field label={chinese ? '触发 Token' : 'Trigger tokens'}>
              <NativeInput editable={autoCompress} keyboardType="number-pad" onChangeText={setCompressionTrigger} value={compressionTrigger} />
            </Field>
            <Field label={chinese ? '历史预算' : 'History budget'}>
              <NativeInput editable={autoCompress} keyboardType="number-pad" onChangeText={setHistoryBudget} value={historyBudget} />
            </Field>
            <Field label={chinese ? '保留尾部消息' : 'Tail messages'}>
              <NativeInput editable={autoCompress} keyboardType="number-pad" onChangeText={setTailMessages} value={tailMessages} />
            </Field>
            <NativeButton onPress={() => notify(chinese ? '压缩请求已提交' : 'Compression requested')} outlined prefix={<Database />} size="sm">
              {chinese ? '立即压缩' : 'Compress now'}
            </NativeButton>
          </SettingsSection>
        ) : null}

        {tab === 'session' ? (
          <SettingsSection title={chinese ? '会话行为' : 'Session behavior'}>
            <PreviewSettingRow
              label={chinese ? '自动恢复会话' : 'Resume sessions automatically'}
              trailing={<PreviewToggle accessibilityLabel="Resume sessions" onChange={setResumeSessions} value={resumeSessions} />}
            />
            <PreviewSettingRow
              detail={chinese ? '服务器快照 + SSE' : 'Server snapshot + SSE'}
              label={chinese ? '同步方式' : 'Synchronization'}
            />
            <PreviewSettingRow
              label={chinese ? '会话列表' : 'Session list'}
              onPress={() => navigate('/sessions')}
              trailing={<ChevronRight color={tokens.colors.textTertiary} size={16} />}
            />
          </SettingsSection>
        ) : null}

        {tab === 'privacy' ? (
          <SettingsSection title={chinese ? '隐私与诊断' : 'Privacy and diagnostics'}>
            <PreviewSettingRow
              label={chinese ? '共享脱敏诊断' : 'Share redacted diagnostics'}
              trailing={<PreviewToggle accessibilityLabel="Share diagnostics" onChange={setDiagnostics} value={diagnostics} />}
            />
            <PreviewSettingRow detail={chinese ? '始终开启' : 'Always on'} label={chinese ? '密钥脱敏' : 'Secret redaction'} trailing={<Check color={tokens.colors.success} size={16} />} />
            <PreviewSettingRow detail={chinese ? '账户独立' : 'Per account'} label={chinese ? '加密边界' : 'Encryption boundary'} trailing={<LockKeyhole color={tokens.colors.textSecondary} size={16} />} />
            <NativeButton onPress={() => navigate('/account')} outlined prefix={<ShieldCheck />} size="sm">
              {chinese ? '账户隐私管理' : 'Account privacy'}
            </NativeButton>
          </SettingsSection>
        ) : null}

        {tab === 'models' ? (
          <SettingsSection title={chinese ? '模型与提供商' : 'Models and providers'}>
            <PreviewSettingRow detail={chinese ? '未配置' : 'Not configured'} label={chinese ? '当前模型' : 'Current model'} />
            <PreviewSettingRow label={chinese ? '提供商与模型检测' : 'Providers and model discovery'} onPress={() => navigate('/models')} trailing={<ChevronRight color={tokens.colors.textTertiary} size={16} />} />
            <PreviewSettingRow label={chinese ? '模型密钥' : 'Model keys'} onPress={() => navigate('/env')} trailing={<ChevronRight color={tokens.colors.textTertiary} size={16} />} />
          </SettingsSection>
        ) : null}

        {tab === 'voice' ? (
          <SettingsSection title={chinese ? '语音' : 'Voice'}>
            <PreviewSettingRow label={chinese ? '启用语音' : 'Enable voice'} trailing={<PreviewToggle accessibilityLabel="Enable voice" onChange={setVoiceEnabled} value={voiceEnabled} />} />
            <PreviewSettingRow detail={chinese ? '系统语音' : 'System speech'} label="TTS" />
            <PreviewSettingRow detail={chinese ? '系统听写' : 'System dictation'} label="STT" />
            <Field label={chinese ? '语速' : 'Speech rate'}><NativeInput editable={voiceEnabled} keyboardType="decimal-pad" onChangeText={setSpeechRate} value={speechRate} /></Field>
            <NativeButton disabled={!voiceEnabled} onPress={() => notify(chinese ? '语音测试已开始' : 'Voice test started')} outlined prefix={<Mic2 />} size="sm">{chinese ? '测试语音' : 'Test voice'}</NativeButton>
          </SettingsSection>
        ) : null}

        {tab === 'apple' ? (
          <>
            <SettingsSection title={chinese ? '系统权限' : 'System permissions'}>
              <PermissionRow label={chinese ? '位置与轨迹' : 'Location and trajectory'} />
              <PermissionRow label={chinese ? '运动与健身' : 'Motion and fitness'} />
              <PermissionRow label={chinese ? '健康与睡眠' : 'Health and sleep'} />
              <PermissionRow label={chinese ? '日历与提醒事项' : 'Calendar and reminders'} />
              <PermissionRow label={chinese ? '通知与实时活动' : 'Notifications and Live Activities'} />
              <PermissionRow label={chinese ? '屏幕使用时间' : 'Screen Time'} />
            </SettingsSection>
            <SettingsSection title={chinese ? '设备' : 'Devices'}>
              <PreviewSettingRow detail={chinese ? '未连接' : 'Disconnected'} label="Apple Watch" />
              <PreviewSettingRow detail={chinese ? '自动采集' : 'Automatic'} label={chinese ? '电量与充电' : 'Power and charging'} />
              <NativeButton onPress={() => navigate('/smart-weather')} outlined prefix={<Bell />} size="sm">{chinese ? '智能天气权限' : 'Smart Weather permissions'}</NativeButton>
            </SettingsSection>
          </>
        ) : null}
      </View>
    </PreviewPage>
  );
}

function SettingsSection({ children, title }: { children: ReactNode; title: string }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.section, { borderTopColor: tokens.colors.border }]}>
      <PreviewText variant="label">{title}</PreviewText>
      <View>{children}</View>
    </View>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View style={styles.field}>
      <PreviewText variant="label">{label}</PreviewText>
      {children}
    </View>
  );
}

function PermissionRow({ label }: { label: string }) {
  const { tokens } = useTheme();
  return (
    <PreviewSettingRow
      detail="—"
      label={label}
      trailing={<Settings2 color={tokens.colors.textTertiary} size={16} />}
    />
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 7,
    paddingVertical: 10,
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingTop: 16,
  },
  settingsBody: {
    gap: 18,
    width: '100%',
  },
  settingsHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    minHeight: 30,
  },
  tab: {
    alignItems: 'center',
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    flexDirection: 'row',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  tabText: {
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 17,
  },
  tabs: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -4,
    maxHeight: 46,
  },
  tabsContent: {
    paddingHorizontal: 4,
  },
});
