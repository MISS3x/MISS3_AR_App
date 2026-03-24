# Apple RoomPlan API Reference

> Source: https://developer.apple.com/documentation/roomplan
> Framework: iOS 16.0+, iPadOS 16.0+

## Overview

RoomPlan creates 3D models of interior rooms using LiDAR + camera + ML.
Detects: walls, windows, doors, openings, floors, ceilings + furniture/appliances.

---

## Key Classes

### RoomCaptureView (SwiftUI)
Built-in scanning UI with real-time graphic overlays on detected surfaces.
Shows revealing lines around walls, doors, windows as they're detected.

### RoomCaptureSession
Low-level API for custom scanning UI.
Delegate: `RoomCaptureSessionDelegate`

```swift
protocol RoomCaptureSessionDelegate {
    func captureSession(_ session: RoomCaptureSession, didStartWith configuration: RoomCaptureSession.Configuration)
    func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom)
    func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction)
    func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?)
}
```

### CapturedRoom
Output structure containing all detected elements:

```swift
struct CapturedRoom {
    var walls: [Surface]      // Wall surfaces
    var doors: [Surface]      // Door surfaces  
    var windows: [Surface]    // Window surfaces
    var openings: [Surface]   // Wall openings
    var floors: [Surface]     // Floor surfaces (iOS 17+: polygon support)
    var objects: [Object]     // Furniture & appliances
    var sections: [Section]   // Room sections (iOS 17+)
}
```

### CapturedRoom.Surface
```swift
struct Surface: Codable {
    let identifier: UUID
    let category: Category    // .wall, .door, .window, .opening, .floor
    let dimensions: simd_float3
    let transform: simd_float4x4
    let curve: CurvedSurface? // iOS 17+ for curved walls
    let confidence: Confidence // .low, .medium, .high
}
```

**Surface.Category**: `wall`, `door(isOpen: Bool)`, `window`, `opening`, `floor`

### CapturedRoom.Object
```swift
struct Object: Codable {
    let identifier: UUID
    let category: Category
    let dimensions: simd_float3
    let transform: simd_float4x4
    let confidence: Confidence
    let attributes: [String: String]  // iOS 17+
}
```

**Object.Category** (16 types):
`bathtub`, `bed`, `chair`, `dishwasher`, `fireplace`, `oven`, `refrigerator`,
`sink`, `sofa`, `stairs`, `storage`, `stove`, `table`, `television`, `toilet`, `washerDryer`

---

## RoomBuilder & StructureBuilder

### RoomBuilder
Generates final 3D asset from `CapturedRoomData`:
```swift
let roomBuilder = RoomBuilder(options: [.beautifyObjects])
let finalRoom = try await roomBuilder.capturedRoom(from: capturedRoomData)
```

### StructureBuilder (iOS 17+)
Merges multiple room scans into one structure:
```swift
let structureBuilder = StructureBuilder(options: [.beautifyObjects])
let structure = try await structureBuilder.capturedStructure(from: [roomData1, roomData2])
```

---

## USD Export
```swift
let exportOptions = CapturedRoom.USDExportOptions()
try finalRoom.export(to: url, exportOptions: exportOptions)
// Produces .usdz with parametric geometry
```

---

## Key Design Patterns from Apple Sample Code

### RoomCaptureView Approach (Recommended)
The `RoomCaptureView` handles all AR rendering including:
- **Revealing line overlays** on detected surfaces
- **Instruction text** ("Move device slowly", "Point at walls")
- **Real-time bounding box** visualization for objects
- **Post-scan 3D preview** for user approval

### Custom Session Approach
For custom UI, use `RoomCaptureSession` directly:
1. Create session + set delegate
2. Call `session.run(configuration:)`
3. Receive `didUpdate room:` callbacks with live `CapturedRoom`
4. Receive `didEndWith data:` when scan completes
5. Feed `data` into `RoomBuilder` for ML finalization

---

## Our Implementation Status

### What we have:
- `ARRulerNativeView.swift` uses `RoomCaptureSession` with custom SceneKit rendering
- `exportRoomPlanData()` extracts walls/doors/windows/objects with transforms
- 15s auto-sync sends RoomPlan data + mesh chunks to Supabase
- Post-scan finalization with `RoomBuilder`

### What we're missing (from Apple reference):
- [ ] **Revealing line overlays** — the animated lines that appear around detected surfaces as you scan
- [ ] **RoomCaptureView integration** — Apple's built-in view with the full visual experience
- [ ] **Instruction prompts** — "Move device slowly", "Point camera to ceiling", etc.
- [ ] **Post-scan 3D preview** — small-scale approval view before saving
- [ ] **Multi-room merging** via StructureBuilder
- [ ] **Custom 3D models** for furniture categories (replacing bounding boxes with real models)
