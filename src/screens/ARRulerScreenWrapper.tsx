// ============================================================
// AR Ruler Screen Wrapper
// ============================================================
import React from 'react';
import { Platform } from 'react-native';

// Dynamically import the native or web version of the AR Ruler Screen
let ARRulerScreen: any;

if (Platform.OS === 'web') {
  ARRulerScreen = require('./ARRulerScreen').default;
} else {
  ARRulerScreen = require('./ARRulerScreen.native').default;
}

export default function ARRulerScreenWrapper(props: any) {
  return <ARRulerScreen {...props} />;
}
