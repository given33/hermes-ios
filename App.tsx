import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HermesNativeApp } from './src/app/HermesNativeApp';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <HermesNativeApp />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
