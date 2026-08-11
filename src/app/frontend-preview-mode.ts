import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Expo Web is a local frontend preview during development. Expo Go is a real
// native runtime, however, and must use the authenticated Hermes app path so a
// Go session exercises the same client, transport, reducers, and official
// backend as an iOS build. It is never a fixture shortcut.
export const isExpoGoRuntime = Constants.executionEnvironment === 'storeClient';

export const isFrontendPreviewRuntime = __DEV__ && Platform.OS === 'web';
