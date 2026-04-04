import Euclid
import SceneKit
import ARKit

// MARK: - SketchShape Model

struct SketchShape {
    let id: String
    var mesh: Mesh                          // Euclid mesh (CSG-capable)
    var node: SCNNode                       // SceneKit visual
    var label: String
    var color: UIColor
    var sourcePoints: [[String: Float]]     // original 2D points (for serialization)
    var extrusionHeight: Float?
    var primitiveType: String?              // cube/sphere/cylinder/cone/torus/nil
    var isSelected: Bool = false
    var position: simd_float3 = .zero       // world offset
    var rotation: simd_float3 = .zero       // euler angles (radians)
    var scaleXYZ: simd_float3 = simd_float3(1, 1, 1)
}

// MARK: - SketchShapeManager

class SketchShapeManager {
    private(set) var shapes: [SketchShape] = []
    private weak var sceneView: ARSCNView?
    
    // Selection colors
    private let selectedEmission = UIColor(red: 0.2, green: 1.0, blue: 0.4, alpha: 0.6)
    private let defaultEmission = UIColor.black
    
    // Default material
    private let shapeColors: [UIColor] = [
        UIColor(red: 0.3, green: 0.7, blue: 1.0, alpha: 0.5),  // blue
        UIColor(red: 1.0, green: 0.4, blue: 0.3, alpha: 0.5),  // red
        UIColor(red: 0.3, green: 1.0, blue: 0.5, alpha: 0.5),  // green
        UIColor(red: 1.0, green: 0.8, blue: 0.2, alpha: 0.5),  // yellow
        UIColor(red: 0.7, green: 0.3, blue: 1.0, alpha: 0.5),  // purple
        UIColor(red: 1.0, green: 0.5, blue: 0.8, alpha: 0.5),  // pink
    ]
    
    init(sceneView: ARSCNView) {
        self.sceneView = sceneView
    }
    
    // MARK: - Primitive Creation
    
    func addBox(at position: simd_float3, size: Float, label: String) -> SketchShape? {
        let mesh = Mesh.cube(size: Double(size))
        return addShapeFromMesh(mesh, at: position, label: label, primitiveType: "cube")
    }
    
    func addSphere(at position: simd_float3, radius: Float, label: String) -> SketchShape? {
        let mesh = Mesh.sphere(radius: Double(radius), slices: 24, stacks: 16)
        return addShapeFromMesh(mesh, at: position, label: label, primitiveType: "sphere")
    }
    
    func addCylinder(at position: simd_float3, radius: Float, height: Float, label: String) -> SketchShape? {
        let mesh = Mesh.cylinder(radius: Double(radius), height: Double(height), slices: 24)
        return addShapeFromMesh(mesh, at: position, label: label, primitiveType: "cylinder")
    }
    
    func addCone(at position: simd_float3, radius: Float, height: Float, label: String) -> SketchShape? {
        let mesh = Mesh.cone(radius: Double(radius), height: Double(height), slices: 24)
        return addShapeFromMesh(mesh, at: position, label: label, primitiveType: "cone")
    }
    
    func addTorus(at position: simd_float3, majorRadius: Float, minorRadius: Float, label: String) -> SketchShape? {
        // Euclid doesn't have a built-in torus — create by revolving a circle
        let circlePath = Path.circle(radius: Double(minorRadius), segments: 16)
        let torusPath = circlePath.translated(by: Vector(Double(majorRadius), 0, 0))
        let mesh = Mesh.lathe(torusPath, slices: 24)
        return addShapeFromMesh(mesh, at: position, label: label, primitiveType: "torus")
    }

    func addFreehandShape(id: String, node: SCNNode, label: String, color: UIColor, sourcePoints: [[String: Float]], thickness: Float) -> SketchShape {
        let shape = SketchShape(
            id: id,
            mesh: Mesh([]),
            node: node,
            label: label,
            color: color,
            sourcePoints: sourcePoints,
            extrusionHeight: thickness, // store thickness here
            primitiveType: "freehand"
        )
        shapes.append(shape)
        return shape
    }
    
    // MARK: - Extrusion (2D → 3D)
    
    func extrudePolygon(points: [[String: Float]], height: Float, label: String) -> SketchShape? {
        guard points.count >= 3 else { return nil }
        
        // Convert to 3D vectors
        var vectors = points.map { p -> Vector in
            Vector(Double(p["x"] ?? 0), Double(p["y"] ?? 0), Double(p["z"] ?? 0))
        }
        
        // Flatten points to best-fit plane to avoid warped polygons
        vectors = flattenToBestFitPlane(vectors)
        
        let pathPoints = vectors.map { PathPoint.point($0) }
        let path = Path(pathPoints)
        
        // Extrude along the path's face normal
        let mesh = Mesh.extrude(path, depth: Double(height))
        
        let position = simd_float3(0, 0, 0) // already positioned by point coordinates
        return addShapeFromMesh(mesh, at: position, label: label, primitiveType: nil,
                               sourcePoints: points, extrusionHeight: height)
    }
    
