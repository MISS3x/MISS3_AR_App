import * as React from 'react';

import { ObjectCaptureNativeViewProps } from './ObjectCaptureNative.types';

export default function ObjectCaptureNativeView(props: ObjectCaptureNativeViewProps) {
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
