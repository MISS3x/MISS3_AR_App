import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';

import { ARRulerNativeViewProps } from './ARRulerNative.types';

const NativeView: React.ComponentType<ARRulerNativeViewProps> =
  requireNativeViewManager('ARRulerNative');

const ARRulerNativeView = React.forwardRef<any, ARRulerNativeViewProps>((props, ref) => {
  return <NativeView {...props} ref={ref as any} />;
});

export default ARRulerNativeView;
