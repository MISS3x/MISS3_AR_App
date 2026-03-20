export type ObjectCaptureNativeModuleEvents = {
  onProcessingProgress: (event: { progress: number }) => void;
};

export type StartScanningResult = {
  imageDirectory: string;
};

export type ProcessModelResult = {
  objPath: string;
};
