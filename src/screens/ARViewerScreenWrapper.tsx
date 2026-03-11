import React from 'react';
import { Platform } from 'react-native';

// We cannot use standard imports for ViroReact screens when running on Web,
// because Metro bundler tries to resolve all dependencies (like native Viro)
// which crash the Web browser environment immediately on startup.
// We use a conditional require to guarantee Viro is only ever imported on iOS/Android.

let ARViewerScreenComponent: any = null;

if (Platform.OS !== 'web') {
  // Only require the native AR screen if we are on a mobile device
  ARViewerScreenComponent = require('./ARViewerScreen.native').default;
} else {
  // On Web, use our stub screen
  ARViewerScreenComponent = require('./ARViewerScreen.web').default;
}

export default function ARViewerScreen(props: any) {
  return <ARViewerScreenComponent {...props} />;
}
