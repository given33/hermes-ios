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
  isHermesNavigation,
  selectIpaAsset,
} from './src/config';
import { isNewerVersion } from './src/version';

const LAST_PAGE_KEY = 'hermes.lastPage';
const BRAND_BACKGROUND = '#170d02';
const BRAND_ACCENT = '#ffac02';

const NATIVE_BRIDGE = `
  (() => {
    if (window.__HERMES_NATIVE_BRIDGE__) return true;
    window.__HERMES_NATIVE_BRIDGE__ = true;
    document.documentElement.dataset.hermesClient = 'ios';
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
  const [sourceUrl, setSourceUrl] = useState(buildHermesUrl());
  const [webViewKey, setWebViewKey] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(LAST_PAGE_KEY).then((savedUrl) => {
      if (active && savedUrl?.startsWith(HERMES_ORIGIN) && isHermesNavigation(savedUrl)) {
        setSourceUrl(savedUrl);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => NetInfo.addEventListener((state) => {
    const connected = state.isConnected !== false && state.isInternetReachable !== false;
    setIsOnline(connected);

    if (connected && wasOfflineRef.current) {
      setLoadFailed(false);
      setWebViewKey((current) => current + 1);
    }
    wasOfflineRef.current = !connected;
  }), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      webViewRef.current?.injectJavaScript(`
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        true;
      `);
      if (loadFailed) {
        setLoadFailed(false);
        setWebViewKey((current) => current + 1);
      }
    });
    return () => subscription.remove();
  }, [loadFailed]);

  useEffect(() => {
    const controller = new AbortController();
    const installedVersion = Constants.expoConfig?.version ?? '0.0.0';

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

    return () => controller.abort();
  }, []);

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
    setWebViewKey((current) => current + 1);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" translucent backgroundColor="transparent" />
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
          cacheEnabled
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
            if (nativeEvent.statusCode >= 500) setLoadFailed(true);
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
              };
              if (message.type === 'download' && message.url) {
                void downloadAttachment(message.url, message.filename);
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
