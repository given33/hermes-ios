import Constants from 'expo-constants';

// Expo Go does not contain Hermes' project-local native modules. A
// re-sign-compatible IPA does contain them because they are part of the main
// application target, so it must opt into the same JavaScript fallback path
// when parity with Expo Go is required.
export const isExpoGoParityBuild =
  Constants.expoConfig?.extra?.hermesExpoGoParity === true;
