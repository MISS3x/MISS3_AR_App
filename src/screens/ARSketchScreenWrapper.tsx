import React from 'react';
import { Platform } from 'react-native';

const ARSketchScreen = Platform.select({
  ios: () => require('./ARSketchScreen.native').default,
  default: () => require('./ARSketchScreen.web').default,
})!;

export default function ARSketchScreenWrapper(props: any) {
  const Screen = ARSketchScreen();
  return <Screen {...props} />;
}
