import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { startNativeFrameRateController } from '../../modules/hermes-ios-controls';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { LoginScreen } from '../auth/LoginScreen';
import { FrontendPreviewApp } from '../preview/FrontendPreviewApp';
import {
  FrontendPreviewThemeProvider,
  ThemeProvider,
  useTheme,
} from '../design/ThemeProvider';
import { NativeShell } from './NativeShell';
import { useWebUiFonts } from './webui-fonts';

const FRONTEND_PREVIEW = process.env.EXPO_PUBLIC_FRONTEND_PREVIEW === '1';

export function HermesNativeApp() {
  const fontsLoaded = useWebUiFonts();
  useEffect(() => {
    startNativeFrameRateController();
  }, []);

  return (
    <View style={styles.root}>
      {fontsLoaded ? (
        FRONTEND_PREVIEW ? (
          <FrontendPreviewThemeProvider>
            <ThemedStatusBar />
            <View
              accessibilityLabel="Hermes frontend preview"
              style={styles.nativeContent}
            >
              <FrontendPreviewApp />
            </View>
          </FrontendPreviewThemeProvider>
        ) : (
          <AuthProvider>
            <NativeAuthRoot />
          </AuthProvider>
        )
      ) : null}
    </View>
  );
}

function NativeAuthRoot() {
  const { state, client } = useAuth();
  if (state.status !== 'authenticated') return <LoginScreen />;
  if (!client) return null;
  return (
    <ThemeProvider client={client}>
      <ThemedStatusBar />
      <View
        accessibilityLabel="Hermes authenticated content"
        style={styles.nativeContent}
      >
        <NativeShell />
      </View>
    </ThemeProvider>
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
    backgroundColor: '#170d02',
  },
  nativeContent: {
    flex: 1,
  },
});
