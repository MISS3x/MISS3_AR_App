import { ViewProps } from 'react-native';

export interface ARRulerNativeViewProps extends ViewProps {
  onUpdate?: (event: any) => void;
  onPlaneStateChange?: (event: { nativeEvent: { status: string } }) => void;
  /** Hex color string for the LiDAR mesh wireframe, e.g. "#66FF66" */
  meshColor?: string;
  /** Drawing mode: 'floor' (locked Y), 'levels' (free Y), 'wall' */
  drawingMode?: 'floor' | 'levels' | 'wall';
  /** Whether to show the mesh wireframe */
  showWire?: boolean;
}