    /// Project points onto a best-fit plane so all points are coplanar.
    /// Uses centroid + averaged cross-product normal.
    private func flattenToBestFitPlane(_ points: [Vector]) -> [Vector] {
        guard points.count >= 3 else { return points }
        
        // 1. Compute centroid
        let centroid = points.reduce(Vector.zero, +) / Double(points.count)
        
        // 2. Compute best-fit normal using Newell's method
        var normal = Vector.zero
        for i in 0..<points.count {
            let curr = points[i]
            let next = points[(i + 1) % points.count]
            normal = normal + Vector(
                (curr.y - next.y) * (curr.z + next.z),
                (curr.z - next.z) * (curr.x + next.x),
                (curr.x - next.x) * (curr.y + next.y)
            )
        }
        
        let normalLen = normal.length
        guard normalLen > 1e-10 else {
            // Points are collinear — can't form a plane, return as-is
            return points
        }
        let unitNormal = normal / normalLen
        
        // 3. Project each point onto the plane defined by (centroid, unitNormal)
        return points.map { p in
            let v = p - centroid
            let dist = v.dot(unitNormal)
            return p - unitNormal * dist
        }
    }
    
    // MARK: - Cut / Subdivision Tool
    
    enum MeshSnapType: String {
        case vertex = "vertex"
        case edge = "edge"
        case face = "face"
    }
    
    struct MeshHitResult {
        let shapeId: String
        let snapType: MeshSnapType
        let worldPosition: simd_float3       // snapped world position
        let polygonIndex: Int                 // which polygon was hit
        let edgeIndex: Int?                   // which edge (if edge snap)
        let vertexIndex: Int?                 // which vertex (if vertex snap)
        let edgeParam: Float?                 // 0-1 param along edge
    }
    
    private let vertexSnapRadius: Float = 0.02  // 2cm snap to vertex
    private let edgeSnapRadius: Float = 0.015   // 1.5cm snap to edge
    private var cutHighlightNode: SCNNode?
    
    /// Hit-test against mesh elements for snap (vertex → edge → face priority)
    func hitTestMeshElement(at screenCenter: CGPoint) -> [String: Any]? {
        guard let scnView = sceneView else { return nil }
        
        let hitResults = scnView.hitTest(screenCenter, options: [
            .searchMode: SCNHitTestSearchMode.all.rawValue,
            .ignoreHiddenNodes: true
        ])
        
        for hit in hitResults {
            guard let nodeName = hit.node.name ?? hit.node.parent?.name,
                  nodeName.hasPrefix("sketch_") else { continue }
            
            let shapeId = String(nodeName.dropFirst("sketch_".count))
            // Check parent too (wireframe child nodes)
            let actualShapeId: String
            if let idx = shapes.firstIndex(where: { $0.id == shapeId }) {
                actualShapeId = shapeId
            } else if let parentName = hit.node.parent?.name,
                      parentName.hasPrefix("sketch_") {
                actualShapeId = String(parentName.dropFirst("sketch_".count))
            } else { continue }
            
            guard let shapeIdx = shapes.firstIndex(where: { $0.id == actualShapeId }) else { continue }
            let shape = shapes[shapeIdx]
            let hitPos = simd_float3(hit.worldCoordinates.x, hit.worldCoordinates.y, hit.worldCoordinates.z)
            
            // Check each polygon for vertex/edge/face snap
            for (polyIdx, polygon) in shape.mesh.polygons.enumerated() {
                let verts = polygon.vertices
                
                // 1. Vertex snap (highest priority)
                for (vIdx, v) in verts.enumerated() {
                    let vPos = simd_float3(Float(v.position.x), Float(v.position.y), Float(v.position.z)) + shape.position
                    let dist = simd_distance(hitPos, vPos)
                    if dist < vertexSnapRadius {
                        return [
                            "shapeId": actualShapeId,
                            "snapType": "vertex",
                            "x": vPos.x, "y": vPos.y, "z": vPos.z,
                            "polygonIndex": polyIdx,
                            "vertexIndex": vIdx,
                        ]
                    }
                }
                
                // 2. Edge snap
                for eIdx in 0..<verts.count {
                    let a = simd_float3(Float(verts[eIdx].position.x), Float(verts[eIdx].position.y), Float(verts[eIdx].position.z)) + shape.position
                    let b = simd_float3(Float(verts[(eIdx + 1) % verts.count].position.x), Float(verts[(eIdx + 1) % verts.count].position.y), Float(verts[(eIdx + 1) % verts.count].position.z)) + shape.position
                    
                    let ab = b - a
                    let ap = hitPos - a
                    let abLen = simd_length(ab)
                    guard abLen > 0.001 else { continue }
                    let t = simd_dot(ap, ab) / (abLen * abLen)
                    let tClamped = max(0, min(1, t))
                    let closest = a + ab * tClamped
                    let dist = simd_distance(hitPos, closest)
                    
                    if dist < edgeSnapRadius && tClamped > 0.05 && tClamped < 0.95 {
                        return [
                            "shapeId": actualShapeId,
                            "snapType": "edge",
                            "x": closest.x, "y": closest.y, "z": closest.z,
                            "polygonIndex": polyIdx,
                            "edgeIndex": eIdx,
                            "edgeParam": tClamped,
                        ]
                    }
                }
            }
            
            // 3. Face snap (lowest priority)
            let faceIdx = hit.geometryIndex
            return [
                "shapeId": actualShapeId,
                "snapType": "face",
                "x": hitPos.x, "y": hitPos.y, "z": hitPos.z,
                "polygonIndex": min(faceIdx, max(0, shape.mesh.polygons.count - 1)),
            ]
        }
        return nil
    }
    
