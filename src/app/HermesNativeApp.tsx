import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { LoginScreen } from '../auth/LoginScreen';
import { FrontendPreviewApp } from '../preview/FrontendPreviewApp';
import {
  FrontendPreviewThemeProvider,
  ThemeProvider,
} from '../design/ThemeProvider';
import { NativeShell } from './NativeShell';
import { useWebUiFonts } from './webui-fonts';

const FRONTEND_PREVIEW =
  __DEV__ && process.env.EXPO_PUBLIC_FRONTEND_PREVIEW === '1';

export function HermesNativeApp() {
  const fontsLoaded = useWebUiFonts();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {fontsLoaded ? (
        FRONTEND_PREVIEW ? (
          <FrontendPreviewThemeProvider>
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
      <View
        accessibilityLabel="Hermes authenticated content"
        style={styles.nativeContent}
      >
        <NativeShell />
      </View>
    </ThemeProvider>
  );
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
