import { requireNativeView } from 'expo';
import * as React from 'react';

import { LidarMeshViewProps } from './LidarMesh.types';

const NativeView: React.ComponentType<LidarMeshViewProps> =
  requireNativeView('LidarMesh');

export default function LidarMeshView(props: LidarMeshViewProps) {
  return <NativeView {...props} />;
}