    /// Show a highlight sphere at a snap point
    func showSnapHighlight(at position: simd_float3, snapType: MeshSnapType) {
        cutHighlightNode?.removeFromParentNode()
        
        let size: CGFloat = snapType == .vertex ? 0.008 : 0.006
        let color: UIColor = snapType == .vertex ? .green : snapType == .edge ? .yellow : .cyan
        
        let sphere = SCNSphere(radius: size)
        let mat = SCNMaterial()
        mat.diffuse.contents = color
        mat.lightingModel = .constant
        sphere.materials = [mat]
        
        let node = SCNNode(geometry: sphere)
        node.position = SCNVector3(position.x, position.y, position.z)
        node.name = "cut_snap_highlight"
        sceneView?.scene.rootNode.addChildNode(node)
        cutHighlightNode = node
    }
    
    func clearSnapHighlight() {
        cutHighlightNode?.removeFromParentNode()
        cutHighlightNode = nil
    }
    
    /// Apply a cut line between two points on a shape's mesh
    /// This splits any polygon that the cut line crosses into two polygons
    func applyCutLine(shapeId: String, 
                      pointA: [String: Any], 
                      pointB: [String: Any]) -> Bool {
        guard let idx = shapes.firstIndex(where: { $0.id == shapeId }) else { return false }
        
        let posA = Vector(
            Double(pointA["x"] as? Float ?? 0),
            Double(pointA["y"] as? Float ?? 0),
            Double(pointA["z"] as? Float ?? 0)
        ) - Vector(Double(shapes[idx].position.x), Double(shapes[idx].position.y), Double(shapes[idx].position.z))
        
        let posB = Vector(
            Double(pointB["x"] as? Float ?? 0),
            Double(pointB["y"] as? Float ?? 0),
            Double(pointB["z"] as? Float ?? 0)
        ) - Vector(Double(shapes[idx].position.x), Double(shapes[idx].position.y), Double(shapes[idx].position.z))
        
        var newPolygons = shapes[idx].mesh.polygons.map { $0 }
        var didCut = false
        
        // Find polygon(s) that contain both points and split them
        for (polyIdx, polygon) in shapes[idx].mesh.polygons.enumerated().reversed() {
            let verts = polygon.vertices.map { $0.position }
            
            let containsA = isPointNearPolygon(posA, vertices: verts, tolerance: 0.03)
            let containsB = isPointNearPolygon(posB, vertices: verts, tolerance: 0.03)
            
            if containsA && containsB {
                // Both points on this polygon — split it
                if let (poly1, poly2) = splitPolygon(polygon, cutA: posA, cutB: posB) {
                    newPolygons.remove(at: polyIdx)
                    newPolygons.append(poly1)
                    newPolygons.append(poly2)
                    didCut = true
                }
            }
        }
        
        if didCut {
            let newMesh = Mesh(newPolygons)
            rebuildShapeMesh(at: idx, newMesh: newMesh)
        }
        
        clearSnapHighlight()
        return didCut
    }
    
    // MARK: - Cut Helpers
    
