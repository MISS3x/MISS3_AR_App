import { requireNativeModule } from 'expo-modules-core';

const LidarMesh = (() => {
  try {
    return requireNativeModule('LidarMesh');
  } catch {
    return null;
  }
})();

export function isModuleLoaded(): boolean {
  return LidarMesh !== null;
}

export function ping(): string {
  if (!LidarMesh) return 'Module not loaded';
  try {
    return LidarMesh.hello();
  } catch (e) {
    return `error: ${e}`;
  }
}

export function isLidarAvailable(): boolean {
  if (!LidarMesh) return false;
  try {
    return LidarMesh.isLidarAvailable();
  } catch {
    return false;
  }
}

export async function enableSceneReconstruction(): Promise<Record<string, any>> {
  if (!LidarMesh) return { error: 'Module not loaded' };
  try {
    return await LidarMesh.enableSceneReconstruction();
  } catch (e) {
    return { error: String(e) };
  }
}

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

// Legacy compat
export async function getMeshSlice(_cutHeight: number): Promise<[number, number][]> { return []; }
export async function getMeshVertices(_maxPoints: number = 2000): Promise<[number, number, number][]> { return []; }
export async function getDebugInfo(): Promise<Record<string, any>> {
  if (!LidarMesh) return { moduleLoaded: false };
  try {
    const r = await LidarMesh.enableSceneReconstruction();
    return { moduleLoaded: true, ...r };
  } catch (e) {
    return { moduleLoaded: true, error: String(e) };
  }
}
