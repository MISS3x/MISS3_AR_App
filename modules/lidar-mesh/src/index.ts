import { requireNativeModule, Platform } from 'expo-modules-core';

// The native module will only exist on iOS
const LidarMesh = Platform.OS === 'ios' ? requireNativeModule('LidarMesh') : null;

/**
 * Get mesh contour points at the given height (Y plane slice).
 * Returns array of [x, z] world-coordinate points where LiDAR mesh intersects the horizontal plane.
 * Only works on iOS devices with LiDAR sensor.
 */
export async function getMeshSlice(cutHeight: number = 1.0): Promise<[number, number][]> {
  if (!LidarMesh) {
    console.warn('[LidarMesh] Not available on this platform');
    return [];
  }
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