    private func isPointNearPolygon(_ point: Vector, vertices: [Vector], tolerance: Double) -> Bool {
        // Check if point is near any vertex
        for v in vertices {
            if (point - v).length < tolerance { return true }
        }
        // Check if point is near any edge
        for i in 0..<vertices.count {
            let a = vertices[i]
            let b = vertices[(i + 1) % vertices.count]
            let ab = b - a
            let ap = point - a
            let abLen = ab.length
            guard abLen > 0.001 else { continue }
            let t = ap.dot(ab) / (abLen * abLen)
            if t >= -0.05 && t <= 1.05 {
                let closest = a + ab * max(0, min(1, t))
                if (point - closest).length < tolerance { return true }
            }
        }
        return false
    }
    
    private func splitPolygon(_ polygon: Polygon, cutA: Vector, cutB: Vector) -> (Polygon, Polygon)? {
        let verts = polygon.vertices
        guard verts.count >= 3 else { return nil }
        
        // Find where cutA and cutB connect to the polygon boundary
        let snapA = snapToPolygonBoundary(cutA, vertices: verts)
        let snapB = snapToPolygonBoundary(cutB, vertices: verts)
        
        guard let sA = snapA, let sB = snapB else { return nil }
        guard sA.insertAfter != sB.insertAfter else { return nil } // can't split same edge
        
        // Build two new vertex lists by going around the polygon
        var group1: [Vertex] = []
        var group2: [Vertex] = []
        var currentGroup = 1
        
        let normal = polygon.plane.normal
        
        for i in 0..<verts.count {
            if currentGroup == 1 {
                group1.append(verts[i])
            } else {
                group2.append(verts[i])
            }
            
            // Check if cut point should be inserted after this vertex
            if i == sA.insertAfter {
                let cutVertex = Vertex(sA.position, normal)
                if currentGroup == 1 {
                    group1.append(cutVertex)
                } else {
                    group2.append(cutVertex)
                }
                // Also add to the other group as the starting point
                let cutVertexB = Vertex(sB.position, normal)
                if currentGroup == 1 {
                    group2.append(cutVertex)
                    currentGroup = 2
                } else {
                    group1.append(cutVertex)
                    currentGroup = 1
                }
            }
            
            if i == sB.insertAfter && currentGroup != 1 {
                let cutVertex = Vertex(sB.position, normal)
                group2.append(cutVertex)
                let cutVertexA2 = Vertex(sA.position, normal)
                group1.append(cutVertex)
                currentGroup = 1
            }
        }
        
        guard group1.count >= 3 && group2.count >= 3 else { return nil }
        
        if let p1 = Polygon(group1, material: polygon.material),
           let p2 = Polygon(group2, material: polygon.material) {
            return (p1, p2)
        }
        return nil
    }
    
    private struct SnapResult {
        let position: Vector
        let insertAfter: Int  // insert after this vertex index
    }
    
    private func snapToPolygonBoundary(_ point: Vector, vertices: [Vertex]) -> SnapResult? {
        // Try vertex snap first
        for (i, v) in vertices.enumerated() {
            if (point - v.position).length < 0.02 {
                return SnapResult(position: v.position, insertAfter: max(0, i - 1))
            }
        }
        
        // Try edge snap
        var bestDist = Double.infinity
        var bestResult: SnapResult?
        
        for i in 0..<vertices.count {
            let a = vertices[i].position
            let b = vertices[(i + 1) % vertices.count].position
            let ab = b - a
            let ap = point - a
            let abLen = ab.length
            guard abLen > 0.001 else { continue }
            let t = ap.dot(ab) / (abLen * abLen)
            let tClamped = max(0.0, min(1.0, t))
            let closest = a + ab * tClamped
            let dist = (point - closest).length
            if dist < bestDist {
                bestDist = dist
                bestResult = SnapResult(position: closest, insertAfter: i)
            }
        }
        
        return bestResult
    }
    
    /// Rebuild a shape's mesh and its SCNNode geometry + wireframe
    private func rebuildShapeMesh(at index: Int, newMesh: Mesh) {
        shapes[index].mesh = newMesh
        
        // Update SCN geometry
        let color = shapes[index].color
        if let newGeo = createSCNGeometry(from: newMesh, color: color) {
            shapes[index].node.geometry = newGeo
        }
        
        // Update wireframe
        if let oldWire = shapes[index].node.childNode(withName: "wire_\(shapes[index].id)", recursively: false) {
            oldWire.removeFromParentNode()
        }
        if let wireGeo = createWireframeGeometry(from: newMesh) {
            let wireNode = SCNNode(geometry: wireGeo)
            wireNode.name = "wire_\(shapes[index].id)"
            shapes[index].node.addChildNode(wireNode)
        }
        
        updateNodeMaterial(for: shapes[index])
    }
    
