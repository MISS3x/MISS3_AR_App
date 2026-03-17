import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';

import { ARRulerNativeViewProps } from './ARRulerNative.types';

const NativeView: React.ComponentType<ARRulerNativeViewProps> =
  requireNativeViewManager('ARRulerNative');

export default function ARRulerNativeView(props: ARRulerNativeViewProps) {
  return <NativeView {...props} />;
}
