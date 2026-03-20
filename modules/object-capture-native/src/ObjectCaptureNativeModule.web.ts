import { registerWebModule, NativeModule } from 'expo';

import { ChangeEventPayload } from './ObjectCaptureNative.types';

type ObjectCaptureNativeModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
}

class ObjectCaptureNativeModule extends NativeModule<ObjectCaptureNativeModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
};

export default registerWebModule(ObjectCaptureNativeModule, 'ObjectCaptureNativeModule');
