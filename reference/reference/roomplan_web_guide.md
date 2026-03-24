# RoomPlan Integration — Web Viewer Guide

## Data Source

**Supabase table:** `ar_roomplan`

```sql
SELECT * FROM ar_roomplan WHERE project_id = '<PROJECT_ID>';
```

Returns **one row per project** (upserted every 15s from the iOS app):

| Column | Type | Description |
|--------|------|-------------|
| `walls` | JSONB[] | Structured wall surfaces |
| `doors` | JSONB[] | Detected doors |
| `windows` | JSONB[] | Detected windows |
| `openings` | JSONB[] | Open passages |
| `floors` | JSONB[] | Floor surfaces |
| `objects` | JSONB[] | Furniture (table, chair, sofa, bed, TV...) |
| `wall_count` | int | Quick count for UI badges |
| `door_count` | int | |
| `window_count` | int | |
| `object_count` | int | |

---

## Element JSON Structure

Every element (wall, door, window, floor, object) has the **same structure**:

```json
{
  "identifier": "UUID-string",
  "category": "wall",
  "dimensions": { "width": 3.2, "height": 2.8, "depth": 0.15 },
  "position": { "x": 1.5, "y": 1.4, "z": -2.0 },
  "transform": [
    m00, m01, m02, m03,
    m10, m11, m12, m13,
    m20, m21, m22, m23,
    m30, m31, m32, m33
  ]
}
```

- **dimensions**: Real-world size in meters (width × height × depth)
- **position**: Center point extracted from transform column 3
- **transform**: Full 4×4 matrix (column-major, same as Three.js `Matrix4`)

### Category values:
- Surfaces: `wall`, `door`, `window`, `opening`, `floor`
- Furniture: `chair`, `table`, `sofa`, `bed`, `storage`, `refrigerator`, `stove`, `oven`, `sink`, `washerDryer`, `toilet`, `bathtub`, `television`, `unknown`

---

## Three.js Rendering

### 1. Load transform matrix

```javascript
function applyTransform(mesh, transformArray) {
  // Apple's transform is column-major — same as Three.js
  const m = new THREE.Matrix4();
  m.set(
    transformArray[0], transformArray[4], transformArray[8],  transformArray[12],
    transformArray[1], transformArray[5], transformArray[9],  transformArray[13],
    transformArray[2], transformArray[6], transformArray[10], transformArray[14],
    transformArray[3], transformArray[7], transformArray[11], transformArray[15]
  );
  mesh.applyMatrix4(m);
}
```

### 2. Create element mesh

```javascript
function createRoomElement(element, color, opacity = 0.3) {
  const { width, height, depth } = element.dimensions;
  const geometry = new THREE.BoxGeometry(width, height, depth);

  // Translucent fill
  const material = new THREE.MeshBasicMaterial({
    color, opacity, transparent: true, side: THREE.DoubleSide, depthWrite: false
  });
  const mesh = new THREE.Mesh(geometry, material);

  // Wireframe edges
  const edges = new THREE.EdgesGeometry(geometry);
  const line = new THREE.LineSegments(edges,
    new THREE.LineBasicMaterial({ color, opacity: 0.8, transparent: true })
  );
  mesh.add(line);

  applyTransform(mesh, element.transform);
  return mesh;
}
```

### 3. Color scheme

```javascript
const ROOMPLAN_COLORS = {
  wall:     0x4D80E6,  // blue
  door:     0xFF9800,  // orange
  window:   0x00E5FF,  // cyan
  opening:  0xCCCC00,  // yellow
  floor:    0x00CC4D,  // green
  // Furniture
  chair:    0xFFEB3B,
  table:    0x4CAF50,
  sofa:     0x9C27B0,
  bed:      0x9C27B0,
  television: 0x2196F3,
  default:  0x999999,
};
```

### 4. Full render function

```javascript
async function renderRoomPlan(projectId, scene) {
  const { data } = await supabase
    .from('ar_roomplan')
    .select('*')
    .eq('project_id', projectId)
    .single();

  if (!data) return;

  const group = new THREE.Group();
  group.name = 'roomplan';

  // Walls
  data.walls?.forEach(w => group.add(createRoomElement(w, ROOMPLAN_COLORS.wall, 0.25)));

  // Doors — render as cutouts or colored boxes
  data.doors?.forEach(d => group.add(createRoomElement(d, ROOMPLAN_COLORS.door, 0.4)));

  // Windows
  data.windows?.forEach(w => group.add(createRoomElement(w, ROOMPLAN_COLORS.window, 0.4)));

  // Openings
  data.openings?.forEach(o => group.add(createRoomElement(o, ROOMPLAN_COLORS.opening, 0.3)));

  // Floors
  data.floors?.forEach(f => group.add(createRoomElement(f, ROOMPLAN_COLORS.floor, 0.15)));

  // Furniture
  data.objects?.forEach(obj => {
    const color = ROOMPLAN_COLORS[obj.category] || ROOMPLAN_COLORS.default;
    group.add(createRoomElement(obj, color, 0.2));
  });

  // Remove old roomplan group if exists
  const old = scene.getObjectByName('roomplan');
  if (old) scene.remove(old);

  scene.add(group);
}
```

### 5. Real-time polling (15s)

```javascript
setInterval(() => renderRoomPlan(projectId, scene), 15000);
```

---

## 2D Floorplan Mode

For the 2D orthographic view, project walls to the floor plane:

```javascript
function render2DFloorplan(data) {
  data.walls?.forEach(wall => {
    // Extract position and rotation from transform
    const pos = wall.position;
    const w = wall.dimensions.width;
    const d = wall.dimensions.depth;

    // Draw as a 2D rectangle at Y=0
    const shape = new THREE.PlaneGeometry(w, d);
    const mesh = new THREE.Mesh(shape, wallMaterial2D);
    mesh.rotation.x = -Math.PI / 2; // lay flat
    mesh.position.set(pos.x, 0, pos.z);
    // Apply yaw rotation from transform
    const yaw = Math.atan2(wall.transform[1], wall.transform[0]);
    mesh.rotation.z = yaw;
    scene.add(mesh);
  });

  // Add door/window markers as colored lines on walls
  data.doors?.forEach(door => { /* draw orange line on wall */ });
  data.windows?.forEach(win => { /* draw cyan line on wall */ });
}
```

---

## UI Toggle Buttons

Add to the existing filter bar alongside Wall/Window/Door/Table/Sofa:

```
[🏠 RoomPlan ON/OFF]  [📐 Measurements]  [📦 Mesh]  [🎯 Bounding Boxes]
```

When **RoomPlan ON**: show clean RoomPlan walls/doors/windows
When **RoomPlan OFF**: show raw bounding boxes (legacy)

---

## Key Differences: RoomPlan vs Old Bounding Boxes

| | Old (`ar_bounding_boxes`) | New (`ar_roomplan`) |
|---|---|---|
| Source | Raw ARKit plane detection | Apple RoomPlan API |
| Walls | Irregular planes, varying heights | Uniform height, aligned |
| Doors/Windows | Not detected | Properly detected |
| Floors | Not explicit | Explicit floor surfaces |
| Quality | Messy, overlapping | Clean, structured |
| Update | Every 15s via `syncCADData()` | Every 15s via `exportRoomPlanData()` |

> **Recommendation:** Default to RoomPlan view when data exists. Fall back to old bounding boxes only if `ar_roomplan` is empty.
