# MISS3 Mobile App — Modular Architecture

Each company build can enable specific feature modules.
This folder contains the module registry and individual module implementations.

## Structure

```
src/modules/
  ├── module-registry.ts    # Central config — which modules are ON/OFF
  ├── ar-floor/             # AR: place models on floor (Phase 2)
  ├── ar-wall/              # AR: place models on wall (Phase 2)
  ├── ar-qr-scan/           # QR code → open model in AR
  ├── export-floorplan/     # Export floor layout + dimensions
  ├── export-wallplan/      # Export wall layout
  ├── export-item-list/     # Export product list
  ├── ar-measure/           # Measure distances in AR
  └── ar-screenshot/        # Capture AR scene
```

## Enabling Modules

Option A — Via `.env`:
```
EXPO_PUBLIC_MODULES=arFloor,exportFloorplan,arScreenshot
```

Option B — Via build config file:
```typescript
// src/builds/furniture-company.ts
export const modules = {
  arFloor: true,
  exportFloorplan: true,
  arScreenshot: true,
};
```

## Adding a New Module

1. Create folder: `src/modules/my-module/`
2. Add screen: `src/modules/my-module/MyModuleScreen.tsx`
3. Register in `module-registry.ts`
4. Conditionally render in navigator based on `isModuleEnabled('myModule')`