    // MARK: - Selection
    
    func selectShape(id: String) {
        guard let idx = shapes.firstIndex(where: { $0.id == id }) else { return }
        shapes[idx].isSelected = true
        updateNodeMaterial(for: shapes[idx])
    }
    
    func deselectAll() {
        for i in shapes.indices {
            shapes[i].isSelected = false
            updateNodeMaterial(for: shapes[i])
        }
    }
    
    func toggleSelection(id: String) {
        guard let idx = shapes.firstIndex(where: { $0.id == id }) else { return }
        shapes[idx].isSelected.toggle()
        updateNodeMaterial(for: shapes[idx])
    }
    
    func getSelectedShapes() -> [SketchShape] {
        return shapes.filter { $0.isSelected }
    }
    
    func hitTestSelect(at screenCenter: CGPoint) -> SketchShape? {
        guard let sceneView = sceneView else { return nil }
        let hitResults = sceneView.hitTest(screenCenter, options: [
            .searchMode: SCNHitTestSearchMode.all.rawValue,
            .ignoreHiddenNodes: true
        ])
        
        for hit in hitResults {
            // Walk up node hierarchy to find our shape container
            var node: SCNNode? = hit.node
            while let n = node {
                if let shapeId = n.name, shapeId.hasPrefix("sketch_") {
                    if let idx = shapes.firstIndex(where: { $0.id == String(shapeId.dropFirst(7)) }) {
                        shapes[idx].isSelected.toggle()
                        updateNodeMaterial(for: shapes[idx])
                        return shapes[idx]
                    }
                }
                node = n.parent
            }
        }
        return nil
    }
    
    // MARK: - Transform
    
    func moveShape(id: String, dx: Float, dy: Float, dz: Float) {
        guard let idx = shapes.firstIndex(where: { $0.id == id }) else { return }
        shapes[idx].position.x += dx
        shapes[idx].position.y += dy
        shapes[idx].position.z += dz
        applyTransform(to: &shapes[idx])
    }
    
    func rotateShape(id: String, rx: Float, ry: Float, rz: Float) {
        guard let idx = shapes.firstIndex(where: { $0.id == id }) else { return }
        shapes[idx].rotation.x += rx
        shapes[idx].rotation.y += ry
        shapes[idx].rotation.z += rz
        applyTransform(to: &shapes[idx])
    }
    
    func scaleShape(id: String, sx: Float, sy: Float, sz: Float) {
        guard let idx = shapes.firstIndex(where: { $0.id == id }) else { return }
        shapes[idx].scaleXYZ.x *= sx
        shapes[idx].scaleXYZ.y *= sy
        shapes[idx].scaleXYZ.z *= sz
        applyTransform(to: &shapes[idx])
    }
    
    func setShapePosition(id: String, x: Float, y: Float, z: Float) {
        guard let idx = shapes.firstIndex(where: { $0.id == id }) else { return }
        shapes[idx].position = simd_float3(x, y, z)
        applyTransform(to: &shapes[idx])
    }
    
    // MARK: - Boolean CSG Operations
    
    func booleanSubtract(keepId: String, cutId: String) -> SketchShape? {
        guard let keepIdx = shapes.firstIndex(where: { $0.id == keepId }),
              let cutIdx = shapes.firstIndex(where: { $0.id == cutId }) else {
            print("[SketchCSG] booleanSubtract: shape not found keepId=\(keepId) cutId=\(cutId)")
            return nil
        }
        
        let keepMesh = transformedMesh(shapes[keepIdx])
        let cutMesh = transformedMesh(shapes[cutIdx])
        print("[SketchCSG] subtract: keep=\(keepMesh.polygons.count)polys cut=\(cutMesh.polygons.count)polys")
        
        let resultMesh = keepMesh.subtracting(cutMesh)
        
        guard resultMesh.polygons.count > 0 else {
            print("[SketchCSG] subtract produced empty mesh!")
            return nil
        }
        print("[SketchCSG] subtract result: \(resultMesh.polygons.count) polys")
        
        let keepLabel = shapes[keepIdx].label
        let keepColor = shapes[keepIdx].color
        shapes[keepIdx].node.removeFromParentNode()
        shapes[cutIdx].node.removeFromParentNode()
        let indices = [keepIdx, cutIdx].sorted(by: >)
        for i in indices { shapes.remove(at: i) }
        
        let newId = UUID().uuidString
        guard let scnGeo = createSCNGeometry(from: resultMesh, color: keepColor) else { return nil }
        let node = SCNNode(geometry: scnGeo)
        node.name = "sketch_\(newId)"
        if let wireGeo = createWireframeGeometry(from: resultMesh) {
            let wireNode = SCNNode(geometry: wireGeo)
            wireNode.name = "wire_\(newId)"
            node.addChildNode(wireNode)
        }
        sceneView?.scene.rootNode.addChildNode(node)
        
        let shape = SketchShape(
            id: newId, mesh: resultMesh, node: node,
            label: "\(keepLabel)_subtracted", color: keepColor,
            sourcePoints: [], extrusionHeight: nil, primitiveType: nil
        )
        shapes.append(shape)
        return shape
    }
    
