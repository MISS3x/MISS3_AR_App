import ObjectCaptureNativeModule from './src/ObjectCaptureNativeModule';
export * from './src/ObjectCaptureNative.types';

export async function startScanning() {
  return await ObjectCaptureNativeModule.startScanning();
}

export async function processModel(imageDir: string) {
  return await ObjectCaptureNativeModule.processModel(imageDir);
}

export async function cancelProcessing() {
  return await ObjectCaptureNativeModule.cancelProcessing();
}

export function addProcessingProgressListener(listener: (event: { progress: number }) => void) {
  return ObjectCaptureNativeModule.addListener('onProcessingProgress', listener);
}
