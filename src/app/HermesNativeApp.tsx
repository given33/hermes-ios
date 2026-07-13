import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { LoginScreen } from '../auth/LoginScreen';
import { ThemeProvider } from '../design/ThemeProvider';
import { useWebUiFonts } from './webui-fonts';

export function HermesNativeApp() {
  const fontsLoaded = useWebUiFonts();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {fontsLoaded ? (
        <AuthProvider>
          <NativeAuthRoot />
        </AuthProvider>
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
      <View accessibilityLabel="Hermes authenticated content" style={styles.contentSlot} />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#170d02',
  },
  contentSlot: {
    flex: 1,
    backgroundColor: '#041c1c',
  },
});
