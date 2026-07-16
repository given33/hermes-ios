import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import type { HermesChatStreamRuntime } from './HermesChatStream';

export function createNativeHermesChatStreamRuntime(): HermesChatStreamRuntime {
  return {
    currentAppState: () => AppState.currentState,
    createSocket: (url) => new WebSocket(url),
    now: () => Date.now(),
    random: () => Math.random(),
    subscribeAppState(listener) {
      const subscription = AppState.addEventListener('change', listener);
      return () => subscription.remove();
    },
    subscribeNetwork(listener) {
      return NetInfo.addEventListener((state) => {
        listener(state.isConnected !== false && state.isInternetReachable !== false);
      });
    },
  };
}
