import { NativeModule, requireNativeModule } from 'expo';

import { LidarMeshModuleEvents } from './LidarMesh.types';

declare class LidarMeshModule extends NativeModule<LidarMeshModuleEvents> {
  PI: number;
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<LidarMeshModule>('LidarMesh');
