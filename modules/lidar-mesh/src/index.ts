import { requireNativeModule } from 'expo-modules-core';

const LidarMesh = (() => {
  try {
    return requireNativeModule('LidarMesh');
  } catch {
    return null;
  }
})();

/** Check if this module loaded successfully */
export function isModuleLoaded(): boolean {
  return LidarMesh !== null;
}

/** Simple ping to verify module is alive */
export function ping(): string {
  if (!LidarMesh) return 'Module not loaded';
  try {
    return LidarMesh.ping();
  } catch (e) {
    return `ping error: ${e}`;
  }
}

/** Check if device has LiDAR */
export function isLidarAvailable(): boolean {
  if (!LidarMesh) return false;
  try {
    return LidarMesh.isLidarAvailable();
  } catch {
    return false;
  }
}

/** Enable ARKit scene reconstruction (.mesh) on the active AR session */
export async function enableSceneReconstruction(): Promise<Record<string, any>> {
  if (!LidarMesh) return { error: 'Module not loaded' };
  try {
    return await LidarMesh.enableSceneReconstruction();
  } catch (e) {
    return { error: String(e) };
  }
}

/** Get wireframe mesh data from ARMeshAnchors
 * Returns { vertices: [[x,y,z],...], edges: [[v1,v2],...], anchors, totalVertices, totalEdges }
 */
export async function getMeshWireframe(maxVertices: number = 5000): Promise<{
  vertices: [number, number, number][];
  edges: [number, number][];
  anchors: number;
  totalVertices: number;
  totalEdges: number;
}> {
  if (!LidarMesh) return { vertices: [], edges: [], anchors: 0, totalVertices: 0, totalEdges: 0 };
  try {
    return await LidarMesh.getMeshWireframe(maxVertices);
  } catch (e) {
    console.warn('[LidarMesh] getMeshWireframe failed:', e);
    return { vertices: [], edges: [], anchors: 0, totalVertices: 0, totalEdges: 0 };
  }
}

// Legacy exports for backward compatibility
export async function getMeshSlice(cutHeight: number): Promise<[number, number][]> {
  return [];
}

export async function getMeshVertices(maxPoints: number = 2000): Promise<[number, number, number][]> {
  return [];
}

export async function getDebugInfo(): Promise<Record<string, any>> {
  if (!LidarMesh) return { moduleLoaded: false };
  try {
    const result = await LidarMesh.enableSceneReconstruction();
    return { moduleLoaded: true, ...result };
  } catch (e) {
    return { moduleLoaded: true, error: String(e) };
  }
}
