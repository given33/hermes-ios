import { registerRootComponent } from 'expo';

import App from './App';

// Expo owns process startup; the registered app immediately mounts the SwiftUI host.
registerRootComponent(App);
