import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Square,
  X,
} from 'lucide-react-native';
import {
  createElement,
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementRef,
  type ReactElement,
} from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import {
  hasNativeIOSContext,
  HermesIOSContext,
} from '../../modules/hermes-ios-context';
import { IOSPressable } from '../components/ios/IOSPressable';
import { multiplyAlpha } from '../design/control-contracts';
import { useTheme } from '../design/ThemeProvider';
import {
  browserDomainLabel,
  HERMES_BROWSER_HOME_URL,
  normalizeBrowserInput,
} from './browser-url';

const MAX_TABS = 8;

interface BrowserTab {
  canGoBack: boolean;
  canGoForward: boolean;
  currentUrl: string;
  error: string;
  id: string;
  loading: boolean;
  progress: number;
  sourceUrl: string;
  title: string;
}

export interface BuiltinBrowserPageProps {
  locale?: 'en' | 'zh';
  notify(message: string): void;
  ownerScope: string;
}

type BrowserWebView = ElementRef<typeof WebView>;

export function BuiltinBrowserPage({
  locale = 'zh',
  notify,
  ownerScope,
}: BuiltinBrowserPageProps) {
  const { tokens } = useTheme();
  const chinese = locale === 'zh';
  const firstTab = useMemo(() => createBrowserTab(), []);
  const [tabs, setTabs] = useState<BrowserTab[]>([firstTab]);
  const [activeTabId, setActiveTabId] = useState(firstTab.id);
  const [address, setAddress] = useState(firstTab.currentUrl);
  const [addressFocused, setAddressFocused] = useState(false);
  const webViews = useRef<Record<string, BrowserWebView | null>>({});
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  useEffect(() => {
    if (!addressFocused && activeTab) setAddress(activeTab.currentUrl);
  }, [activeTab?.currentUrl, activeTabId, addressFocused]);

  const updateTab = useCallback((id: string, updates: Partial<BrowserTab>) => {
    setTabs((current) => current.map((tab) => (
      tab.id === id ? { ...tab, ...updates } : tab
    )));
  }, []);

  const submitAddress = useCallback(() => {
    const url = normalizeBrowserInput(address);
    if (!url || !activeTab) return;
    updateTab(activeTab.id, {
      currentUrl: url,
      error: '',
      loading: true,
      progress: 0,
      sourceUrl: url,
    });
    setAddress(url);
  }, [activeTab, address, updateTab]);

  const addTab = useCallback(() => {
    setTabs((current) => {
      if (current.length >= MAX_TABS) {
        notify(chinese ? `最多打开 ${MAX_TABS} 个标签页` : `Up to ${MAX_TABS} tabs are supported.`);
        return current;
      }
      const next = createBrowserTab();
      setActiveTabId(next.id);
      setAddress(next.currentUrl);
      return [...current, next];
    });
  }, [chinese, notify]);

  const closeTab = useCallback((id: string) => {
    setTabs((current) => {
      if (current.length === 1) {
        const replacement = createBrowserTab();
        setActiveTabId(replacement.id);
        setAddress(replacement.currentUrl);
        return [replacement];
      }
      const closingIndex = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (activeTabId === id) {
        const replacement = next[Math.max(0, closingIndex - 1)] ?? next[0];
        setActiveTabId(replacement.id);
        setAddress(replacement.currentUrl);
      }
      delete webViews.current[id];
      return next;
    });
  }, [activeTabId]);

  const shareCurrentPage = useCallback(async () => {
    if (!activeTab) return;
    await Share.share({ message: activeTab.currentUrl, url: activeTab.currentUrl });
  }, [activeTab]);

  const openExternal = useCallback(async () => {
    if (!activeTab) return;
    await Linking.openURL(activeTab.currentUrl);
  }, [activeTab]);

  const handoffToHermes = useCallback(async () => {
    if (!activeTab) return;
    if (!hasNativeIOSContext) {
      notify(chinese
        ? 'Expo Go 可预览浏览器界面；交给 Hermes 分析网页需要开发客户端或完整 IPA。'
        : 'Expo Go can preview the browser. Hermes page analysis requires the development client or full IPA.');
      return;
    }
    try {
      await HermesIOSContext.executeBrowserForCommand(
        `visible-browser-${Date.now().toString(36)}`,
        ownerScope,
        'navigate',
        { url: activeTab.currentUrl },
        false,
      );
      notify(chinese ? '当前网页已同步到 Hermes 浏览器会话' : 'The current page is ready in the Hermes browser session.');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }, [activeTab, chinese, notify, ownerScope]);

  const handleNavigation = useCallback((tabId: string, state: WebViewNavigation) => {
    updateTab(tabId, {
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      currentUrl: state.url || HERMES_BROWSER_HOME_URL,
      loading: state.loading,
      title: state.title || browserDomainLabel(state.url),
    });
  }, [updateTab]);

  if (!activeTab) return null;

  return (
    <View style={[styles.root, { backgroundColor: tokens.colors.background }]}>
      <View style={[styles.tabBar, { borderBottomColor: tokens.colors.border }]}>
        <View style={styles.tabList}>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <IOSPressable
                accessibilityLabel={`${chinese ? '标签页' : 'Tab'}: ${tab.title}`}
                haptic="selection"
                key={tab.id}
                onPress={() => {
                  setActiveTabId(tab.id);
                  setAddress(tab.currentUrl);
                }}
                style={[
                  styles.tab,
                  {
                    backgroundColor: active
                      ? tokens.colors.card
                      : 'transparent',
                    borderColor: active ? tokens.colors.border : 'transparent',
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.tabTitle, { color: active ? tokens.colors.cardForeground : tokens.colors.textSecondary }]}
                >
                  {tab.title || browserDomainLabel(tab.currentUrl)}
                </Text>
                <IOSPressable
                  accessibilityLabel={chinese ? '关闭标签页' : 'Close tab'}
                  hitSlop={8}
                  onPress={() => closeTab(tab.id)}
                  style={styles.tabClose}
                >
                  <X color={tokens.colors.textSecondary} size={13} strokeWidth={2} />
                </IOSPressable>
              </IOSPressable>
            );
          })}
        </View>
        <IOSPressable
          accessibilityLabel={chinese ? '新建标签页' : 'New tab'}
          disabled={tabs.length >= MAX_TABS}
          haptic="light"
          onPress={addTab}
          style={styles.topIconButton}
        >
          <Plus color={tokens.colors.foreground} size={19} strokeWidth={2} />
        </IOSPressable>
      </View>

      <View style={[styles.addressBar, { borderBottomColor: tokens.colors.border }]}>
        <Search color={tokens.colors.textTertiary} size={16} strokeWidth={2} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onBlur={() => setAddressFocused(false)}
          onChangeText={setAddress}
          onFocus={() => setAddressFocused(true)}
          onSubmitEditing={submitAddress}
          placeholder={chinese ? '搜索或输入网址' : 'Search or enter website'}
          placeholderTextColor={tokens.colors.textTertiary}
          returnKeyType="go"
          selectTextOnFocus
          style={[
            styles.addressInput,
            {
              backgroundColor: tokens.colors.input,
              borderColor: addressFocused ? tokens.colors.ring : tokens.colors.border,
              color: tokens.colors.foreground,
            },
          ]}
          value={address}
        />
        {activeTab.loading ? (
          <IOSPressable
            accessibilityLabel={chinese ? '停止加载' : 'Stop loading'}
            onPress={() => webViews.current[activeTab.id]?.stopLoading()}
            style={styles.addressAction}
          >
            <Square color={tokens.colors.foreground} fill={tokens.colors.foreground} size={13} />
          </IOSPressable>
        ) : (
          <IOSPressable
            accessibilityLabel={chinese ? '刷新' : 'Reload'}
            onPress={() => webViews.current[activeTab.id]?.reload()}
            style={styles.addressAction}
          >
            <RefreshCw color={tokens.colors.foreground} size={17} strokeWidth={2} />
          </IOSPressable>
        )}
      </View>

      <View style={styles.browserStage}>
        {tabs.map((tab) => (
          <View
            key={tab.id}
            pointerEvents={tab.id === activeTabId ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, tab.id !== activeTabId && styles.hiddenTab]}
          >
            <BrowserSurface
              onError={(message) => updateTab(tab.id, { error: message, loading: false })}
              onNavigation={(state) => handleNavigation(tab.id, state)}
              onProgress={(progress) => updateTab(tab.id, { progress })}
              onRef={(instance) => { webViews.current[tab.id] = instance; }}
              sourceUrl={tab.sourceUrl}
            />
            {tab.loading && tab.progress < 1 ? (
              <View style={[styles.progressTrack, { backgroundColor: multiplyAlpha(tokens.colors.primary, 0.16) }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: tokens.colors.primary,
                      width: `${Math.max(4, Math.round(tab.progress * 100))}%`,
                    },
                  ]}
                />
              </View>
            ) : null}
            {tab.error ? (
              <View style={[styles.errorBand, { backgroundColor: tokens.colors.background }]}>
                <Text style={[styles.errorTitle, { color: tokens.colors.foreground }]}>
                  {chinese ? '网页加载失败' : 'Page failed to load'}
                </Text>
                <Text style={[styles.errorText, { color: tokens.colors.textSecondary }]}>{tab.error}</Text>
                <IOSPressable
                  accessibilityRole="button"
                  onPress={() => {
                    updateTab(tab.id, { error: '', loading: true, progress: 0 });
                    webViews.current[tab.id]?.reload();
                  }}
                  style={[styles.retryButton, { backgroundColor: tokens.colors.primary }]}
                >
                  <Text style={[styles.retryText, { color: tokens.colors.primaryForeground }]}>
                    {chinese ? '重试' : 'Retry'}
                  </Text>
                </IOSPressable>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      <View style={[styles.bottomBar, { borderTopColor: tokens.colors.border, backgroundColor: tokens.colors.background }]}>
        <BrowserToolButton
          disabled={!activeTab.canGoBack}
          label={chinese ? '后退' : 'Back'}
          onPress={() => webViews.current[activeTab.id]?.goBack()}
          tint={tokens.colors.foreground}
        >
          <ArrowLeft />
        </BrowserToolButton>
        <BrowserToolButton
          disabled={!activeTab.canGoForward}
          label={chinese ? '前进' : 'Forward'}
          onPress={() => webViews.current[activeTab.id]?.goForward()}
          tint={tokens.colors.foreground}
        >
          <ArrowRight />
        </BrowserToolButton>
        <BrowserToolButton
          label={chinese ? '交给 Hermes' : 'Use with Hermes'}
          onPress={handoffToHermes}
          tint={hasNativeIOSContext ? tokens.colors.primary : tokens.colors.textSecondary}
        >
          <Bot />
        </BrowserToolButton>
        <BrowserToolButton
          label={chinese ? '分享' : 'Share'}
          onPress={shareCurrentPage}
          tint={tokens.colors.foreground}
        >
          <Share2 />
        </BrowserToolButton>
        <BrowserToolButton
          label={chinese ? '在系统浏览器中打开' : 'Open externally'}
          onPress={openExternal}
          tint={tokens.colors.foreground}
        >
          <ExternalLink />
        </BrowserToolButton>
      </View>
    </View>
  );
}

function BrowserSurface({
  onError,
  onNavigation,
  onProgress,
  onRef,
  sourceUrl,
}: {
  onError(message: string): void;
  onNavigation(state: WebViewNavigation): void;
  onProgress(progress: number): void;
  onRef(instance: BrowserWebView | null): void;
  sourceUrl: string;
}) {
  if (Platform.OS === 'web') {
    return createElement('iframe', {
      allow: 'camera; microphone; clipboard-read; clipboard-write; fullscreen',
      onLoad: () => onProgress(1),
      referrerPolicy: 'strict-origin-when-cross-origin',
      src: sourceUrl,
      style: { border: 0, height: '100%', width: '100%' },
      title: 'Hermes Browser',
    });
  }
  return (
    <WebView
      allowsBackForwardNavigationGestures
      allowsInlineMediaPlayback
      applicationNameForUserAgent="Hermes Agent"
      contentInsetAdjustmentBehavior="never"
      domStorageEnabled
      javaScriptEnabled
      mediaPlaybackRequiresUserAction={false}
      onError={(event) => onError(event.nativeEvent.description)}
      onFileDownload={(event) => { void Linking.openURL(event.nativeEvent.downloadUrl); }}
      onHttpError={(event) => onError(`HTTP ${event.nativeEvent.statusCode}`)}
      onLoadProgress={(event) => onProgress(event.nativeEvent.progress)}
      onNavigationStateChange={onNavigation}
      onShouldStartLoadWithRequest={(request) => {
        if (/^https?:/i.test(request.url) || request.url === 'about:blank') return true;
        void Linking.openURL(request.url).catch(() => undefined);
        return false;
      }}
      originWhitelist={['http://*', 'https://*']}
      pullToRefreshEnabled
      ref={onRef}
      renderLoading={() => (
        <View style={styles.loadingSurface}>
          <ActivityIndicator />
        </View>
      )}
      setSupportMultipleWindows={false}
      sharedCookiesEnabled
      source={{ uri: sourceUrl }}
      startInLoadingState
      thirdPartyCookiesEnabled
    />
  );
}

function BrowserToolButton({
  children,
  disabled = false,
  label,
  onPress,
  tint,
}: {
  children: ReactElement<{ color?: string; size?: number; strokeWidth?: number }>;
  disabled?: boolean;
  label: string;
  onPress(): void;
  tint: string;
}) {
  const color = disabled ? multiplyAlpha(tint, 0.32) : tint;
  return (
    <IOSPressable
      accessibilityLabel={label}
      disabled={disabled}
      haptic="selection"
      onPress={onPress}
      style={styles.bottomButton}
    >
      {cloneElement(children, { color, size: 21, strokeWidth: 2 })}
    </IOSPressable>
  );
}

function createBrowserTab(): BrowserTab {
  const id = `browser-tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    canGoBack: false,
    canGoForward: false,
    currentUrl: HERMES_BROWSER_HOME_URL,
    error: '',
    id,
    loading: true,
    progress: 0,
    sourceUrl: HERMES_BROWSER_HOME_URL,
    title: 'Google',
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  tabBar: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 42,
    paddingHorizontal: 8,
  },
  tabList: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 4, minWidth: 0 },
  tab: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    height: 30,
    maxWidth: 180,
    minWidth: 0,
    paddingLeft: 10,
    paddingRight: 5,
  },
  tabTitle: { flex: 1, fontSize: 11, letterSpacing: 0 },
  tabClose: { alignItems: 'center', height: 24, justifyContent: 'center', width: 24 },
  topIconButton: { alignItems: 'center', height: 36, justifyContent: 'center', marginLeft: 4, width: 36 },
  addressBar: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    height: 52,
    paddingHorizontal: 10,
  },
  addressInput: {
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    fontSize: 13,
    height: 36,
    letterSpacing: 0,
    paddingHorizontal: 11,
    paddingVertical: 0,
  },
  addressAction: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  browserStage: { flex: 1, minHeight: 0, overflow: 'hidden' },
  hiddenTab: { opacity: 0 },
  progressTrack: { height: 2, left: 0, position: 'absolute', right: 0, top: 0 },
  progressFill: { height: 2 },
  loadingSurface: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  errorBand: {
    alignItems: 'center',
    bottom: 0,
    gap: 8,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  errorTitle: { fontSize: 16, fontWeight: '600', letterSpacing: 0 },
  errorText: { fontSize: 12, letterSpacing: 0, lineHeight: 18, textAlign: 'center' },
  retryButton: { borderRadius: 7, minHeight: 36, minWidth: 88, paddingHorizontal: 18, paddingVertical: 9 },
  retryText: { fontSize: 13, fontWeight: '600', letterSpacing: 0, textAlign: 'center' },
  bottomBar: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 50,
    justifyContent: 'space-around',
    paddingHorizontal: 10,
  },
  bottomButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 50 },
});
