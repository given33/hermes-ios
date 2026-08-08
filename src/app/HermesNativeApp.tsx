import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { startNativeFrameRateController } from '../../modules/hermes-ios-controls';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { accountOwnerScope } from '../auth/account-identity';
import { LoginScreen } from '../auth/LoginScreen';
import { HERMES_ORIGIN_TRANSPORT_ERROR } from '../config';
import {
  NotificationProvider,
  useTaskNotificationTarget,
} from '../notifications/NotificationProvider';
import { FrontendPreviewApp } from '../studio/FrontendPreviewApp';
import { IOSContextProvider } from '../context/IOSContextProvider';
import {
  FrontendPreviewThemeProvider,
  ThemeProvider,
  useTheme,
} from '../design/ThemeProvider';
import { useWebUiFonts } from './webui-fonts';
import { isFrontendPreviewRuntime } from './frontend-preview-mode';
import { subscribeHermesDeepLinks } from './hermes-deep-link-coordinator';
import {
  parseHermesDeepLink,
  reconcileHermesDeepLinkAccount,
  type AccountBoundHermesDeepLinkTarget,
  type HermesDeepLinkTarget,
} from './hermes-deep-link';
import { initializeTemporaryPlaintextFiles } from '../api/temporary-plaintext-files';

// The preview is deliberately limited to the web dev shell. Native builds keep
// the real authentication boundary even when Metro is running in development.
const FRONTEND_PREVIEW = process.env.EXPO_PUBLIC_FRONTEND_PREVIEW === '1'
  || isFrontendPreviewRuntime;

export function HermesNativeApp() {
  const fontsLoaded = useWebUiFonts();
  useEffect(() => {
    startNativeFrameRateController();
    if (Platform.OS !== 'web') {
      try {
        initializeTemporaryPlaintextFiles();
      } catch {
        // Preview operations retry and fail closed if stale plaintext cannot be removed.
      }
    }
  }, []);

  return (
    <View style={styles.root}>
      {fontsLoaded ? (
        FRONTEND_PREVIEW ? (
          <FrontendPreviewThemeProvider>
            <ThemedNativeSurface>
              <ThemedStatusBar />
              <View
                accessibilityLabel="Hermes frontend preview"
                style={styles.nativeContent}
              >
                <FrontendPreviewApp
                  cacheOwner="https://preview.hermes.invalid|preview|acctgen_frontend_preview"
                />
              </View>
            </ThemedNativeSurface>
          </FrontendPreviewThemeProvider>
        ) : HERMES_ORIGIN_TRANSPORT_ERROR ? (
          <ConfigErrorScreen message={HERMES_ORIGIN_TRANSPORT_ERROR} />
        ) : (
          <AuthProvider>
            <NotificationProvider>
              <NativeAuthRoot />
            </NotificationProvider>
          </AuthProvider>
        )
      ) : null}
    </View>
  );
}

function NativeAuthRoot() {
  const { state, client, deleteAccount, logout } = useAuth();
  const notificationTarget = useTaskNotificationTarget();
  const navigationTarget = useHermesDeepLinkTarget(
    state.status === 'authenticated'
      ? `${state.connection.baseUrl}\u0000${state.connection.username.toLowerCase()}`
        + `\u0000${state.connection.accountGeneration}`
      : null,
  );
  if (state.status !== 'authenticated') return <LoginScreen />;
  if (!client) return null;
  const ownerScope = accountOwnerScope(state.connection);
  return (
    <ThemeProvider client={client}>
      <ThemedNativeSurface>
        <ThemedStatusBar />
        <View
          accessibilityLabel="Hermes authenticated content"
          style={styles.nativeContent}
        >
          <IOSContextProvider
            accountGeneration={state.connection.accountGeneration}
            client={client}
            deviceId={state.connection.deviceId || ''}
            ownerScope={ownerScope}
          >
            <FrontendPreviewApp
              account={{
                deleteAccount,
                logout,
                username: state.connection.username,
              }}
              cacheOwner={ownerScope}
              client={client}
              navigationTarget={navigationTarget}
              notificationTarget={notificationTarget}
            />
          </IOSContextProvider>
        </View>
      </ThemedNativeSurface>
    </ThemeProvider>
  );
}

function useHermesDeepLinkTarget(
  accountKey: string | null,
): (HermesDeepLinkTarget & { requestId: number }) | null {
  const [bound, setBound] = useState<AccountBoundHermesDeepLinkTarget | null>(null);
  const accountKeyRef = useRef(accountKey);
  accountKeyRef.current = accountKey;
  const nextRequestId = useRef(0);
  const accept = useCallback((url: string) => {
    const parsed = parseHermesDeepLink(url);
    if (!parsed) return;
    nextRequestId.current += 1;
    setBound({
      accountKey: accountKeyRef.current,
      target: { ...parsed, requestId: nextRequestId.current },
    });
  }, []);

  useEffect(() => {
    setBound((current) => reconcileHermesDeepLinkAccount(current, accountKey));
  }, [accountKey]);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    return subscribeHermesDeepLinks(Linking, accept);
  }, [accept]);
  return bound?.target ?? null;
}

// A cleartext EXPO_PUBLIC_HERMES_URL used to throw while src/config.ts was
// imported, taking the bundle down before any UI could mount. The recorded
// transport error renders here instead, keeping the remediation readable.
function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" style={styles.configError}>
      <Text style={styles.configErrorTitle}>配置错误</Text>
      <Text style={styles.configErrorText}>{message}</Text>
    </View>
  );
}

function ThemedNativeSurface({ children }: PropsWithChildren) {
  const { theme } = useTheme();
  return (
    <View style={[styles.themedSurface, { backgroundColor: theme.palette.background.hex }]}>
      {children}
    </View>
  );
}

function ThemedStatusBar() {
  const { theme } = useTheme();
  return (
    <StatusBar
      animated
      backgroundColor="transparent"
      style={isLightColor(theme.palette.background.hex) ? 'dark' : 'light'}
      translucent
    />
  );
}

function isLightColor(hex: string): boolean {
  const value = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return false;
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  const linear = (channel: number) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(red)
    + 0.7152 * linear(green)
    + 0.0722 * linear(blue);
  return luminance > 0.45;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0e0e0e',
  },
  nativeContent: {
    flex: 1,
  },
  themedSurface: {
    flex: 1,
  },
  configError: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  configErrorTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '600',
  },
  configErrorText: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 15,
    lineHeight: 22,
  },
});
