import ExpoModulesCore
import ARKit

public class LidarMeshModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LidarMesh")

    // Test function to verify module loaded
    Function("hello") {
      return "LidarMesh module loaded OK"
    }

    // Check LiDAR hardware
    Function("isLidarAvailable") { () -> Bool in
      if #available(iOS 13.4, *) {
        return ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
      }
      return false
    }

    // Enable ARKit scene reconstruction on ViroReact's session
    AsyncFunction("enableSceneReconstruction") { () -> [String: Any] in
      return self.runOnMain { self.doEnableSceneReconstruction() }
    }

    // Get mesh wireframe from ARMeshAnchors
    AsyncFunction("getMeshWireframe") { (maxVertices: Int) -> [String: Any] in
      return self.runOnMain { self.doGetMeshWireframe(maxVertices: maxVertices) }
    }
  }

  private var cachedSession: ARSession? = nil

  // Run block on main thread, return result
  private func runOnMain<T>(_ block: @escaping () -> T) -> T {
    if Thread.isMainThread { return block() }
    var result: T!
    DispatchQueue.main.sync { result = block() }
    return result
  }

  // Find ViroReact's ARSession by traversing view hierarchy
  private func findARSession() -> ARSession? {
    if let cached = cachedSession, cached.currentFrame != nil {
      return cached
    }
    for scene in UIApplication.shared.connectedScenes {
      guard let ws = scene as? UIWindowScene else { continue }
      for window in ws.windows {
        if let arView = findARSCNView(in: window) {
          cachedSession = arView.session
          return arView.session
        }
      }
    }
    return nil
  }

  private func findARSCNView(in view: UIView) -> ARSCNView? {
    if let arView = view as? ARSCNView { return arView }
    for sub in view.subviews {
      if let found = findARSCNView(in: sub) { return found }
    }
    return nil
  }

  // Enable scene reconstruction mesh on the AR session
  private func doEnableSceneReconstruction() -> [String: Any] {
    var info: [String: Any] = ["isMainThread": Thread.isMainThread]

    guard let session = findARSession() else {
      info["error"] = "No ARSession found"
      info["sessionFound"] = false
      var viewCount = 0
      for scene in UIApplication.shared.connectedScenes {
        if let ws = scene as? UIWindowScene {
          for window in ws.windows { viewCount += countARViews(in: window) }
        }
      }
      info["arSCNViewCount"] = viewCount
      return info
    }

    info["sessionFound"] = true

    if #available(iOS 13.4, *) {
      let supports = ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
      info["supportsMesh"] = supports

      if supports {
        let config = ARWorldTrackingConfiguration()
        config.sceneReconstruction = .mesh
        config.planeDetection = [.horizontal, .vertical]
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
          config.frameSemantics.insert(.sceneDepth)
        }
        session.run(config, options: [])
        info["meshEnabled"] = true
      } else {
        info["meshEnabled"] = false
      }
    } else {
      info["supportsMesh"] = false
      info["meshEnabled"] = false
    }

    return info
  }

  // Get wireframe data from ARMeshAnchors
  private func doGetMeshWireframe(maxVertices: Int) -> [String: Any] {
    guard let session = findARSession(), let frame = session.currentFrame else {
      return ["vertices": [] as [[Double]], "edges": [] as [[Int]], "anchors": 0]
    }

    var allVertices: [[Double]] = []
    var allEdges: [[Int]] = []
    var anchorCount = 0
    var vertexOffset = 0

    for anchor in frame.anchors {
      guard let meshAnchor = anchor as? ARMeshAnchor else { continue }
      anchorCount += 1

      let geo = meshAnchor.geometry
      let transform = meshAnchor.transform
      let vCount = geo.vertices.count
      let fCount = geo.faces.count

      for i in 0..<vCount {
        if allVertices.count >= maxVertices { break }
        let v = geo.vertices[i]
        let local = SIMD4<Float>(v[0], v[1], v[2], 1.0)
        let world = transform * local
        allVertices.append([Double(world.x), Double(world.y), Double(world.z)])
      }

      let addedVerts = min(vCount, maxVertices - vertexOffset)
      if addedVerts <= 0 { break }

      let indexBuf = geo.faces.buffer.contents()
      let bpi = geo.faces.bytesPerIndex

      for f in 0..<fCount {
        let base = f * 3 * bpi
        let i0: Int, i1: Int, i2: Int
        if bpi == 4 {
          i0 = Int(indexBuf.load(fromByteOffset: base, as: UInt32.self))
          i1 = Int(indexBuf.load(fromByteOffset: base + 4, as: UInt32.self))
          i2 = Int(indexBuf.load(fromByteOffset: base + 8, as: UInt32.self))
        } else {
          i0 = Int(indexBuf.load(fromByteOffset: base, as: UInt16.self))
          i1 = Int(indexBuf.load(fromByteOffset: base + 2, as: UInt16.self))
          i2 = Int(indexBuf.load(fromByteOffset: base + 4, as: UInt16.self))
        }
        if i0 < addedVerts && i1 < addedVerts {
          allEdges.append([i0 + vertexOffset, i1 + vertexOffset])
        }
        if i1 < addedVerts && i2 < addedVerts {
          allEdges.append([i1 + vertexOffset, i2 + vertexOffset])
        }
        if i2 < addedVerts && i0 < addedVerts {
          allEdges.append([i2 + vertexOffset, i0 + vertexOffset])
        }
      }

      vertexOffset += addedVerts
      if allVertices.count >= maxVertices { break }
    }

    return [
      "vertices": allVertices,
      "edges": allEdges,
      "anchors": anchorCount,
      "totalVertices": allVertices.count,
      "totalEdges": allEdges.count
    ]
  }

  private func countARViews(in view: UIView) -> Int {
    var c = view is ARSCNView ? 1 : 0
    for s in view.subviews { c += countARViews(in: s) }
    return c
  }
}
