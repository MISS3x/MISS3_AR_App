import ExpoModulesCore
import ARKit

fileprivate var globalARSession: ARSession?

extension ARSession {
    @objc dynamic func swizzled_setDelegate(_ delegate: ARSessionDelegate?) {
        globalARSession = self
        self.swizzled_setDelegate(delegate)
    }
    
    @objc dynamic func swizzled_run(with configuration: ARConfiguration, options: ARSession.RunOptions) {
        globalARSession = self
        self.swizzled_run(with: configuration, options: options)
    }
}

fileprivate let performSwizzle: Void = {
    let setDelegateSelector = NSSelectorFromString("setDelegate:")
    if let originalDel = class_getInstanceMethod(ARSession.self, setDelegateSelector),
       let swizzledDel = class_getInstanceMethod(ARSession.self, #selector(ARSession.swizzled_setDelegate(_:))) {
        method_exchangeImplementations(originalDel, swizzledDel)
    }
    
    let runSelector = NSSelectorFromString("runWithConfiguration:options:")
    if let originalRun = class_getInstanceMethod(ARSession.self, runSelector),
       let swizzledRun = class_getInstanceMethod(ARSession.self, #selector(ARSession.swizzled_run(with:options:))) {
        method_exchangeImplementations(originalRun, swizzledRun)
    }
}()

// Run swizzling once when the class is loaded
fileprivate let swizzleLoader: () = {
    _ = performSwizzle
}()

public class LidarMeshModule: Module {
  
  public required init(appContext: AppContext) {
    _ = swizzleLoader
    super.init(appContext: appContext)
  }

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

  // Run block on main thread, return result
  private func runOnMain<T>(_ block: @escaping () -> T) -> T {
    if Thread.isMainThread { return block() }
    var result: T!
    DispatchQueue.main.sync { result = block() }
    return result
  }

  // Get the swizzled global ARSession
  private func findARSession() -> ARSession? {
    return globalARSession
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
        let vertexPointer = geo.vertices.buffer.contents().advanced(by: geo.vertices.offset + geo.vertices.stride * i)
        let vx = vertexPointer.assumingMemoryBound(to: Float.self)
        let local = SIMD4<Float>(vx[0], vx[1], vx[2], 1.0)
        let world = transform * local
        allVertices.append([Double(world.x), Double(world.y), Double(world.z)])
      }

      let addedVerts = min(vCount, maxVertices - vertexOffset)
      if addedVerts <= 0 { break }

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
