import { ViewProps } from 'react-native';

export interface ARRulerNativeViewProps extends ViewProps {
  onUpdate?: (event: any) => void;
  onPlaneStateChange?: (event: { nativeEvent: { status: string } }) => void;
  /** Hex color string for the LiDAR mesh wireframe, e.g. "#66FF66" */
  meshColor?: string;
  /** Drawing mode: 'floor' (locked Y), 'free' (any surface), 'wall' */
  drawingMode?: 'floor' | 'free' | 'wall';
  /** Whether to show the mesh wireframe */
  showWire?: boolean;
  /** Whether to show the LiDAR mesh surface */
  showMesh?: boolean;
  /** Alias for showWire */
  showWireframe?: boolean;
  /** Whether to show RoomPlan visualization (walls, doors, windows, objects) */
  showRoomPlan?: boolean;
  /** Async command to load remote shapes */
  loadRemoteObjects?: (objects: any[]) => Promise<number>;
}
