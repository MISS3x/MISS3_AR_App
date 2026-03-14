import { registerWebModule, NativeModule } from 'expo';

import { ChangeEventPayload } from './LidarMesh.types';

type LidarMeshModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
}

class LidarMeshModule extends NativeModule<LidarMeshModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
};

export default registerWebModule(LidarMeshModule, 'LidarMeshModule');
