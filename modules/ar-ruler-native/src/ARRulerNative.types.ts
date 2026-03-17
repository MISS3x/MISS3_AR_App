import { ViewProps } from 'react-native';

export interface ARRulerNativeViewProps extends ViewProps {
  onUpdate?: (event: any) => void;
  onPlaneStateChange?: (event: { nativeEvent: { status: string } }) => void;
}
