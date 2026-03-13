import ExpoModulesCore
import ARKit

public class LidarMeshModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LidarMesh")

    // Enable scene reconstruction on the active ARSession
    AsyncFunction("enableSceneReconstruction") { () -> Bool in
      return self.enableSceneReconstruction()
    }

    // Get mesh slice at a given Y height
    AsyncFunction("getMeshSlice") { (cutHeight: Double) -> [[Double]] in
      // Auto-enable on first call
      if !self.reconstructionEnabled {
        let _ = self.enableSceneReconstruction()
      }
      return self.extractMeshSlice(atHeight: Float(cutHeight))
    }

    // Check if LiDAR is available on this device
    Function("isLidarAvailable") { () -> Bool in
      return ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
    }

    // Get ALL mesh vertices as [x, y, z] arrays
    AsyncFunction("getMeshVertices") { (maxPoints: Int) -> [[Double]] in
      if !self.reconstructionEnabled {
        let _ = self.enableSceneReconstruction()
      }
      return self.extractMeshVertices(maxPoints: maxPoints)
    }
  }

  private var reconstructionEnabled = false

  /// Enable scene reconstruction on ViroReact's ARSession
  private func enableSceneReconstruction() -> Bool {
    guard ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) else {
      return false
    }
    guard let session = findARSession() else {
      return false
    }

    // Get current config or create new one
    if let currentConfig = session.configuration as? ARWorldTrackingConfiguration {
      currentConfig.sceneReconstruction = .mesh
      session.run(currentConfig)
      reconstructionEnabled = true
      return true
    }

    return false
  }

  /// Find the active ARSession from ViroReact
  private func findARSession() -> ARSession? {
    // ViroReact stores its ARSession on the main view hierarchy
    // We search for ARSCNView (SceneKit AR view) which holds the session
    guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
          let window = windowScene.windows.first else {
      return nil
    }
    return findARSCNView(in: window)?.session
  }

  private func findARSCNView(in view: UIView) -> ARSCNView? {
    if let arView = view as? ARSCNView {
      return arView
    }
    for subview in view.subviews {
      if let found = findARSCNView(in: subview) {
        return found
      }
    }
    return nil
  }

  /// Extract contour points where the LiDAR mesh intersects a horizontal plane at Y = cutHeight
  private func extractMeshSlice(atHeight cutHeight: Float) -> [[Double]] {
    guard let session = findARSession(),
          let frame = session.currentFrame else {
      return []
    }

    var contourPoints: [[Double]] = []
    let snapGrid: Float = 0.05 // 5cm snap grid
    var seenKeys = Set<String>()

    for anchor in frame.anchors {
      guard let meshAnchor = anchor as? ARMeshAnchor else { continue }

      let geometry = meshAnchor.geometry
      let vertices = geometry.vertices
      let faces = geometry.faces
      let transform = meshAnchor.transform

      // Get vertex positions in world space
      let vertexCount = vertices.count
      var worldVertices = [SIMD3<Float>]()
      worldVertices.reserveCapacity(vertexCount)

      for i in 0..<vertexCount {
        let localPos = vertices[i]
        let localVec = SIMD4<Float>(localPos[0], localPos[1], localPos[2], 1.0)
        let worldVec = transform * localVec
        worldVertices.append(SIMD3<Float>(worldVec.x, worldVec.y, worldVec.z))
      }

      // For each triangle face, check if it intersects the Y = cutHeight plane
      let faceCount = faces.count
      let indexBuffer = faces.buffer.contents()

      for f in 0..<faceCount {
        // Each face has 3 indices (triangles)
        let i0 = Int(indexBuffer.load(fromByteOffset: f * faces.bytesPerIndex * faces.indexCountPerPrimitive + 0 * faces.bytesPerIndex, as: UInt32.self))
        let i1 = Int(indexBuffer.load(fromByteOffset: f * faces.bytesPerIndex * faces.indexCountPerPrimitive + 1 * faces.bytesPerIndex, as: UInt32.self))
        let i2 = Int(indexBuffer.load(fromByteOffset: f * faces.bytesPerIndex * faces.indexCountPerPrimitive + 2 * faces.bytesPerIndex, as: UInt32.self))

        guard i0 < worldVertices.count, i1 < worldVertices.count, i2 < worldVertices.count else { continue }

        let v0 = worldVertices[i0]
        let v1 = worldVertices[i1]
        let v2 = worldVertices[i2]

        // Find intersection points of triangle edges with Y = cutHeight
        let edges: [(SIMD3<Float>, SIMD3<Float>)] = [(v0, v1), (v1, v2), (v2, v0)]

        for (a, b) in edges {
          // Check if edge crosses the cut plane
          if (a.y - cutHeight) * (b.y - cutHeight) < 0 {
            // Linear interpolation to find intersection point
            let t = (cutHeight - a.y) / (b.y - a.y)
            let ix = a.x + t * (b.x - a.x)
            let iz = a.z + t * (b.z - a.z)

            // Snap to grid for deduplication
            let sx = round(ix / snapGrid) * snapGrid
            let sz = round(iz / snapGrid) * snapGrid
            let key = String(format: "%.2f,%.2f", sx, sz)

            if !seenKeys.contains(key) {
              seenKeys.insert(key)
              contourPoints.append([Double(sx), Double(sz)])
            }
          }
        }
      }
    }

    return contourPoints
  }

  /// Extract ALL mesh vertices as [x, y, z] world-coordinate arrays
  private func extractMeshVertices(maxPoints: Int) -> [[Double]] {
    guard let session = findARSession(),
          let frame = session.currentFrame else {
      return []
    }

    var points: [[Double]] = []
    let stride = max(1, 5) // subsample every 5th vertex for performance

    for anchor in frame.anchors {
      guard let meshAnchor = anchor as? ARMeshAnchor else { continue }

      let vertices = meshAnchor.geometry.vertices
      let transform = meshAnchor.transform
      let vertexCount = vertices.count

      for i in Swift.stride(from: 0, to: vertexCount, by: stride) {
        let localPos = vertices[i]
        let localVec = SIMD4<Float>(localPos[0], localPos[1], localPos[2], 1.0)
        let worldVec = transform * localVec
        points.append([Double(worldVec.x), Double(worldVec.y), Double(worldVec.z)])

        if points.count >= maxPoints { return points }
      }
    }

    return points
  }
}
