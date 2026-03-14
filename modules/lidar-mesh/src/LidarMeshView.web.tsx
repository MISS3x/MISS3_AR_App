import * as React from 'react';

import { LidarMeshViewProps } from './LidarMesh.types';

export default function LidarMeshView(props: LidarMeshViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
