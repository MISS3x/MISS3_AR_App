// ============================================================
// Module Registry — Controls which features are enabled per build
// Each company build can enable/disable modules via this config.
// ============================================================

export interface ModuleConfig {
  // Base (always enabled)
  catalog: true;

  // AR Modules (Phase 2+)
  arFloor: boolean;    // Place models on floor
  arWall: boolean;     // Place models on wall
  arQrScan: boolean;   // Scan QR to open model in AR

  // Export Modules (Phase 3+)
  exportFloorplan: boolean;  // Export floor layout with dimensions + item list
  exportWallplan: boolean;   // Export wall layout
  exportItemList: boolean;   // Export simple product list

  // Utility Modules
  arMeasure: boolean;     // Measure distances in AR
  arScreenshot: boolean;  // Capture AR scene screenshot/video
  offlineCache: boolean;  // Download models for offline use
}

// Default config: only catalog is enabled
// Override per company build in a separate config file or env
const DEFAULT_CONFIG: ModuleConfig = {
  catalog: true,

  arFloor: false,
  arWall: false,
  arQrScan: false,

  exportFloorplan: false,
  exportWallplan: false,
  exportItemList: false,

  arMeasure: false,
  arScreenshot: false,
  offlineCache: false,
};

// To customize per company:
// 1. Create src/builds/company-x.ts with overrides
// 2. Or use EXPO_PUBLIC_MODULES env var as comma-separated list
function getModuleConfig(): ModuleConfig {
  const modulesEnv = process.env.EXPO_PUBLIC_MODULES || '';

  if (!modulesEnv) return DEFAULT_CONFIG;

  const enabledModules = modulesEnv.split(',').map((m: string) => m.trim());
  const config = { ...DEFAULT_CONFIG };

  for (const mod of enabledModules) {
    if (mod in config) {
      (config as any)[mod] = true;
    }
  }

  return config;
}

export const moduleConfig = getModuleConfig();

// Helper to check if a module is enabled
export function isModuleEnabled(module: keyof ModuleConfig): boolean {
  return moduleConfig[module] === true;
}
