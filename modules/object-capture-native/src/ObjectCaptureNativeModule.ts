import { NativeModule, requireNativeModule } from 'expo';
import { 
  ObjectCaptureNativeModuleEvents, 
  StartScanningResult, 
  ProcessModelResult 
} from './ObjectCaptureNative.types';

declare class ObjectCaptureNativeModule extends NativeModule<ObjectCaptureNativeModuleEvents> {
  startScanning(): Promise<StartScanningResult>;
  processModel(imageDir: string): Promise<ProcessModelResult>;
  cancelProcessing(): Promise<boolean>;
  isSupported(): Promise<boolean>;
}

export default requireNativeModule<ObjectCaptureNativeModule>('ObjectCaptureNative');
