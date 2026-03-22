export type ObjectCaptureNativeModuleEvents = {
  onProcessingProgress: (event: { progress: number }) => void;
  onProcessingState: (event: { state: string; imageCount?: number; message?: string }) => void;
};

export type StartScanningResult = {
  imageDirectory: string;
  imageCount: number;
};

export type ProcessModelResult = {
  modelPath: string;
  fileSize: number;
  format: string;
};
