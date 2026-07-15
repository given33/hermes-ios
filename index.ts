import 'react-native-gesture-handler';

import { registerRootComponent } from 'expo';

import App from './App';

// Expo owns process startup for both development clients and signed builds.
registerRootComponent(App);