    func booleanUnion(idA: String, idB: String) -> SketchShape? {
        guard let idxA = shapes.firstIndex(where: { $0.id == idA }),
              let idxB = shapes.firstIndex(where: { $0.id == idB }) else {
            print("[SketchCSG] booleanUnion: shape not found")
            return nil
        }
        
        let meshA = transformedMesh(shapes[idxA])
        let meshB = transformedMesh(shapes[idxB])
        print("[SketchCSG] union: A=\(meshA.polygons.count)polys B=\(meshB.polygons.count)polys")
        
        let resultMesh = meshA.union(meshB)
        
        guard resultMesh.polygons.count > 0 else {
            print("[SketchCSG] union produced empty mesh!")
            return nil
        }
        
        let labelA = shapes[idxA].label
        let colorA = shapes[idxA].color
        shapes[idxA].node.removeFromParentNode()
        shapes[idxB].node.removeFromParentNode()
        let indices = [idxA, idxB].sorted(by: >)
        for i in indices { shapes.remove(at: i) }
        
        let newId = UUID().uuidString
        guard let scnGeo = createSCNGeometry(from: resultMesh, color: colorA) else { return nil }
        let node = SCNNode(geometry: scnGeo)
        node.name = "sketch_\(newId)"
        if let wireGeo = createWireframeGeometry(from: resultMesh) {
            let wireNode = SCNNode(geometry: wireGeo)
            wireNode.name = "wire_\(newId)"
            node.addChildNode(wireNode)
        }
        sceneView?.scene.rootNode.addChildNode(node)
        
        let shape = SketchShape(
            id: newId, mesh: resultMesh, node: node,
            label: "\(labelA)_union", color: colorA,
            sourcePoints: [], extrusionHeight: nil, primitiveType: nil
        )
        shapes.append(shape)
        return shape
    }
    
    func booleanIntersect(idA: String, idB: String) -> SketchShape? {
        guard let idxA = shapes.firstIndex(where: { $0.id == idA }),
              let idxB = shapes.firstIndex(where: { $0.id == idB }) else {
            print("[SketchCSG] booleanIntersect: shape not found")
            return nil
        }
        
        let meshA = transformedMesh(shapes[idxA])
        let meshB = transformedMesh(shapes[idxB])
        print("[SketchCSG] intersect: A=\(meshA.polygons.count)polys B=\(meshB.polygons.count)polys")
        
        let resultMesh = meshA.intersection(meshB)
        
        guard resultMesh.polygons.count > 0 else {
            print("[SketchCSG] intersect produced empty mesh — shapes may not overlap!")
            return nil
        }
        
        let labelA = shapes[idxA].label
        let colorA = shapes[idxA].color
        shapes[idxA].node.removeFromParentNode()
        shapes[idxB].node.removeFromParentNode()
        let indices = [idxA, idxB].sorted(by: >)
        for i in indices { shapes.remove(at: i) }
        
        let newId = UUID().uuidString
        guard let scnGeo = createSCNGeometry(from: resultMesh, color: colorA) else { return nil }
        let node = SCNNode(geometry: scnGeo)
        node.name = "sketch_\(newId)"
        if let wireGeo = createWireframeGeometry(from: resultMesh) {
            let wireNode = SCNNode(geometry: wireGeo)
            wireNode.name = "wire_\(newId)"
            node.addChildNode(wireNode)
        }
        sceneView?.scene.rootNode.addChildNode(node)
        
        let shape = SketchShape(
            id: newId, mesh: resultMesh, node: node,
            label: "\(labelA)_intersection", color: colorA,
            sourcePoints: [], extrusionHeight: nil, primitiveType: nil
        )
        shapes.append(shape)
        return shape
    }
    
    // MARK: - Push/Pull (SketchUp-style)
    
