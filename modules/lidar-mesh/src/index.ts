import { Platform } from 'expo-modules-core';

// Try to load native module — wrapped in try-catch to prevent crash if module isn't compiled
let LidarMesh: any = null;
try {
  if (Platform.OS === 'ios') {
    const { requireNativeModule } = require('expo-modules-core');
    LidarMesh = requireNativeModule('LidarMesh');
  }
} catch (e) {
  console.warn('[LidarMesh] Native module not available — falling back to plane-based rendering');
}

/**
 * Get mesh contour points at the given height (Y plane slice).
 * Returns array of [x, z] world-coordinate points where LiDAR mesh intersects the horizontal plane.
 * Only works on iOS devices with LiDAR sensor.
 */
export async function getMeshSlice(cutHeight: number = 1.0): Promise<[number, number][]> {
  if (!LidarMesh) return [];
  try {
    return await LidarMesh.getMeshSlice(cutHeight);
  } catch (e) {
    console.warn('[LidarMesh] getMeshSlice failed:', e);
    return [];
  }
}

/**
 * Check if the current device has LiDAR capability.
 */
export function isLidarAvailable(): boolean {
  if (!LidarMesh) return false;
  try {
    return LidarMesh.isLidarAvailable();
  } catch {
    return false;
  }
}
