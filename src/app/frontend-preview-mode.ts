import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Expo Web is already a local frontend preview during development. Expo Go
// must enter the same preview path so its Agent Rooms and Workflows pages use
// the same JS surface and fixture data as the browser. Signed/authenticated
// builds never enter this branch because __DEV__ is false there.
export const isExpoGoRuntime = Constants.executionEnvironment === 'storeClient';

export const isFrontendPreviewRuntime = __DEV__ && (
  Platform.OS === 'web' || isExpoGoRuntime
);
