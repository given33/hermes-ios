import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { LoginScreen } from '../auth/LoginScreen';
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
  const { state } = useAuth();
  if (state.status !== 'authenticated') return <LoginScreen />;
  return <View accessibilityLabel="Hermes authenticated content" style={styles.contentSlot} />;
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
