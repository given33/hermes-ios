import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import {
  buildHermesUrl,
  getDownloadFilename,
  GITHUB_LATEST_RELEASE_API,
  HERMES_ORIGIN,
  isHermesMainDocument,
  isHermesNavigation,
  selectIpaAsset,
} from './src/config';
import { isNewerVersion } from './src/version';

const LAST_PAGE_KEY = 'hermes.lastPage';
const BRAND_BACKGROUND = '#170d02';
const BRAND_ACCENT = '#ffac02';
const RELEASE_CHECK_DELAY_MS = 5_000;

const NATIVE_BRIDGE = `
  (() => {
    if (window.__HERMES_NATIVE_BRIDGE__) return true;
    window.__HERMES_NATIVE_BRIDGE__ = true;
    document.documentElement.dataset.hermesClient = 'ios';
    const nativeStyle = document.createElement('style');
    nativeStyle.id = 'hermes-ios-native-compat';
    nativeStyle.textContent = [
      'html[data-hermes-client="ios"] .hc-route-select{display:none!important}',
      'html[data-hermes-client="ios"][data-hermes-keyboard="open"] .hc-single-composer{padding-bottom:3px!important;transform:translateY(var(--hermes-composer-keyboard-nudge,0px))}',
      'html[data-hermes-client="ios"][data-hermes-keyboard="open"] .hc-chat-top:has(.hc-single-chat){padding-bottom:0!important}'
    ].join('');
    (document.head || document.documentElement).appendChild(nativeStyle);

    let layoutHeight = Math.max(
      window.innerHeight,
      window.visualViewport ? window.visualViewport.height : 0
    );
    let settleTimers = [];
    let viewportFrame = 0;
    let composerObserver = null;
    let observedComposer = null;
    let mutationObserver = null;
    let lastMetricsKey = '';
    const syncViewport = () => {
      const viewport = window.visualViewport;
      layoutHeight = Math.max(
        layoutHeight,
        window.innerHeight,
        viewport ? viewport.height : 0
      );
      const height = Math.max(1, Math.round(viewport ? viewport.height : window.innerHeight));
      const offsetTop = Math.max(0, Math.round(viewport ? viewport.offsetTop : 0));
      const occluded = Math.max(0, layoutHeight - height - offsetTop);
      document.documentElement.style.setProperty('--hermes-viewport-height', height + 'px');
      document.documentElement.style.setProperty('--hermes-viewport-offset-top', offsetTop + 'px');
      document.documentElement.dataset.hermesKeyboard =
        viewport && occluded >= 120 ? 'open' : 'closed';
      const composer = document.querySelector('.hc-single-composer');
      const viewportBottom = offsetTop + height;
      const keyboardOpen = document.documentElement.dataset.hermesKeyboard === 'open';
      const currentKeyboardNudge = Number.parseFloat(
        document.documentElement.style.getPropertyValue('--hermes-composer-keyboard-nudge')
      ) || 0;
      const composerRect = composer ? composer.getBoundingClientRect() : null;
      const untransformedBottom = composerRect
        ? composerRect.bottom - currentKeyboardNudge
        : viewportBottom;
      const keyboardGap = composerRect
        ? viewportBottom - untransformedBottom - 4
        : 0;
      const keyboardNudge = composer && keyboardOpen
        ? Math.min(72, Math.max(0, keyboardGap))
        : 0;
      document.documentElement.style.setProperty(
        '--hermes-composer-keyboard-nudge',
        keyboardNudge + 'px'
      );
      const metrics = {
        height,
        offsetTop,
        layoutHeight,
        occluded,
        viewportBottom,
        composerBottom: composerRect ? Math.round(composerRect.bottom) : null,
        keyboardGap: Math.round(keyboardGap),
        keyboardOpen,
        keyboardNudge
      };
      window.dispatchEvent(new CustomEvent('hermes:viewport-change', { detail: metrics }));
      const metricsKey = JSON.stringify(metrics);
      if (metricsKey !== lastMetricsKey) {
        lastMetricsKey = metricsKey;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'viewport-metrics',
          metrics
        }));
      }
    };
    const requestViewportSync = () => {
      if (viewportFrame) return;
      viewportFrame = requestAnimationFrame(() => {
        viewportFrame = 0;
        syncViewport();
      });
    };
    const settleViewport = () => {
      settleTimers.forEach(clearTimeout);
      requestViewportSync();
      settleTimers = [120, 360].map((delay) => setTimeout(requestViewportSync, delay));
    };
    const bindComposerObserver = () => {
      const composer = document.querySelector('.hc-single-composer');
      if (composer === observedComposer) {
        if (composer) {
          mutationObserver?.disconnect();
          mutationObserver = null;
        }
        return;
      }
      composerObserver && composerObserver.disconnect();
      observedComposer = composer;
      composerObserver = composer && window.ResizeObserver
        ? new ResizeObserver(settleViewport)
        : null;
      composerObserver && composerObserver.observe(composer);
      if (composer) {
        mutationObserver?.disconnect();
        mutationObserver = null;
      }
      settleViewport();
    };
    const startComposerDiscovery = () => {
      if (observedComposer && !observedComposer.isConnected) {
        composerObserver && composerObserver.disconnect();
        composerObserver = null;
        observedComposer = null;
      }
      bindComposerObserver();
      if (!observedComposer && !mutationObserver) {
        mutationObserver = new MutationObserver(bindComposerObserver);
        mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
    };
    window.__HERMES_SYNC_VIEWPORT__ = settleViewport;
    const resetViewport = () => {
      layoutHeight = Math.max(
        window.innerHeight,
        window.visualViewport ? window.visualViewport.height : 0
      );
      settleViewport();
    };
    window.addEventListener('resize', settleViewport);
    window.addEventListener('orientationchange', resetViewport);
    window.addEventListener('pageshow', startComposerDiscovery);
    window.addEventListener('popstate', startComposerDiscovery);
    window.visualViewport && window.visualViewport.addEventListener('resize', settleViewport);
    window.visualViewport && window.visualViewport.addEventListener('scroll', requestViewportSync);
    document.addEventListener('focusin', startComposerDiscovery);
    document.addEventListener('focusout', settleViewport);
    startComposerDiscovery();
    settleViewport();

    document.addEventListener('click', (event) => {
      const node = event.target;
      const anchor = node && node.closest ? node.closest('a[download]') : null;
      if (!anchor || !anchor.href) return;
      event.preventDefault();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'download',
        url: anchor.href,
        filename: anchor.getAttribute('download') || ''
      }));
    }, true);
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    return true;
  })();
`;

