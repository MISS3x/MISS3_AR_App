import { requireNativeView } from 'expo';
import * as React from 'react';

import { ObjectCaptureNativeViewProps } from './ObjectCaptureNative.types';

const NativeView: React.ComponentType<ObjectCaptureNativeViewProps> =
  requireNativeView('ObjectCaptureNative');

export default function ObjectCaptureNativeView(props: ObjectCaptureNativeViewProps) {
  return <NativeView {...props} />;
}
