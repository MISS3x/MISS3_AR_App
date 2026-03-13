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
      if !self.reconstructionEnabled {
        let _ = self.enableSceneReconstruction()
      }
      return self.extractMeshSlice(atHeight: Float(cutHeight))
    }

    // Check if LiDAR is available on this device
    Function("isLidarAvailable") { () -> Bool in
      if #available(iOS 13.4, *) {
        return ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
      }
      return false
    }

    // Get ALL mesh vertices as [x, y, z] arrays
    AsyncFunction("getMeshVertices") { (maxPoints: Int) -> [[Double]] in
      if !self.reconstructionEnabled {
        let _ = self.enableSceneReconstruction()
      }
      return self.extractMeshVertices(maxPoints: maxPoints)
    }

    // Debug: return info about AR session and view hierarchy for troubleshooting
    AsyncFunction("getDebugInfo") { () -> [String: Any] in
      return self.collectDebugInfo()
    }
  }

  private var reconstructionEnabled = false
  private var cachedSession: ARSession? = nil

  /// Enable scene reconstruction on ViroReact's ARSession
  private func enableSceneReconstruction() -> Bool {
    guard let session = findARSession() else {
      return false
    }

    // Get current config or create new one
    if let currentConfig = session.configuration as? ARWorldTrackingConfiguration {
      // Try enabling mesh reconstruction regardless of supportsSceneReconstruction check
      if #available(iOS 13.4, *) {
        currentConfig.sceneReconstruction = .mesh
      }
      currentConfig.planeDetection = [.horizontal, .vertical]
      session.run(currentConfig)
      reconstructionEnabled = true
      return true
    }

    // If no existing config, create a new one
    let config = ARWorldTrackingConfiguration()
    if #available(iOS 13.4, *) {
      config.sceneReconstruction = .mesh
    }
    config.planeDetection = [.horizontal, .vertical]
    session.run(config)
    reconstructionEnabled = true
    return true
  }

  /// Find the active ARSession - searches broadly for any ARSCNView in the view hierarchy
  private func findARSession() -> ARSession? {
    // Return cached session if still valid
    if let cached = cachedSession, cached.currentFrame != nil {
      return cached
    }

    // Search through all connected scenes and windows
    var arView: ARSCNView? = nil

    if let windowScene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
      for window in windowScene.windows {
        if let found = findARSCNViewRecursive(in: window) {
          arView = found
          break
        }
      }
    }

    // Fallback: try ALL scenes
    if arView == nil {
      for scene in UIApplication.shared.connectedScenes {
        if let windowScene = scene as? UIWindowScene {
          for window in windowScene.windows {
            if let found = findARSCNViewRecursive(in: window) {
              arView = found
              break
            }
          }
        }
        if arView != nil { break }
      }
    }

    if let session = arView?.session {
      cachedSession = session
      return session
    }
    return nil
  }

  private func findARSCNViewRecursive(in view: UIView) -> ARSCNView? {
    // Check if this view IS an ARSCNView (or subclass like ViroReact's VRTARSceneView)
    if let arView = view as? ARSCNView {
      return arView
    }
    // Recurse into all subviews
    for subview in view.subviews {
      if let found = findARSCNViewRecursive(in: subview) {
        return found
      }
    }
    return nil
  }

  /// Collect debug info about AR session state
  private func collectDebugInfo() -> [String: Any] {
    var info: [String: Any] = [:]

    // Check device capability
    if #available(iOS 13.4, *) {
      info["supportsSceneReconstruction"] = ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
    } else {
      info["supportsSceneReconstruction"] = false
      info["iosVersionTooOld"] = true
    }

    info["reconstructionEnabled"] = reconstructionEnabled

    // Try to find AR session
    let session = findARSession()
    info["sessionFound"] = session != nil

    if let session = session {
      info["hasCurrentFrame"] = session.currentFrame != nil

      if let frame = session.currentFrame {
        let totalAnchors = frame.anchors.count
        let meshAnchors = frame.anchors.filter { $0 is ARMeshAnchor }.count
        let planeAnchors = frame.anchors.filter { $0 is ARPlaneAnchor }.count
        info["totalAnchors"] = totalAnchors
        info["meshAnchors"] = meshAnchors
        info["planeAnchors"] = planeAnchors

        // Count total mesh vertices
        var totalVerts = 0
        for anchor in frame.anchors {
          if let mesh = anchor as? ARMeshAnchor {
            totalVerts += mesh.geometry.vertices.count
          }
        }
        info["totalMeshVertices"] = totalVerts
      }

      // Check config
      if let config = session.configuration as? ARWorldTrackingConfiguration {
        info["configType"] = "ARWorldTracking"
        if #available(iOS 13.4, *) {
          info["sceneReconstructionRaw"] = config.sceneReconstruction.rawValue
          info["meshEnabled"] = config.sceneReconstruction.contains(.mesh)
        }
        info["planeDetection"] = config.planeDetection.rawValue
      } else {
        info["configType"] = String(describing: type(of: session.configuration))
      }
    }

    // Count ARSCNViews found
    var viewCount = 0
    if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
      for window in windowScene.windows {
        viewCount += countARViews(in: window)
      }
    }
    info["arSCNViewsFound"] = viewCount

    return info
  }

  private func countARViews(in view: UIView) -> Int {
    var count = view is ARSCNView ? 1 : 0
    for subview in view.subviews {
      count += countARViews(in: subview)
    }
    return count
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
        let i0 = Int(indexBuffer.load(fromByteOffset: f * faces.bytesPerIndex * faces.indexCountPerPrimitive + 0 * faces.bytesPerIndex, as: UInt32.self))
        let i1 = Int(indexBuffer.load(fromByteOffset: f * faces.bytesPerIndex * faces.indexCountPerPrimitive + 1 * faces.bytesPerIndex, as: UInt32.self))
        let i2 = Int(indexBuffer.load(fromByteOffset: f * faces.bytesPerIndex * faces.indexCountPerPrimitive + 2 * faces.bytesPerIndex, as: UInt32.self))

        guard i0 < worldVertices.count, i1 < worldVertices.count, i2 < worldVertices.count else { continue }

        let v0 = worldVertices[i0]
        let v1 = worldVertices[i1]
        let v2 = worldVertices[i2]

        let edges: [(SIMD3<Float>, SIMD3<Float>)] = [(v0, v1), (v1, v2), (v2, v0)]

        for (a, b) in edges {
          if (a.y - cutHeight) * (b.y - cutHeight) < 0 {
            let t = (cutHeight - a.y) / (b.y - a.y)
            let ix = a.x + t * (b.x - a.x)
            let iz = a.z + t * (b.z - a.z)

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