type LatestRelease = {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

function HermesApp() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const wasOfflineRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const loadFailedRef = useRef(false);
  const releaseCheckStartedRef = useRef(false);
  const lastViewportMetricsRef = useRef<Record<string, unknown> | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [webViewKey, setWebViewKey] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [webReady, setWebReady] = useState(false);

  useEffect(() => {
    loadFailedRef.current = loadFailed;
  }, [loadFailed]);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(LAST_PAGE_KEY)
      .then((savedUrl) => {
        if (!active) return;
        if (savedUrl?.startsWith(HERMES_ORIGIN) && isHermesNavigation(savedUrl)) {
          const restoredUrl = new URL(savedUrl);
          restoredUrl.searchParams.set('client', 'ios');
          setSourceUrl(restoredUrl.toString());
        } else {
          setSourceUrl(buildHermesUrl());
        }
      })
      .catch(() => {
        if (active) setSourceUrl(buildHermesUrl());
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => NetInfo.addEventListener((state) => {
    const connected = state.isConnected !== false && state.isInternetReachable !== false;
    setIsOnline(connected);

    if (connected && wasOfflineRef.current) {
      if (loadFailedRef.current) {
        setLoadFailed(false);
        setWebReady(false);
        setWebViewKey((current) => current + 1);
      } else {
        webViewRef.current?.injectJavaScript(`
          window.dispatchEvent(new Event('online'));
          window.dispatchEvent(new CustomEvent('hermes:app-resume'));
          true;
        `);
      }
    } else if (!connected && !wasOfflineRef.current) {
      webViewRef.current?.injectJavaScript(`
        window.dispatchEvent(new Event('offline'));
        true;
      `);
    }
    wasOfflineRef.current = !connected;
  }), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const previousState = appStateRef.current;
      appStateRef.current = state;
      if (state === 'active') {
        webViewRef.current?.injectJavaScript(`
          window.dispatchEvent(new CustomEvent('hermes:app-resume'));
          window.__HERMES_SYNC_VIEWPORT__ && window.__HERMES_SYNC_VIEWPORT__();
          true;
        `);
        if (loadFailedRef.current) {
          setLoadFailed(false);
          setWebReady(false);
          setWebViewKey((current) => current + 1);
        }
      } else if (previousState === 'active') {
        webViewRef.current?.injectJavaScript(`
          window.dispatchEvent(new CustomEvent('hermes:app-background'));
          true;
        `);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!webReady || releaseCheckStartedRef.current) return;
    releaseCheckStartedRef.current = true;

    const controller = new AbortController();
    const installedVersion = Constants.expoConfig?.version ?? '0.0.0';
    const timer = setTimeout(() => {
      void fetch(`${GITHUB_LATEST_RELEASE_API}?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((release: LatestRelease | null) => {
          if (!release || !isNewerVersion(release.tag_name, installedVersion)) return;
          const ipa = selectIpaAsset(release.assets);
          if (!ipa) return;

          Alert.alert(
            '发现新版本',
            `Hermes Agent ${release.tag_name} 已发布。可下载 IPA 后使用你的签名软件更新。`,
            [
              { text: '稍后', style: 'cancel' },
              { text: '下载 IPA', onPress: () => void Linking.openURL(ipa.browser_download_url) },
            ],
          );
        })
        .catch(() => undefined);
    }, RELEASE_CHECK_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [webReady]);

  const downloadAttachment = async (url: string, preferredName?: string) => {
    try {
      const baseDirectory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
      if (!baseDirectory) throw new Error('文件目录不可用');
      const filename = (preferredName || getDownloadFilename(url))
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
      const destination = `${baseDirectory}${filename || 'Hermes-文件'}`;
      await FileSystem.deleteAsync(destination, { idempotent: true });
      const result = await FileSystem.downloadAsync(url, destination);
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`下载失败（HTTP ${result.status}）`);
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri, { dialogTitle: '保存或发送 Hermes 文件' });
      } else {
        await Linking.openURL(result.uri);
      }
    } catch (error) {
      Alert.alert('文件下载失败', error instanceof Error ? error.message : '请稍后重试');
    }
  };

  const reconnect = () => {
    setLoadFailed(false);
    setWebReady(false);
    setWebViewKey((current) => current + 1);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      {sourceUrl ? (
        <WebView
          key={webViewKey}
          ref={webViewRef}
          source={{ uri: sourceUrl }}
          style={styles.webView}
          containerStyle={styles.webViewContainer}
          applicationNameForUserAgent="HermesAgent-iOS"
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          allowsLinkPreview
          automaticallyAdjustContentInsets={false}
          cacheEnabled
          contentInset={{ top: 0, right: 0, bottom: 0, left: 0 }}
          contentInsetAdjustmentBehavior="never"
          decelerationRate="normal"
          incognito={false}
          injectedJavaScript={NATIVE_BRIDGE}
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          sharedCookiesEnabled
          startInLoadingState
          thirdPartyCookiesEnabled
          onError={() => setLoadFailed(true)}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.statusCode >= 500 && isHermesMainDocument(nativeEvent.url)) {
              setLoadFailed(true);
            }
          }}
          onLoad={() => setLoadFailed(false)}
          onFileDownload={({ nativeEvent }) => {
            void downloadAttachment(nativeEvent.downloadUrl);
          }}
          onMessage={({ nativeEvent }) => {
            try {
              const message = JSON.parse(nativeEvent.data) as {
                type?: string;
                url?: string;
                filename?: string;
                metrics?: Record<string, unknown>;
              };
              if (message.type === 'ready') {
                setWebReady(true);
              } else if (message.type === 'download' && message.url) {
                void downloadAttachment(message.url, message.filename);
              } else if (message.type === 'viewport-metrics' && message.metrics) {
                lastViewportMetricsRef.current = message.metrics;
              }
            } catch {
              // Ignore messages that do not belong to the native bridge.
            }
          }}
          onNavigationStateChange={({ url }) => {
            if (url.startsWith(HERMES_ORIGIN) && new URL(url).pathname.startsWith('/chat')) {
              void SecureStore.setItemAsync(LAST_PAGE_KEY, url);
            }
          }}
          onShouldStartLoadWithRequest={({ url }) => {
            if (/^(about:blank|blob:|data:)/.test(url)) return true;
            if (url.startsWith('hermes-agent:')) {
              setSourceUrl(buildHermesUrl());
              return false;
            }
            if (isHermesNavigation(url)) return true;
            void Linking.openURL(url);
            return false;
          }}
          renderLoading={() => (
            <View style={styles.loading}>
              <Image source={require('./assets/splash-icon.png')} style={styles.logo} />
              <ActivityIndicator color={BRAND_ACCENT} size="small" />
              <Text style={styles.loadingText}>正在连接 Hermes...</Text>
            </View>
          )}
        />
      ) : (
        <View style={styles.loading}>
          <Image source={require('./assets/splash-icon.png')} style={styles.logo} />
          <ActivityIndicator color={BRAND_ACCENT} size="small" />
          <Text style={styles.loadingText}>正在准备 Hermes...</Text>
        </View>
      )}

      {(!isOnline || loadFailed) && (
          <View style={[styles.networkBanner, { top: insets.top + 8 }]}>
            <View style={styles.networkCopy}>
              <Text style={styles.networkTitle}>{isOnline ? '服务暂时无法连接' : '网络已断开'}</Text>
              <Text style={styles.networkDetail}>任务仍在 DBB3 服务端继续运行</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重新连接"
              onPress={reconnect}
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            >
              <Text style={styles.retryText}>重连</Text>
            </Pressable>
          </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <HermesApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BRAND_BACKGROUND,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: BRAND_BACKGROUND,
  },
  webView: {
    flex: 1,
    backgroundColor: BRAND_BACKGROUND,
  },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: BRAND_BACKGROUND,
  },
  logo: {
    width: 104,
    height: 104,
    borderRadius: 22,
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  networkBanner: {
    position: 'absolute',
    left: 10,
    right: 10,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#7b4f00',
    borderRadius: 8,
    backgroundColor: '#261708',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  networkCopy: {
    flex: 1,
  },
  networkTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  networkDetail: {
    marginTop: 1,
    color: '#d9c7a4',
    fontSize: 12,
  },
  retryButton: {
    minWidth: 58,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BRAND_ACCENT,
    borderRadius: 6,
    backgroundColor: BRAND_ACCENT,
  },
  retryButtonPressed: {
    opacity: 0.72,
  },
  retryText: {
    color: BRAND_BACKGROUND,
    fontSize: 13,
    fontWeight: '800',
  },
});