    /// Push/Pull: create a box from crosshair face and subtract/add to parent shape
    func pushPull(shapeId: String, facePoints: [[String: Float]], depth: Float) -> SketchShape? {
        guard let shapeIdx = shapes.firstIndex(where: { $0.id == shapeId }) else { return nil }
        guard facePoints.count >= 3 else { return nil }
        
        // Create an extrusion from the face points
        let vectors = facePoints.map { p -> Vector in
            Vector(Double(p["x"] ?? 0), Double(p["y"] ?? 0), Double(p["z"] ?? 0))
        }
        
        // Create extrusion tool from face points
        let pathPoints = vectors.map { PathPoint.point($0) }
        let path = Path(pathPoints)
        let toolMesh = Mesh.extrude(path, depth: Double(abs(depth)))
        
        // Get the parent mesh with transforms
        let parentMesh = transformedMesh(shapes[shapeIdx])
        
        let resultMesh: Mesh
        if depth > 0 {
            // Positive depth = push inward = subtract
            resultMesh = parentMesh.subtracting(toolMesh)
        } else {
            // Negative depth = pull outward = union
            resultMesh = parentMesh.union(toolMesh)
        }
        
        // Replace the shape
        let label = shapes[shapeIdx].label
        let color = shapes[shapeIdx].color
        shapes[shapeIdx].node.removeFromParentNode()
        
        let newId = UUID().uuidString
        guard let scnGeo = createSCNGeometry(from: resultMesh, color: color) else { return nil }
        let node = SCNNode(geometry: scnGeo)
        node.name = "sketch_\(newId)"
        sceneView?.scene.rootNode.addChildNode(node)
        
        shapes[shapeIdx] = SketchShape(
            id: newId, mesh: resultMesh, node: node,
            label: "\(label)_pushed", color: color,
            sourcePoints: [], extrusionHeight: nil, primitiveType: nil
        )
        return shapes[shapeIdx]
    }
    
    // MARK: - Delete
    
    func deleteShape(id: String) -> Bool {
        guard let idx = shapes.firstIndex(where: { $0.id == id }) else { return false }
        shapes[idx].node.removeFromParentNode()
        shapes.remove(at: idx)
        return true
    }
    
    func deleteSelected() -> Int {
        let selected = shapes.filter { $0.isSelected }
        for s in selected {
            s.node.removeFromParentNode()
        }
        shapes.removeAll { $0.isSelected }
        return selected.count
    }
    
    // MARK: - Serialization
    
    func exportShapes() -> [[String: Any]] {
        return shapes.map { shape -> [String: Any] in
            var data: [String: Any] = [
                "id": shape.id,
                "label": shape.label,
                "position": ["x": shape.position.x, "y": shape.position.y, "z": shape.position.z],
                "rotation": ["x": shape.rotation.x, "y": shape.rotation.y, "z": shape.rotation.z],
                "scale": ["x": shape.scaleXYZ.x, "y": shape.scaleXYZ.y, "z": shape.scaleXYZ.z],
                "sourcePoints": shape.sourcePoints,
                "polygonCount": shape.mesh.polygons.count,
            ]
            if let pt = shape.primitiveType { data["primitiveType"] = pt }
            if let eh = shape.extrusionHeight { data["extrusionHeight"] = eh }
            return data
        }
    }
    
    func shapeToDict(_ shape: SketchShape) -> [String: Any] {
        var data: [String: Any] = [
            "id": shape.id,
            "label": shape.label,
            "polygonCount": shape.mesh.polygons.count,
        ]
        if let pt = shape.primitiveType { data["primitiveType"] = pt }
        if let eh = shape.extrusionHeight { data["extrusionHeight"] = eh }
        return data
    }
    
    // MARK: - Private Helpers
    
    private func addShapeFromMesh(
        _ mesh: Mesh,
        at position: simd_float3,
        label: String,
        primitiveType: String?,
        sourcePoints: [[String: Float]] = [],
        extrusionHeight: Float? = nil
    ) -> SketchShape? {
        let color = shapeColors[shapes.count % shapeColors.count]
        guard let scnGeo = createSCNGeometry(from: mesh, color: color) else { return nil }
        
        let newId = UUID().uuidString
        let node = SCNNode(geometry: scnGeo)
        node.name = "sketch_\(newId)"
        node.position = SCNVector3(position.x, position.y, position.z)
        
        // Add wireframe edge overlay
        if let wireGeo = createWireframeGeometry(from: mesh) {
            let wireNode = SCNNode(geometry: wireGeo)
            wireNode.name = "wire_\(newId)"
            node.addChildNode(wireNode)
        }
        
        sceneView?.scene.rootNode.addChildNode(node)
        
        let shape = SketchShape(
            id: newId, mesh: mesh, node: node,
            label: label, color: color,
            sourcePoints: sourcePoints, extrusionHeight: extrusionHeight,
            primitiveType: primitiveType,
            position: position
        )
        shapes.append(shape)
        return shape
    }
    
