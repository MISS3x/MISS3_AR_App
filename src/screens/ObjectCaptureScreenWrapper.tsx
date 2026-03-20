import { Platform } from 'react-native';

let ObjectCaptureScreen: any;

if (Platform.OS === 'web' || Platform.OS === 'android') {
  ObjectCaptureScreen = require('./ObjectCaptureScreen').default;
} else {
  ObjectCaptureScreen = require('./ObjectCaptureScreen.native').default;
}

export default function ObjectCaptureScreenWrapper(props: any) {
  return <ObjectCaptureScreen {...props} />;
}
