import React from 'react';
import { Platform } from 'react-native';

const ARTapeScreen = Platform.select({
  ios: () => require('./ARTapeScreen.native').default,
  default: () => require('./ARTapeScreen.web').default,
})!;

export default function ARTapeScreenWrapper(props: any) {
  const Screen = ARTapeScreen();
  return <Screen {...props} />;
}