    private func createSCNGeometry(from mesh: Mesh, color: UIColor) -> SCNGeometry? {
        let mat = SCNMaterial()
        mat.diffuse.contents = color
        mat.emission.contents = UIColor.black
        mat.isDoubleSided = true
        mat.transparency = 0.5
        mat.blendMode = .alpha
        mat.lightingModel = .physicallyBased
        
        let geometry = SCNGeometry(mesh)
        geometry.materials = [mat]
        return geometry
    }
    
    private func createWireframeGeometry(from mesh: Mesh) -> SCNGeometry? {
        // Extract unique edges from all polygons
        struct Edge: Hashable {
            let a: Int
            let b: Int
            init(_ a: Int, _ b: Int) {
                self.a = min(a, b)
                self.b = max(a, b)
            }
        }
        
        var allVertices: [SCNVector3] = []
        var vertexMap: [String: Int] = [:]
        var edges = Set<Edge>()
        
        for polygon in mesh.polygons {
            let verts = polygon.vertices
            var indices: [Int] = []
            for v in verts {
                let key = "\(String(format: "%.6f", v.position.x)),\(String(format: "%.6f", v.position.y)),\(String(format: "%.6f", v.position.z))"
                if let idx = vertexMap[key] {
                    indices.append(idx)
                } else {
                    let idx = allVertices.count
                    allVertices.append(SCNVector3(Float(v.position.x), Float(v.position.y), Float(v.position.z)))
                    vertexMap[key] = idx
                    indices.append(idx)
                }
            }
            // Create edges for this polygon
            for i in 0..<indices.count {
                let a = indices[i]
                let b = indices[(i + 1) % indices.count]
                edges.insert(Edge(a, b))
            }
        }
        
        guard !edges.isEmpty else { return nil }
        
        // Build line geometry
        var lineIndices: [UInt32] = []
        for edge in edges {
            lineIndices.append(UInt32(edge.a))
            lineIndices.append(UInt32(edge.b))
        }
        
        let vertexSource = SCNGeometrySource(vertices: allVertices)
        let indexData = Data(bytes: &lineIndices, count: lineIndices.count * MemoryLayout<UInt32>.size)
        let element = SCNGeometryElement(data: indexData, primitiveType: .line,
                                          primitiveCount: edges.count,
                                          bytesPerIndex: MemoryLayout<UInt32>.size)
        
        let wireGeo = SCNGeometry(sources: [vertexSource], elements: [element])
        let wireMat = SCNMaterial()
        wireMat.diffuse.contents = UIColor.white.withAlphaComponent(0.6)
        wireMat.isDoubleSided = true
        wireMat.lightingModel = .constant
        wireGeo.materials = [wireMat]
        return wireGeo
    }
    
    private func updateNodeMaterial(for shape: SketchShape) {
        guard let geo = shape.node.geometry else { return }
        for mat in geo.materials {
            mat.emission.contents = shape.isSelected ? selectedEmission : defaultEmission
            // Add wireframe-like border when selected
            if shape.isSelected {
                mat.transparency = 0.7
            } else {
                mat.transparency = 0.5
            }
        }
    }
    
    private func applyTransform(to shape: inout SketchShape) {
        shape.node.position = SCNVector3(shape.position.x, shape.position.y, shape.position.z)
        shape.node.eulerAngles = SCNVector3(shape.rotation.x, shape.rotation.y, shape.rotation.z)
        shape.node.scale = SCNVector3(shape.scaleXYZ.x, shape.scaleXYZ.y, shape.scaleXYZ.z)
    }
    
    /// Get mesh with current transform baked in (for CSG operations)
    private func transformedMesh(_ shape: SketchShape) -> Mesh {
        let transform = Transform(
            offset: Vector(Double(shape.position.x), Double(shape.position.y), Double(shape.position.z)),
            rotation: Rotation(
                roll: Angle(radians: Double(shape.rotation.z)),
                yaw: Angle(radians: Double(shape.rotation.y)),
                pitch: Angle(radians: Double(shape.rotation.x))
            ),
            scale: Vector(Double(shape.scaleXYZ.x), Double(shape.scaleXYZ.y), Double(shape.scaleXYZ.z))
        )
        return shape.mesh.transformed(by: transform)
    }
}
