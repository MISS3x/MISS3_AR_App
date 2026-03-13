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

/**
 * Force-enable scene reconstruction (LiDAR mesh scanning).
 * Returns true if successfully enabled.
 */
export async function enableSceneReconstruction(): Promise<boolean> {
  if (!LidarMesh) return false;
  try {
    return await LidarMesh.enableSceneReconstruction();
  } catch (e) {
    console.warn('[LidarMesh] enableSceneReconstruction failed:', e);
    return false;
  }
}

/**
 * Get full 3D mesh vertices from LiDAR scan.
 * Returns array of [x, y, z] world-coordinate points.
 * maxPoints limits output for performance (default 2000).
 */
export async function getMeshVertices(maxPoints: number = 2000): Promise<[number, number, number][]> {
  if (!LidarMesh) return [];
  try {
    return await LidarMesh.getMeshVertices(maxPoints);
  } catch (e) {
    console.warn('[LidarMesh] getMeshVertices failed:', e);
    return [];
  }
}

/**
 * Get debug info about AR session state, mesh anchors, and configuration.
 */
export async function getDebugInfo(): Promise<Record<string, any>> {
  if (!LidarMesh) return { moduleLoaded: false };
  try {
    const info = await LidarMesh.getDebugInfo();
    return { moduleLoaded: true, ...info };
  } catch (e) {
    return { moduleLoaded: true, error: String(e) };
  }
}
