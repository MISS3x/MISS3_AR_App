import ExpoModulesCore
import ARKit
import SceneKit
import UIKit
import Metal

#if canImport(RoomPlan)
import RoomPlan
#endif

class ARRulerNativeView: ExpoView, ARSCNViewDelegate, ARSessionDelegate {
  let arView = ARSCNView(frame: .zero)
  let onUpdate = EventDispatcher()
  let onPlaneStateChange = EventDispatcher()

  // State
  enum DrawingMode: String {
    case floor = "floor"
    case free = "free"
    case wall = "wall"
  }
  public var drawingMode: DrawingMode = .floor
  public var isWallMode: Bool { drawingMode == .wall }
  private var meshUIColor: UIColor = UIColor(red: 0.0, green: 1.0, blue: 0.4, alpha: 1.0) // Matrix green
  private var scannerLightNode: SCNLight?
  public var showVisualGuides: Bool = true
  
  // Tron Blue for floor mode
  private let tronBlue = UIColor(red: 0.2, green: 0.8, blue: 1.0, alpha: 1.0)
  private let measureYellow = UIColor(red: 1.0, green: 0.85, blue: 0.0, alpha: 1.0)
  private let freeOrange = UIColor(red: 1.0, green: 0.6, blue: 0.0, alpha: 1.0)
  private let wallPink = UIColor(red: 1.0, green: 0.3, blue: 0.6, alpha: 1.0)
  
  // Configurable cursor params (adjustable from JS without rebuild)
  public var cursorAxisLength: Float = 0.03
  public var cursorAxisWidth: Float = 0.001
  public var cursorMinScale: Float = 0.4
  public var cursorMaxScale: Float = 2.0
  
  // Snapping
  private let snapRadius: Float = 0.05 // 5cm snap radius
  private var allPlacedPoints: [SCNVector3] = []
  
  // Auto-edge detection
  private var detectedEdgeNodes: [SCNNode] = []
  private var detectedEdgePolylines: [[[String: Float]]] = []
  
  // Cut Room
  private var cutPlaneNode: SCNNode?
  private var cutActive: Bool = false
  private var cutType: String = "horizontal" // "horizontal" or "vertical"
  private var cutPlaneHeight: Float = 0      // Y for horizontal, world pos for vertical
  private var cutPlaneRotation: Float = 0    // Z rotation for vertical cuts (radians)
  private var cutPolylineNodes: [SCNNode] = []
  private var cutResultPolyline: [[String: Float]] = []
  
  // Auto-detected floor & ceiling
  private var floorY: Float? = nil
  private var ceilingY: Float? = nil
  
  // Polygon drawing
  private var currentPolygon: [SCNVector3] = []
  private var closedShapes: [[String: Any]] = []
  
  // Freehand Tool Mode
  private var isFreehandActive = false
  private var currentFreehandThickness: Float = 0.05
  private var currentFreehandColor: UIColor = .white
  private var freehandPoints: [SCNVector3] = []
  private var freehandLineNodes: [SCNNode] = []
  
  // Camera Trajectory
  private var cameraTrajectory: [[String: Float]] = []
  private var lastTrajectoryTime: TimeInterval = 0
  
  // Auto-Photo Grid
  var autoPhotoEnabled: Bool = false
  private var autoPhotoGridSpacing: Float = 1.0  // meters
  private var lastAutoPhotoPosition: SCNVector3?
  private var autoPhotoPaths: [[String: Any]] = []  // [{uri, transform, position}]
  private var autoPhotoMarkerNodes: [SCNNode] = []

  // RoomPlan (iOS 16+)
  private var roomPlanController: Any?

  // Scene Nodes
  private var pointNodes: [SCNNode] = []
  private var lineNodes: [SCNNode] = []
  private var labels: [SCNNode] = []
  private var remoteObjectNodes: [SCNNode] = []
  var sceneAnchors: [[String: Any]] = []  // Named anchors for multi-session alignment
  var sceneAnchorNodes: [SCNNode] = []     // Visual markers for anchors
  
  // Ghost preview line (from last point to cursor)
  private var ghostLineNode: SCNNode?
  private var ghostDistLabel: SCNNode?
  
  private var pointerNode: SCNNode?
  private var distanceLabel: SCNNode?
  private var axisNodes: [SCNNode] = [] // X, Y, Z axis lines

  // Shape preview (real-time wireframe while drawing)
  private var previewNode: SCNNode?
  private var previewType: String? = nil
  private var previewPoints: [SCNVector3] = []

  // Sketch 3D Shape Manager (CSG)
  private lazy var sketchManager: SketchShapeManager = SketchShapeManager(sceneView: arView)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    addSubview(arView)
    
    arView.delegate = self
    arView.session.delegate = self
    arView.autoenablesDefaultLighting = false
    
    let ambient = SCNLight()
    ambient.type = .ambient
    ambient.color = UIColor.white
    ambient.categoryBitMask = 1
    let ambNode = SCNNode()
    ambNode.light = ambient
    arView.scene.rootNode.addChildNode(ambNode)
    
    if #available(iOS 16.0, *) {
        let rpc = RoomPlanController()
        rpc.sceneView = arView
        self.roomPlanController = rpc
    }
    
    setupPointer()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    arView.frame = bounds
  }

  override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    if newWindow != nil {
      let config = ARWorldTrackingConfiguration()
      config.planeDetection = [.horizontal, .vertical]
      if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
        config.sceneReconstruction = .mesh
      }
      arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
      // RoomPlan NOT auto-started here — user controls via START SCAN button
    } else {
      arView.session.pause()
      // Stop RoomPlan if running
      if #available(iOS 16.0, *) {
          if let rpc = roomPlanController as? RoomPlanController {
              rpc.stop()
          }
      }
    }
  }

  private func setupPointer() {
    let focusNode = SCNNode()

    // 3-axis cursor lines: X=Red, Y=Green, Z=Blue
    let axisColors: [UIColor] = [.red, .green, .blue]
    let len = CGFloat(cursorAxisLength)
    let w = CGFloat(cursorAxisWidth)
    axisNodes.removeAll()
    
    for i in 0..<3 {
      let boxW: CGFloat = i == 0 ? len : w
      let boxH: CGFloat = i == 1 ? len : w
      let boxL: CGFloat = i == 2 ? len : w
      let box = SCNBox(width: boxW, height: boxH, length: boxL, chamferRadius: 0)
      box.firstMaterial?.diffuse.contents = axisColors[i]
      box.firstMaterial?.lightingModel = .constant
      box.firstMaterial?.readsFromDepthBuffer = false
      let axisNode = SCNNode(geometry: box)
      axisNode.renderingOrder = 200
      focusNode.addChildNode(axisNode)
      axisNodes.append(axisNode)
    }

    // Distance Label — constant size billboard
    let textGeo = SCNText(string: "0.00m", extrusionDepth: 0.0)
    textGeo.font = UIFont.systemFont(ofSize: 5)
    textGeo.firstMaterial?.diffuse.contents = UIColor.white
    textGeo.firstMaterial?.isDoubleSided = true
    textGeo.firstMaterial?.readsFromDepthBuffer = false
    textGeo.firstMaterial?.lightingModel = .constant
    let textNode = SCNNode(geometry: textGeo)
    textNode.scale = SCNVector3(0.005, 0.005, 0.005)
    textNode.renderingOrder = 200
    let billboard = SCNBillboardConstraint()
    billboard.freeAxes = .all
    textNode.constraints = [billboard]
    textNode.position = SCNVector3(0.04, 0.02, 0)
    focusNode.addChildNode(textNode)
    self.distanceLabel = textNode
    
    // LiDAR Scanner Light — MATRIX X-RAY STYLE
    let scannerLight = SCNLight()
    scannerLight.type = .omni
    scannerLight.color = meshUIColor
    scannerLight.intensity = 2000
    scannerLight.attenuationStartDistance = 0.0
    scannerLight.attenuationEndDistance = 3.0
    scannerLight.attenuationFalloffExponent = 1.5
    scannerLight.categoryBitMask = 2
    self.scannerLightNode = scannerLight
    
    let lightNode = SCNNode()
    lightNode.position = SCNVector3(0, 0, 0)
    lightNode.light = scannerLight
    focusNode.addChildNode(lightNode)

    arView.scene.rootNode.addChildNode(focusNode)
    self.pointerNode = focusNode
  }

  // MARK: - ARSessionDelegate & ARSCNViewDelegate
  
  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    updatePointer(frame: frame)
  }
  
  // Auto-detect floor from ARPlaneAnchor
  func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
    for anchor in anchors {
      if let planeAnchor = anchor as? ARPlaneAnchor {
        if planeAnchor.alignment == .horizontal && floorY == nil {
          let y = planeAnchor.transform.columns.3.y
          self.floorY = y
          onUpdate(["event": "floor_auto_detected", "y": y])
        }
      }
    }
  }

  func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
      if #available(iOS 13.4, *) {
          if let meshAnchor = anchor as? ARMeshAnchor {
              let rootNode = SCNNode()
              
              // 1) Occluder
              let occGeometry = createGeometry(from: meshAnchor)
              occGeometry.firstMaterial?.colorBufferWriteMask = []
              let occNode = SCNNode(geometry: occGeometry)
              rootNode.addChildNode(occNode)
              
              // 2) Wireframe — Matrix X-ray style
              let visGeometry = createGeometry(from: meshAnchor)
              let visMat = SCNMaterial()
              visMat.fillMode = .lines
              visMat.lightingModel = .lambert
              visMat.ambient.contents = UIColor.black
              visMat.locksAmbientWithDiffuse = false
              visMat.diffuse.contents = UIColor.white
              visGeometry.firstMaterial = visMat
              
              let visNode = SCNNode(geometry: visGeometry)
              visNode.categoryBitMask = 2
              rootNode.addChildNode(visNode)
              
              return rootNode
          }
      }
      return nil
  }

  func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
      if #available(iOS 13.4, *) {
          if let meshAnchor = anchor as? ARMeshAnchor {
              if node.childNodes.count == 2 {
                  let occNode = node.childNodes[0]
                  let visNode = node.childNodes[1]
                  
                  let newGeom = createGeometry(from: meshAnchor)
                  
                  let occGeom = newGeom.copy() as! SCNGeometry
                  occGeom.firstMaterial = SCNMaterial()
                  occGeom.firstMaterial?.colorBufferWriteMask = []
                  occNode.geometry = occGeom
                  
                  let visGeom = newGeom.copy() as! SCNGeometry
                  let visMat = SCNMaterial()
                  visMat.fillMode = .lines
                  visMat.lightingModel = .lambert
                  visMat.ambient.contents = UIColor.black
                  visMat.locksAmbientWithDiffuse = false
                  visMat.diffuse.contents = UIColor.white
                  visGeom.firstMaterial = visMat
                  visNode.geometry = visGeom
              }
          }
      }
  }

  @available(iOS 13.4, *)
  private func createGeometry(from anchor: ARMeshAnchor) -> SCNGeometry {
      let vertices = anchor.geometry.vertices
      let normals = anchor.geometry.normals
      let faces = anchor.geometry.faces
      
      let vertexSource = SCNGeometrySource(buffer: vertices.buffer, vertexFormat: vertices.format, semantic: .vertex, vertexCount: vertices.count, dataOffset: vertices.offset, dataStride: vertices.stride)
      let normalSource = SCNGeometrySource(buffer: normals.buffer, vertexFormat: normals.format, semantic: .normal, vertexCount: normals.count, dataOffset: normals.offset, dataStride: normals.stride)
      let data = Data(bytesNoCopy: faces.buffer.contents(), count: faces.buffer.length, deallocator: .none)
      let geometryElement = SCNGeometryElement(data: data, primitiveType: .triangles, primitiveCount: faces.count, bytesPerIndex: faces.bytesPerIndex)
      
      return SCNGeometry(sources: [vertexSource, normalSource], elements: [geometryElement])
  }

  // MARK: - Pointer Update
  
  private func updatePointer(frame: ARFrame) {
    let screenCenter = CGPoint(x: bounds.midX, y: bounds.midY)
    
    // Track trajectory (every 0.5 seconds)
    if frame.timestamp - lastTrajectoryTime > 0.5 {
      lastTrajectoryTime = frame.timestamp
      let t = frame.camera.transform
      let point: [String: Float] = [
        "x": t.columns.3.x, "y": t.columns.3.y, "z": t.columns.3.z
      ]
      cameraTrajectory.append(point)
      
      // Auto-photo: check distance from last photo position
      if autoPhotoEnabled {
        let camPos = SCNVector3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        if let lastPos = lastAutoPhotoPosition {
          let dx = camPos.x - lastPos.x
          let dz = camPos.z - lastPos.z
          let dist = sqrt(dx*dx + dz*dz)
          if dist >= autoPhotoGridSpacing {
            autoCapture(at: camPos, frame: frame)
          }
        } else {
          // First photo when auto-photo starts
          autoCapture(at: camPos, frame: frame)
        }
      }
    }
    
    let cameraPos = SCNVector3(frame.camera.transform.columns.3.x,
                               frame.camera.transform.columns.3.y,
                               frame.camera.transform.columns.3.z)
    let cameraDir = SCNVector3(-frame.camera.transform.columns.2.x,
                               -frame.camera.transform.columns.2.y,
                               -frame.camera.transform.columns.2.z)

    var hitPosition: SCNVector3? = nil
    var surfaceNormal: SCNVector3 = SCNVector3(0, 1, 0)
    var pointerColor: UIColor = .white

    switch drawingMode {
    case .wall:
      // WALL: vertical surfaces only — pink
      if let result = arView.hitTest(screenCenter, types: [.existingPlaneUsingExtent, .estimatedVerticalPlane, .featurePoint]).first {
        hitPosition = SCNVector3(result.worldTransform.columns.3.x,
                                 result.worldTransform.columns.3.y,
                                 result.worldTransform.columns.3.z)
        surfaceNormal = SCNVector3(result.worldTransform.columns.1.x,
                                   result.worldTransform.columns.1.y,
                                   result.worldTransform.columns.1.z)
      }
      pointerColor = wallPink

    case .free: // Renamed from .levels
      // FREE: any polygon, any surface
      if let result = arView.hitTest(screenCenter, types: [.existingPlaneUsingExtent, .estimatedHorizontalPlane, .estimatedVerticalPlane, .featurePoint]).first {
        hitPosition = SCNVector3(result.worldTransform.columns.3.x,
                                 result.worldTransform.columns.3.y,
                                 result.worldTransform.columns.3.z)
        surfaceNormal = SCNVector3(result.worldTransform.columns.1.x,
                                   result.worldTransform.columns.1.y,
                                   result.worldTransform.columns.1.z)
      }
      pointerColor = freeOrange // Renamed from levelsGreen

    case .floor:
      // FLOOR: locked to floorY, horizontal only
      if let fy = floorY {
        let t = (fy - cameraPos.y) / cameraDir.y
        if t > 0 && t < 20.0 {
          hitPosition = SCNVector3(cameraPos.x + t * cameraDir.x,
                                   fy,
                                   cameraPos.z + t * cameraDir.z)
        }
        surfaceNormal = SCNVector3(0, 1, 0)
      } else {
        if let result = arView.hitTest(screenCenter, types: [.existingPlaneUsingExtent, .estimatedHorizontalPlane, .featurePoint]).first {
          hitPosition = SCNVector3(result.worldTransform.columns.3.x,
                                   result.worldTransform.columns.3.y,
                                   result.worldTransform.columns.3.z)
          surfaceNormal = SCNVector3(result.worldTransform.columns.1.x,
                                     result.worldTransform.columns.1.y,
                                     result.worldTransform.columns.1.z)
        }
      }
      pointerColor = floorY != nil ? tronBlue : .yellow
    }

    // --- OVERRIDE FOR 3D HEIGHT PULLING ---
    // If we are currently placing the height of a 3D object, unlock from the floor
    // and intersect the camera view with a vertical plane erected at the base center!
    var overridenPosition: SCNVector3? = nil
    if let type = previewType, previewPoints.count >= 2 {
       let needsHeight = (type == "box" && previewPoints.count >= 3) || 
                         (type == "cylinder" && previewPoints.count >= 2) || 
                         (type == "cone" && previewPoints.count >= 2) || 
                         (type == "pyramid" && previewPoints.count >= 2) ||
                         (type == "ellipse" && previewPoints.count >= 2)
       
       if needsHeight {
           let basePt = previewPoints[0] 
           // Normal of the vertical plane facing the camera
           let nx = cameraPos.x - basePt.x
           let nz = cameraPos.z - basePt.z
           let len = sqrt(nx*nx + nz*nz)
           if len > 0.001 {
               let n = SCNVector3(nx/Float(len), 0, nz/Float(len))
               let dotNDir = n.x * cameraDir.x + n.y * cameraDir.y + n.z * cameraDir.z
               if abs(dotNDir) > 0.001 {
                   let dotNBase = n.x * (basePt.x - cameraPos.x) + n.y * (basePt.y - cameraPos.y) + n.z * (basePt.z - cameraPos.z)
                   let t = dotNBase / dotNDir
                   if t > 0 && t < 20.0 {
                       overridenPosition = SCNVector3(cameraPos.x + t * cameraDir.x,
                                                      cameraPos.y + t * cameraDir.y,
                                                      cameraPos.z + t * cameraDir.z)
                       surfaceNormal = n
                   }
               }
           }
       }
    }
    
    if let ov = overridenPosition {
        hitPosition = ov
    }

    guard let position = hitPosition else {
      pointerNode?.isHidden = true
      ghostLineNode?.isHidden = true
      ghostDistLabel?.isHidden = true
      onPlaneStateChange(["status": "searching"])
      return
    }

    pointerNode?.isHidden = false
    pointerNode?.position = position
    
    // Align pointer to surface normal
    alignPointerToNormal(surfaceNormal)
    
    // Update ghost preview line from last polygon point to cursor
    updateGhostLine(to: position)
    
    // Update real-time shape preview wireframe
    updateShapePreview(cursorPos: position)
    
    // Scale cursor with clamped range
    let dist = distance(from: cameraPos, to: position)
    let rawScale = 1.0 / max(0.1, dist)
    let scaleFactor = max(cursorMinScale, min(cursorMaxScale, rawScale))
    pointerNode?.scale = SCNVector3(scaleFactor, scaleFactor, scaleFactor)
    
    // Counter-scale distance label so text stays same size
    if scaleFactor > 0.01 {
      let invS = 1.0 / scaleFactor * 0.005
      distanceLabel?.scale = SCNVector3(invS, invS, invS)
    }
    
    // ----------- FREEHAND CONTINUOUS DRAWING -----------
    if isFreehandActive {
        if freehandPoints.isEmpty {
            freehandPoints.append(position)
        } else if let lastP = freehandPoints.last, distance(from: lastP, to: position) > 0.02 {
            // Draw visual line segment
            let vector = SCNVector3(position.x - lastP.x, position.y - lastP.y, position.z - lastP.z)
            let length = distance(from: lastP, to: position)
            
            let plane = SCNPlane(width: CGFloat(currentFreehandThickness), height: CGFloat(length))
            plane.firstMaterial?.diffuse.contents = currentFreehandColor
            plane.firstMaterial?.lightingModel = .constant
            plane.firstMaterial?.isDoubleSided = true
            plane.firstMaterial?.readsFromDepthBuffer = true
            
            let segNode = SCNNode(geometry: plane)
            segNode.position = SCNVector3((lastP.x + position.x) / 2, (lastP.y + position.y) / 2, (lastP.z + position.z) / 2)
            
            let yAxis = SCNVector3(0, 1, 0)
            var axis = crossProduct(v1: yAxis, v2: vector)
            let axisLength = sqrt(axis.x*axis.x + axis.y*axis.y + axis.z*axis.z)
            var angle = acos(dotProduct(v1: yAxis, v2: vector) / length)
            
            if axisLength < 0.001 {
                axis = SCNVector3(1, 0, 0)
                angle = vector.y < 0 ? Float.pi : 0
            } else {
                axis = SCNVector3(axis.x/axisLength, axis.y/axisLength, axis.z/axisLength)
            }
            segNode.rotation = SCNVector4(axis.x, axis.y, axis.z, angle)
            
            arView.scene.rootNode.addChildNode(segNode)
            freehandLineNodes.append(segNode)
            freehandPoints.append(position)
        }
    }
    // ----------- --------------------------- -----------
    
    if let textGeo = distanceLabel?.geometry as? SCNText {
        textGeo.string = String(format: "%.2fm", dist)
        let (min, max) = textGeo.boundingBox
        let dx = min.x + 0.5 * (max.x - min.x)
        let dy = min.y + 0.5 * (max.y - min.y)
        textLabelPivot(node: distanceLabel!, dx: dx, dy: dy)
    }
    
    onPlaneStateChange(["status": floorY != nil ? "ready" : "detecting_floor"])
  }

  private func textLabelPivot(node: SCNNode, dx: Float, dy: Float) {
      node.pivot = SCNMatrix4MakeTranslation(dx, dy, 0)
  }

  /// Align the pointer to the surface normal
  private func alignPointerToNormal(_ normal: SCNVector3) {
    let nLen = sqrt(normal.x*normal.x + normal.y*normal.y + normal.z*normal.z)
    guard nLen > 0.001 else { return }
    let n = SCNVector3(normal.x/nLen, normal.y/nLen, normal.z/nLen)
    
    // Compute euler angles from surface normal
    let pitch = asin(-n.z)
    let yaw = atan2(n.x, n.y)
    pointerNode?.eulerAngles = SCNVector3(pitch, yaw, 0)
  }

  /// Get active mode color
  private func modeColor() -> UIColor {
    switch drawingMode {
    case .floor: return tronBlue
    case .free: return freeOrange
    case .wall: return wallPink
    }
  }

  /// Draw ghost line from last polygon point to the current cursor position
  private func updateGhostLine(to cursorPos: SCNVector3) {
    guard let lastPoint = currentPolygon.last else {
      ghostLineNode?.isHidden = true
      ghostDistLabel?.isHidden = true
      return
    }
    
    // Snap cursor to floor if in floor mode only
    var snapPos = cursorPos
    if drawingMode == .floor, let fy = floorY {
      snapPos = SCNVector3(cursorPos.x, fy, cursorPos.z)
    }
    
    let vector = SCNVector3(snapPos.x - lastPoint.x, snapPos.y - lastPoint.y, snapPos.z - lastPoint.z)
    let length = sqrt(vector.x*vector.x + vector.y*vector.y + vector.z*vector.z)
    guard length > 0.01 else { return }
    
    // Remove old ghost line
    ghostLineNode?.removeFromParentNode()
    ghostDistLabel?.removeFromParentNode()
    
    // Draw ghost line in mode color
    let plane = SCNPlane(width: 0.003, height: CGFloat(length))
    plane.firstMaterial?.diffuse.contents = modeColor().withAlphaComponent(0.4)
    plane.firstMaterial?.lightingModel = .constant
    plane.firstMaterial?.isDoubleSided = true
    plane.firstMaterial?.readsFromDepthBuffer = false
    
    let node = SCNNode(geometry: plane)
    node.position = SCNVector3((lastPoint.x + snapPos.x)/2, (lastPoint.y + snapPos.y)/2, (lastPoint.z + snapPos.z)/2)
    
    let yAxis = SCNVector3(0, 1, 0)
    var axis = crossProduct(v1: yAxis, v2: vector)
    let axisLength = sqrt(axis.x*axis.x + axis.y*axis.y + axis.z*axis.z)
    var angle = acos(dotProduct(v1: yAxis, v2: vector) / length)
    
    if axisLength < 0.001 {
        axis = SCNVector3(1, 0, 0)
        angle = vector.y < 0 ? Float.pi : 0
    } else {
        axis = SCNVector3(axis.x/axisLength, axis.y/axisLength, axis.z/axisLength)
    }
    node.rotation = SCNVector4(axis.x, axis.y, axis.z, angle)
    node.renderingOrder = 100
    
    arView.scene.rootNode.addChildNode(node)
    ghostLineNode = node
    ghostLineNode?.isHidden = false
    
    // Ghost distance label
    let textGeo = SCNText(string: String(format: "%.2fm", length), extrusionDepth: 0.0)
    textGeo.font = UIFont.systemFont(ofSize: 8)
    textGeo.firstMaterial?.diffuse.contents = tronBlue.withAlphaComponent(0.6)
    textGeo.firstMaterial?.isDoubleSided = true
    textGeo.firstMaterial?.lightingModel = .constant
    
    let textNode = SCNNode(geometry: textGeo)
    textNode.scale = SCNVector3(0.004, 0.004, 0.004)
    let (bMin, bMax) = textNode.boundingBox
    textNode.pivot = SCNMatrix4MakeTranslation(
      bMin.x + 0.5*(bMax.x - bMin.x),
      bMin.y + 0.5*(bMax.y - bMin.y),
      bMin.z + 0.5*(bMax.z - bMin.z)
    )
    textNode.position = SCNVector3((lastPoint.x + snapPos.x)/2, (lastPoint.y + snapPos.y)/2 + 0.08, (lastPoint.z + snapPos.z)/2)
    let billC = SCNBillboardConstraint()
    billC.freeAxes = .Y
    textNode.constraints = [billC]
    arView.scene.rootNode.addChildNode(textNode)
    ghostDistLabel = textNode
    ghostDistLabel?.isHidden = false
  }

  // MARK: - Interaction
  
  func addPoint() {
    guard let pointer = pointerNode, !pointer.isHidden else { return }
    let hitPos = pointer.position

    let color: UIColor
    switch drawingMode {
    case .floor:
        color = tronBlue
        guard floorY != nil else {
            self.floorY = hitPos.y
            onUpdate(["event": "floor_manual_set", "y": hitPos.y])
            return
        }
    case .free:
        color = freeOrange
    case .wall:
        color = wallPink
    }
    addPolygonPoint(at: hitPos, color: color)
  }

  /// Place a point at specific world coordinates (for computed shapes like rect, circle)
  func addPointAt(x: Float, y: Float, z: Float) {
    let pos = SCNVector3(x, y, z)
    let color: UIColor
    switch drawingMode {
    case .floor:  color = tronBlue
    case .free:   color = freeOrange
    case .wall:   color = wallPink
    }
    addPolygonPoint(at: pos, color: color)
  }

  /// Get current cursor position without adding a point
  func getCursorPosition() -> [String: Float]? {
    guard let pointer = pointerNode, !pointer.isHidden else { return nil }
    let pos = pointer.position
    return ["x": pos.x, "y": pos.y, "z": pos.z]
  }

  /// Clear the current in-progress shape (discard all current polygon points)
  func clearCurrentShape() {
    // Remove current polygon point nodes
    for node in pointNodes {
        node.removeFromParentNode()
    }
    pointNodes.removeAll()
    
    // Remove current lines
    for line in lineNodes {
        line.removeFromParentNode()
    }
    lineNodes.removeAll()
    
    // Clear polygon data
    currentPolygon.removeAll()
    
    // Remove ghost line
    ghostLineNode?.removeFromParentNode()
    ghostLineNode = nil
    ghostDistLabel?.removeFromParentNode()
    ghostDistLabel = nil
    
    // Clear preview
    clearShapePreview()
  }

  // MARK: - Freehand 3D Sketch

  func startFreehandStroke(thickness: Float, colorHex: String) {
      self.isFreehandActive = true
      self.currentFreehandThickness = thickness
      self.currentFreehandColor = parseColor(hex: colorHex)
      self.freehandPoints = []
      self.freehandLineNodes = []
  }

  private func parseColor(hex: String) -> UIColor {
      var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
      hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")
      var rgb: UInt64 = 0
      Scanner(string: hexSanitized).scanHexInt64(&rgb)
      return UIColor(
          red: CGFloat((rgb & 0xFF0000) >> 16) / 255.0,
          green: CGFloat((rgb & 0x00FF00) >> 8) / 255.0,
          blue: CGFloat(rgb & 0x0000FF) / 255.0,
          alpha: 1.0
      )
  }

  func stopFreehandStroke(label: String) -> [String: Any]? {
      self.isFreehandActive = false
      guard freehandPoints.count > 1 else { return nil }
      
      let container = SCNNode()
      container.name = "freehand_group"
      
      // Group visual segments
      for n in freehandLineNodes {
          n.removeFromParentNode()
          container.addChildNode(n)
      }
      arView.scene.rootNode.addChildNode(container)
      
      let shapeId = UUID().uuidString
      let pointsDict = freehandPoints.map { ["x": $0.x, "y": $0.y, "z": $0.z] }
      
      let shape = sketchManager.addFreehandShape(
          id: shapeId,
          node: container,
          label: label,
          color: currentFreehandColor,
          sourcePoints: pointsDict,
          thickness: currentFreehandThickness
      )
      
      freehandPoints.removeAll()
      freehandLineNodes.removeAll()
      
      return sketchManager.shapeToDict(shape)
  }

  // MARK: - Real-time Shape Preview

  /// Called from JS after each intermediate tap to set up preview
  func setPreviewShape(type: String, points: [[String: Float]]) {
    previewType = type
    previewPoints = points.map { p in
      SCNVector3(p["x"] ?? 0, p["y"] ?? 0, p["z"] ?? 0)
    }
  }

  /// Remove preview wireframe
  func clearShapePreview() {
    previewNode?.removeFromParentNode()
    previewNode = nil
    previewType = nil
    previewPoints.removeAll()
  }

  /// Called every frame to update the wireframe preview based on cursor position
  private func updateShapePreview(cursorPos: SCNVector3) {
    guard let type = previewType, !previewPoints.isEmpty else { return }

    // Remove old preview
    previewNode?.removeFromParentNode()

    let wireColor = UIColor.white
    let node = SCNNode()
    node.name = "shape_preview"

    switch type {

    // ═══ LINE: just a line from A to cursor ═══
    case "line":
      if previewPoints.count == 1 {
        addWireLine(to: node, from: previewPoints[0], to: cursorPos, color: wireColor)
      }

    // ═══ RECT: 3-step rotatable (A, B=edge, C=width) ═══
    case "rect":
      if previewPoints.count == 1 {
        // Step 1: line from A to cursor (top edge preview)
        addWireLine(to: node, from: previewPoints[0], to: cursorPos, color: wireColor)
      } else if previewPoints.count >= 2 {
        // Step 2: full rect with perpendicular width
        let a = previewPoints[0]
        let b = previewPoints[1]
        let abx = b.x - a.x; let abz = b.z - a.z
        let abLen = sqrt(abx * abx + abz * abz)
        guard abLen > 0.001 else { break }
        let perpx = -abz / abLen; let perpz = abx / abLen
        let acx = cursorPos.x - a.x; let acz = cursorPos.z - a.z
        let w = acx * perpx + acz * perpz
        let c0 = a
        let c1 = b
        let c2 = SCNVector3(b.x + perpx * w, a.y, b.z + perpz * w)
        let c3 = SCNVector3(a.x + perpx * w, a.y, a.z + perpz * w)
        addWireLine(to: node, from: c0, to: c1, color: wireColor)
        addWireLine(to: node, from: c1, to: c2, color: wireColor)
        addWireLine(to: node, from: c2, to: c3, color: wireColor)
        addWireLine(to: node, from: c3, to: c0, color: wireColor)
      }

    // ═══ SQUARE: 1 point placed, cursor = opposite corner ═══
    case "square":
      let a = previewPoints[0]
      let b = squareB(a: a, cursor: cursorPos)
      let c0 = a
      let c1 = SCNVector3(b.x, a.y, a.z)
      let c2 = SCNVector3(b.x, a.y, b.z)
      let c3 = SCNVector3(a.x, a.y, b.z)
      addWireLine(to: node, from: c0, to: c1, color: wireColor)
      addWireLine(to: node, from: c1, to: c2, color: wireColor)
      addWireLine(to: node, from: c2, to: c3, color: wireColor)
      addWireLine(to: node, from: c3, to: c0, color: wireColor)

    // ═══ CIRCLE: 1 point (center), cursor = radius ═══
    case "circle":
      let center = previewPoints[0]
      let radius = sqrt(pow(cursorPos.x - center.x, 2) + pow(cursorPos.z - center.z, 2))
      let segments = 32
      for i in 0..<segments {
        let a1 = Float(i) / Float(segments) * Float.pi * 2
        let a2 = Float(i + 1) / Float(segments) * Float.pi * 2
        let p1 = SCNVector3(center.x + cos(a1) * radius, center.y, center.z + sin(a1) * radius)
        let p2 = SCNVector3(center.x + cos(a2) * radius, center.y, center.z + sin(a2) * radius)
        addWireLine(to: node, from: p1, to: p2, color: wireColor)
      }

    // ═══ ELLIPSE: center → width → height ═══
    case "ellipse":
      if previewPoints.count == 1 {
        // Step 1: Center fixed, mapping circle as width preview
        let center = previewPoints[0]
        let radius = distance(from: center, to: cursorPos)
        let segments = 32
        for i in 0..<segments {
          let a1 = Float(i) / Float(segments) * Float.pi * 2
          let a2 = Float(i + 1) / Float(segments) * Float.pi * 2
          let p1 = SCNVector3(center.x + cos(a1) * radius, center.y, center.z + sin(a1) * radius)
          let p2 = SCNVector3(center.x + cos(a2) * radius, center.y, center.z + sin(a2) * radius)
          addWireLine(to: node, from: p1, to: p2, color: wireColor)
        }
      } else if previewPoints.count >= 2 {
        // Step 2: Center and width fixed, cursor defines height (depth)
        let center = previewPoints[0]
        let widthP = previewPoints[1]
        let radiusX = distance(from: center, to: widthP) // width
        let radiusZ = distance(from: center, to: cursorPos) // height
        let segments = 32
        let angleOffset = atan2(widthP.z - center.z, widthP.x - center.x) // align with width vector
        for i in 0..<segments {
          let a1 = Float(i) / Float(segments) * Float.pi * 2
          let a2 = Float(i + 1) / Float(segments) * Float.pi * 2
          
          // Parametric ellipse x = a*cos(t), z = b*sin(t)
          let xl1 = radiusX * cos(a1); let zl1 = radiusZ * sin(a1)
          let xl2 = radiusX * cos(a2); let zl2 = radiusZ * sin(a2)
          
          // Rotate by angleOffset
          let p1x = center.x + (xl1 * cos(angleOffset) - zl1 * sin(angleOffset))
          let p1z = center.z + (xl1 * sin(angleOffset) + zl1 * cos(angleOffset))
          
          let p2x = center.x + (xl2 * cos(angleOffset) - zl2 * sin(angleOffset))
          let p2z = center.z + (xl2 * sin(angleOffset) + zl2 * cos(angleOffset))
          
          let p1 = SCNVector3(p1x, center.y, p1z)
          let p2 = SCNVector3(p2x, center.y, p2z)
          
          addWireLine(to: node, from: p1, to: p2, color: wireColor)
        }
      }

    // ═══ BOX: 4-step (A→B edge, width, height) ═══
    case "box":
      if previewPoints.count == 1 {
        // Step 1: line A→cursor (top edge)
        addWireLine(to: node, from: previewPoints[0], to: cursorPos, color: wireColor)
      } else if previewPoints.count == 2 {
        // Step 2: rect base with perpendicular width
        let ba = previewPoints[0]; let bb = previewPoints[1]
        let abx = bb.x - ba.x; let abz = bb.z - ba.z
        let abLen = sqrt(abx * abx + abz * abz)
        guard abLen > 0.001 else { break }
        let perpx = -abz / abLen; let perpz = abx / abLen
        let acx = cursorPos.x - ba.x; let acz = cursorPos.z - ba.z
        let w = acx * perpx + acz * perpz
        let bc0 = ba; let bc1 = bb
        let bc2 = SCNVector3(bb.x + perpx * w, ba.y, bb.z + perpz * w)
        let bc3 = SCNVector3(ba.x + perpx * w, ba.y, ba.z + perpz * w)
        addWireLine(to: node, from: bc0, to: bc1, color: wireColor)
        addWireLine(to: node, from: bc1, to: bc2, color: wireColor)
        addWireLine(to: node, from: bc2, to: bc3, color: wireColor)
        addWireLine(to: node, from: bc3, to: bc0, color: wireColor)
      } else if previewPoints.count >= 3 {
        // Step 3: full box, pulling height
        let ba = previewPoints[0]; let bb = previewPoints[1]; let bc = previewPoints[2]
        let abx = bb.x - ba.x; let abz = bb.z - ba.z
        let abLen = sqrt(abx * abx + abz * abz)
        guard abLen > 0.001 else { break }
        let perpx = -abz / abLen; let perpz = abx / abLen
        let acx = bc.x - ba.x; let acz = bc.z - ba.z
        let w = acx * perpx + acz * perpz
        let bc0 = ba; let bc1 = bb
        let bc2 = SCNVector3(bb.x + perpx * w, ba.y, bb.z + perpz * w)
        let bc3 = SCNVector3(ba.x + perpx * w, ba.y, ba.z + perpz * w)
        let h = cursorPos.y - ba.y
        let bt0 = SCNVector3(bc0.x, ba.y + h, bc0.z)
        let bt1 = SCNVector3(bc1.x, ba.y + h, bc1.z)
        let bt2 = SCNVector3(bc2.x, ba.y + h, bc2.z)
        let bt3 = SCNVector3(bc3.x, ba.y + h, bc3.z)
        // Bottom
        addWireLine(to: node, from: bc0, to: bc1, color: wireColor)
        addWireLine(to: node, from: bc1, to: bc2, color: wireColor)
        addWireLine(to: node, from: bc2, to: bc3, color: wireColor)
        addWireLine(to: node, from: bc3, to: bc0, color: wireColor)
        // Top
        addWireLine(to: node, from: bt0, to: bt1, color: wireColor)
        addWireLine(to: node, from: bt1, to: bt2, color: wireColor)
        addWireLine(to: node, from: bt2, to: bt3, color: wireColor)
        addWireLine(to: node, from: bt3, to: bt0, color: wireColor)
        // Verticals
        addWireLine(to: node, from: bc0, to: bt0, color: wireColor)
        addWireLine(to: node, from: bc1, to: bt1, color: wireColor)
        addWireLine(to: node, from: bc2, to: bt2, color: wireColor)
        addWireLine(to: node, from: bc3, to: bt3, color: wireColor)
      }

    // ═══ SPHERE: 1 point (center), cursor = radius ═══
    case "sphere":
      let center = previewPoints[0]
      let radius = sqrt(pow(cursorPos.x - center.x, 2) + pow(cursorPos.y - center.y, 2) + pow(cursorPos.z - center.z, 2))
      let segments = 24
      // Draw 3 circles (XY, XZ, YZ)
      for i in 0..<segments {
        let a1 = Float(i) / Float(segments) * Float.pi * 2
        let a2 = Float(i + 1) / Float(segments) * Float.pi * 2
        // XZ circle
        let px1 = SCNVector3(center.x + cos(a1) * radius, center.y, center.z + sin(a1) * radius)
        let px2 = SCNVector3(center.x + cos(a2) * radius, center.y, center.z + sin(a2) * radius)
        addWireLine(to: node, from: px1, to: px2, color: wireColor)
        // XY circle
        let py1 = SCNVector3(center.x + cos(a1) * radius, center.y + sin(a1) * radius, center.z)
        let py2 = SCNVector3(center.x + cos(a2) * radius, center.y + sin(a2) * radius, center.z)
        addWireLine(to: node, from: py1, to: py2, color: wireColor)
        // YZ circle
        let pz1 = SCNVector3(center.x, center.y + cos(a1) * radius, center.z + sin(a1) * radius)
        let pz2 = SCNVector3(center.x, center.y + cos(a2) * radius, center.z + sin(a2) * radius)
        addWireLine(to: node, from: pz1, to: pz2, color: wireColor)
      }

    // ═══ CYLINDER: center → radius, then height ═══
    case "cylinder":
      if previewPoints.count == 1 {
        // Circle base preview
        let center = previewPoints[0]
        let radius = sqrt(pow(cursorPos.x - center.x, 2) + pow(cursorPos.z - center.z, 2))
        let segments = 24
        for i in 0..<segments {
          let a1 = Float(i) / Float(segments) * Float.pi * 2
          let a2 = Float(i + 1) / Float(segments) * Float.pi * 2
          let p1 = SCNVector3(center.x + cos(a1) * radius, center.y, center.z + sin(a1) * radius)
          let p2 = SCNVector3(center.x + cos(a2) * radius, center.y, center.z + sin(a2) * radius)
          addWireLine(to: node, from: p1, to: p2, color: wireColor)
        }
      } else if previewPoints.count == 2 {
        // Full cylinder
        let center = previewPoints[0]
        let radius = sqrt(pow(previewPoints[1].x - center.x, 2) + pow(previewPoints[1].z - center.z, 2))
        let h = cursorPos.y - center.y
        let segments = 24
        for i in 0..<segments {
          let a1 = Float(i) / Float(segments) * Float.pi * 2
          let a2 = Float(i + 1) / Float(segments) * Float.pi * 2
          // Bottom circle
          let b1 = SCNVector3(center.x + cos(a1) * radius, center.y, center.z + sin(a1) * radius)
          let b2 = SCNVector3(center.x + cos(a2) * radius, center.y, center.z + sin(a2) * radius)
          addWireLine(to: node, from: b1, to: b2, color: wireColor)
          // Top circle
          let t1 = SCNVector3(center.x + cos(a1) * radius, center.y + h, center.z + sin(a1) * radius)
          let t2 = SCNVector3(center.x + cos(a2) * radius, center.y + h, center.z + sin(a2) * radius)
          addWireLine(to: node, from: t1, to: t2, color: wireColor)
          // Vertical lines (every 6th segment)
          if i % 6 == 0 {
            addWireLine(to: node, from: b1, to: t1, color: wireColor)
          }
        }
      }

    // ═══ CONE: center → radius, then height ═══
    case "cone", "pyramid":
      if previewPoints.count == 1 {
        // Base circle/rect
        let center = previewPoints[0]
        let radius = sqrt(pow(cursorPos.x - center.x, 2) + pow(cursorPos.z - center.z, 2))
        let segments = 24
        for i in 0..<segments {
          let a1 = Float(i) / Float(segments) * Float.pi * 2
          let a2 = Float(i + 1) / Float(segments) * Float.pi * 2
          let p1 = SCNVector3(center.x + cos(a1) * radius, center.y, center.z + sin(a1) * radius)
          let p2 = SCNVector3(center.x + cos(a2) * radius, center.y, center.z + sin(a2) * radius)
          addWireLine(to: node, from: p1, to: p2, color: wireColor)
        }
      } else if previewPoints.count == 2 {
        // Full cone with apex
        let center = previewPoints[0]
        let radius = sqrt(pow(previewPoints[1].x - center.x, 2) + pow(previewPoints[1].z - center.z, 2))
        let h = cursorPos.y - center.y
        let apex = SCNVector3(center.x, center.y + h, center.z)
        let segments = 24
        for i in 0..<segments {
          let a1 = Float(i) / Float(segments) * Float.pi * 2
          let a2 = Float(i + 1) / Float(segments) * Float.pi * 2
          let b1 = SCNVector3(center.x + cos(a1) * radius, center.y, center.z + sin(a1) * radius)
          let b2 = SCNVector3(center.x + cos(a2) * radius, center.y, center.z + sin(a2) * radius)
          addWireLine(to: node, from: b1, to: b2, color: wireColor)
          if i % 4 == 0 {
            addWireLine(to: node, from: b1, to: apex, color: wireColor)
          }
        }
      }

    default:
      break
    }

    arView.scene.rootNode.addChildNode(node)
    previewNode = node
  }

  /// Helper: make square B from cursor
  private func squareB(a: SCNVector3, cursor: SCNVector3) -> SCNVector3 {
    let dx = cursor.x - a.x
    let dz = cursor.z - a.z
    let side = max(abs(dx), abs(dz))
    return SCNVector3(a.x + (dx >= 0 ? side : -side), a.y, a.z + (dz >= 0 ? side : -side))
  }

  /// Helper: add CAD-style diagonal hatch lines inside a quadrilateral
  private func addHatchLines(to parent: SCNNode, corners: [SCNVector3], color: UIColor, spacing: Float = 0.04) {
    guard corners.count == 4 else { return }
    let hatchColor = color.withAlphaComponent(0.35)
    // Axis-aligned bounding box
    let minX = min(corners[0].x, corners[1].x, corners[2].x, corners[3].x)
    let maxX = max(corners[0].x, corners[1].x, corners[2].x, corners[3].x)
    let minZ = min(corners[0].z, corners[1].z, corners[2].z, corners[3].z)
    let maxZ = max(corners[0].z, corners[1].z, corners[2].z, corners[3].z)
    let y = corners[0].y
    let diag = sqrt(pow(maxX - minX, 2) + pow(maxZ - minZ, 2))
    let steps = Int(diag / spacing)
    
    // Draw diagonal lines at 45° across the quad
    for i in stride(from: -steps, through: steps, by: 1) {
      let offset = Float(i) * spacing
      let p1 = SCNVector3(minX + offset, y, minZ)
      let p2 = SCNVector3(minX + offset + diag, y, minZ + diag)
      // Clip line to quad using simple parametric clipping
      if let (clipped1, clipped2) = clipLineToQuad(p1: p1, p2: p2, corners: corners, y: y) {
        addWireLine(to: parent, from: clipped1, to: clipped2, color: hatchColor, radius: 0.001)
      }
    }
  }

  /// Clip a line segment to a convex quadrilateral (simple approach)
  private func clipLineToQuad(p1: SCNVector3, p2: SCNVector3, corners: [SCNVector3], y: Float) -> (SCNVector3, SCNVector3)? {
    // Use parametric intersection with quad edges
    var tMin: Float = 0, tMax: Float = 1
    let dx = p2.x - p1.x, dz = p2.z - p1.z
    
    for i in 0..<4 {
      let e1 = corners[i], e2 = corners[(i + 1) % 4]
      let ex = e2.x - e1.x, ez = e2.z - e1.z
      let nx = -ez, nz = ex // inward normal (assuming CW)
      
      let denom = nx * dx + nz * dz
      let dist = nx * (p1.x - e1.x) + nz * (p1.z - e1.z)
      
      if abs(denom) < 0.0001 {
        if dist > 0 { return nil } // parallel outside
        continue
      }
      let t = -dist / denom
      if denom < 0 {
        tMin = max(tMin, t)
      } else {
        tMax = min(tMax, t)
      }
      if tMin > tMax { return nil }
    }
    
    if tMin > tMax { return nil }
    let r1 = SCNVector3(p1.x + dx * tMin, y, p1.z + dz * tMin)
    let r2 = SCNVector3(p1.x + dx * tMax, y, p1.z + dz * tMax)
    let len = sqrt(pow(r2.x - r1.x, 2) + pow(r2.z - r1.z, 2))
    if len < 0.005 { return nil }
    return (r1, r2)
  }

  /// Helper: draw a thick glowing wireframe line between two points
  private func addWireLine(to parent: SCNNode, from: SCNVector3, to: SCNVector3, color: UIColor, radius: CGFloat = 0.003) {
    let dx = to.x - from.x
    let dy = to.y - from.y
    let dz = to.z - from.z
    let length = sqrt(dx*dx + dy*dy + dz*dz)
    guard length > 0.001 else { return }
    
    let cylinder = SCNCylinder(radius: radius, height: CGFloat(length))
    let mat = SCNMaterial()
    mat.diffuse.contents = color
    mat.emission.contents = color  // glow
    mat.lightingModel = .constant
    mat.readsFromDepthBuffer = false // ALWAYS VISIBLE (no occlusion)
    cylinder.materials = [mat]
    
    let lineNode = SCNNode(geometry: cylinder)
    lineNode.position = SCNVector3(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
      (from.z + to.z) / 2
    )
    lineNode.look(at: SCNVector3(to.x, to.y, to.z), up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 1, 0))
    parent.addChildNode(lineNode)
  }

  func setCeiling() {
    guard let pointer = pointerNode, !pointer.isHidden else { return }
    self.ceilingY = pointer.position.y
    
    if let fy = floorY {
        let height = abs(self.ceilingY! - fy)
        onUpdate(["event": "ceiling_set", "y": self.ceilingY!, "roomHeight": height])
        
        let floorPos = SCNVector3(pointer.position.x, fy, pointer.position.z)
        let ceilPos = SCNVector3(pointer.position.x, self.ceilingY!, pointer.position.z)
        drawLine(from: floorPos, to: ceilPos, color: tronBlue)
        let midPoint = SCNVector3(pointer.position.x, (fy + self.ceilingY!) / 2, pointer.position.z)
        drawText(text: String(format: "%.2fm", height), at: midPoint)
    }
  }

  private func addPolygonPoint(at position: SCNVector3, color: UIColor) {
    var snappedPos = position
    // Only floor mode locks to floorY; levels keeps actual Y
    if drawingMode == .floor, let fy = floorY {
        snappedPos = SCNVector3(position.x, fy, position.z)
    }
    
    // --- Point Snapping ---
    // Check if any existing point is within snapRadius
    var didSnap = false
    var closestDist: Float = snapRadius
    var closestPoint = snappedPos
    
    for existingPt in allPlacedPoints {
        let d = distance(from: snappedPos, to: existingPt)
        if d < closestDist {
            closestDist = d
            closestPoint = existingPt
            didSnap = true
        }
    }
    
    if didSnap {
        snappedPos = closestPoint
        // Visual snap indicator — briefly flash a white ring
        let snapRing = SCNTorus(ringRadius: 0.03, pipeRadius: 0.003)
        snapRing.firstMaterial?.diffuse.contents = UIColor.white
        snapRing.firstMaterial?.lightingModel = .constant
        let snapNode = SCNNode(geometry: snapRing)
        snapNode.position = snappedPos
        snapNode.eulerAngles.x = Float.pi / 2
        arView.scene.rootNode.addChildNode(snapNode)
        // Fade out after 0.5s
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            snapNode.removeFromParentNode()
        }
    }
    
    currentPolygon.append(snappedPos)
    allPlacedPoints.append(snappedPos)
    if showVisualGuides {
        drawSphere(at: snappedPos, color: color)
    }
    
    if currentPolygon.count > 1 {
      let prevPos = currentPolygon[currentPolygon.count - 2]
      drawLine(from: prevPos, to: snappedPos, color: color)

      let length = distance(from: prevPos, to: snappedPos)
      if showVisualGuides {
          let midPoint = SCNVector3((prevPos.x + snappedPos.x)/2, (prevPos.y + snappedPos.y)/2, (prevPos.z + snappedPos.z)/2)
          drawText(text: String(format: "%.2fm", length), at: midPoint)
      }
    }
    
    // Clear ghost line (will be redrawn next frame)
    ghostLineNode?.removeFromParentNode()
    ghostLineNode = nil
    ghostDistLabel?.removeFromParentNode()
    ghostDistLabel = nil
    
    onUpdate(["event": "point_added", "count": currentPolygon.count, "snapped": didSnap])
  }

  // MARK: - SceneKit Helpers
  
  private func drawSphere(at position: SCNVector3, color: UIColor) {
    let circle = SCNPlane(width: 0.025, height: 0.025)
    circle.cornerRadius = 0.0125
    circle.firstMaterial?.diffuse.contents = color
    circle.firstMaterial?.lightingModel = .constant
    circle.firstMaterial?.isDoubleSided = true
    circle.firstMaterial?.readsFromDepthBuffer = false
    let node = SCNNode(geometry: circle)
    node.position = position
    node.renderingOrder = 100
    // Billboard constraint so it always faces camera
    let bc = SCNBillboardConstraint()
    node.constraints = [bc]
    arView.scene.rootNode.addChildNode(node)
    pointNodes.append(node)
  }

  private func drawLine(from: SCNVector3, to: SCNVector3, color: UIColor) {
    let vector = SCNVector3(to.x - from.x, to.y - from.y, to.z - from.z)
    let length = sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
    
    let plane = SCNPlane(width: 0.005, height: CGFloat(length))
    plane.firstMaterial?.diffuse.contents = color
    plane.firstMaterial?.lightingModel = .constant
    plane.firstMaterial?.isDoubleSided = true
    
    let node = SCNNode(geometry: plane)
    node.position = SCNVector3((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2)
    
    let yAxis = SCNVector3(0, 1, 0)
    var axis = crossProduct(v1: yAxis, v2: vector)
    let axisLength = sqrt(axis.x*axis.x + axis.y*axis.y + axis.z*axis.z)
    var angle = acos(dotProduct(v1: yAxis, v2: vector) / length)
    
    if axisLength < 0.001 {
        axis = SCNVector3(1, 0, 0)
        angle = vector.y < 0 ? Float.pi : 0
    } else {
        axis = SCNVector3(axis.x/axisLength, axis.y/axisLength, axis.z/axisLength)
    }
    
    node.rotation = SCNVector4(axis.x, axis.y, axis.z, angle)
    
    // Always visible through mesh
    plane.firstMaterial?.readsFromDepthBuffer = false
    node.renderingOrder = 100
    
    arView.scene.rootNode.addChildNode(node)
    lineNodes.append(node)
  }

  private func drawText(text: String, at pos: SCNVector3, scale: Float = 0.005) {
    let textGeo = SCNText(string: text, extrusionDepth: 0.0)
    textGeo.font = UIFont.systemFont(ofSize: 10)
    textGeo.firstMaterial?.diffuse.contents = UIColor.white
    textGeo.firstMaterial?.isDoubleSided = true
    textGeo.firstMaterial?.lightingModel = .constant
    textGeo.firstMaterial?.readsFromDepthBuffer = false
    
    let node = SCNNode(geometry: textGeo)
    node.scale = SCNVector3(scale, scale, scale)
    node.renderingOrder = 100
    
    let (min, max) = node.boundingBox
    let dx = min.x + 0.5 * (max.x - min.x)
    let dy = min.y + 0.5 * (max.y - min.y)
    let dz = min.z + 0.5 * (max.z - min.z)
    node.pivot = SCNMatrix4MakeTranslation(dx, dy, dz)
    
    node.position = SCNVector3(pos.x, pos.y + 0.1, pos.z)
    
    let billboardConstraint = SCNBillboardConstraint()
    billboardConstraint.freeAxes = .Y
    node.constraints = [billboardConstraint]
    
    arView.scene.rootNode.addChildNode(node)
    labels.append(node)
  }

  // MARK: - API Methods
  
  func closeShape() -> [String: Any]? {
    guard currentPolygon.count > 2 else { return nil }
    
    let firstPos = currentPolygon[0]
    let lastPos = currentPolygon.last!
    
    // Draw closing line in mode color
    drawLine(from: lastPos, to: firstPos, color: modeColor())
    let length = distance(from: lastPos, to: firstPos)
    let midPoint = SCNVector3((lastPos.x + firstPos.x)/2, (lastPos.y + firstPos.y)/2, (lastPos.z + firstPos.z)/2)
    drawText(text: String(format: "%.2fm", length), at: midPoint)
    
    let area = calculateArea(polygon: currentPolygon)
    
    var cx: Float = 0, cy: Float = 0, cz: Float = 0
    for p in currentPolygon {
        cx += p.x; cy += p.y; cz += p.z
    }
    cx /= Float(currentPolygon.count)
    cy /= Float(currentPolygon.count)
    cz /= Float(currentPolygon.count)
    
    let centerPos = SCNVector3(cx, cy, cz)
    drawText(text: String(format: "%.2f m²", area), at: centerPos, scale: 0.01)
    
    // Clean ghost
    ghostLineNode?.removeFromParentNode()
    ghostLineNode = nil
    ghostDistLabel?.removeFromParentNode()
    ghostDistLabel = nil
    
    let shapeNumber = closedShapes.count + 1
    let shapeData: [String: Any] = [
        "shapeNumber": shapeNumber,
        "type": drawingMode.rawValue,
        "area": area,
        "points": currentPolygon.map { ["x": $0.x, "y": $0.y, "z": $0.z] },
        "height": abs((ceilingY ?? 0) - (floorY ?? 0))
    ]
    
    closedShapes.append(shapeData)
    currentPolygon.removeAll()
    
    return shapeData
  }

  /// Save current points as a line (2 points) or polyline (3+ unclosed) — yellow color
  func saveOpenShape() -> [String: Any]? {
    guard currentPolygon.count >= 2 else { return nil }
    
    // Calculate total length of all segments
    var totalLength: Float = 0
    for i in 0..<(currentPolygon.count - 1) {
        totalLength += distance(from: currentPolygon[i], to: currentPolygon[i + 1])
    }
    
    // Clean ghost
    ghostLineNode?.removeFromParentNode()
    ghostLineNode = nil
    ghostDistLabel?.removeFromParentNode()
    ghostDistLabel = nil
    
    let shapeNumber = closedShapes.count + 1
    let shapeType = currentPolygon.count == 2 ? "line" : "polyline"
    
    let shapeData: [String: Any] = [
        "shapeNumber": shapeNumber,
        "type": shapeType,
        "area": 0,
        "totalLength": totalLength,
        "segmentCount": currentPolygon.count - 1,
        "points": currentPolygon.map { ["x": $0.x, "y": $0.y, "z": $0.z] },
        "height": abs((ceilingY ?? 0) - (floorY ?? 0))
    ]
    
    closedShapes.append(shapeData)
    currentPolygon.removeAll()
    
    // ═══ MIGRATE visual nodes to permanent container ═══
    // Move lineNodes, pointNodes, labels into a saved container
    // so clearCurrentShape() won't delete them
    let savedContainer = SCNNode()
    savedContainer.name = "savedShape_\(shapeNumber)"
    for node in lineNodes { savedContainer.addChildNode(node) }
    for node in pointNodes { savedContainer.addChildNode(node) }
    for lbl in labels { savedContainer.addChildNode(lbl) }
    arView.scene.rootNode.addChildNode(savedContainer)
    
    // Clear working arrays (nodes are now owned by savedContainer)
    lineNodes.removeAll()
    pointNodes.removeAll()
    labels.removeAll()
    
    return shapeData
  }

  func undoLastPoint() {
    guard !currentPolygon.isEmpty else { return }
    currentPolygon.removeLast()
    
    if let lastPoint = pointNodes.popLast() { lastPoint.removeFromParentNode() }
    
    if !lineNodes.isEmpty && currentPolygon.count > 0 {
      let lastLine = lineNodes.popLast()
      lastLine?.removeFromParentNode()
      let lastLabel = labels.popLast()
      lastLabel?.removeFromParentNode()
    }
    
    // Clear ghost
    ghostLineNode?.removeFromParentNode()
    ghostLineNode = nil
    ghostDistLabel?.removeFromParentNode()
    ghostDistLabel = nil
    
    onUpdate(["event": "point_removed", "count": currentPolygon.count])
  }

  func getShapes() -> [[String: Any]] {
    return closedShapes
  }
  
  func reset() {
    floorY = nil
    ceilingY = nil
    currentPolygon.removeAll()
    closedShapes.removeAll()
    allPlacedPoints.removeAll()
    
    ghostLineNode?.removeFromParentNode()
    ghostLineNode = nil
    ghostDistLabel?.removeFromParentNode()
    ghostDistLabel = nil
    
    pointNodes.forEach { $0.removeFromParentNode() }
    lineNodes.forEach { $0.removeFromParentNode() }
    labels.forEach { $0.removeFromParentNode() }
    
    pointNodes.removeAll()
    lineNodes.removeAll()
    labels.removeAll()
    
    onUpdate(["event": "reset"])
  }

  // MARK: - Mesh Color API
  func setMeshColor(hex: String) {
    meshUIColor = UIColor.fromHex(hex)
    scannerLightNode?.color = meshUIColor
  }

  // MARK: - Wire Toggle
  private var wireVisible: Bool = true
  
  func setShowWire(show: Bool) {
    wireVisible = show
    // Toggle scanner light (illuminates the mesh wireframe)
    scannerLightNode?.intensity = show ? 2000 : 0
    // Toggle visibility of all mesh wireframe nodes (categoryBitMask = 2)
    arView.scene.rootNode.enumerateChildNodes { node, _ in
      if node.categoryBitMask == 2 {
        node.isHidden = !show
      }
    }
  }

  // MARK: - RoomPlan Toggle
  private var roomPlanVisible: Bool = true
  
  func setShowRoomPlan(show: Bool) {
    roomPlanVisible = show
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController {
            rpc.setVisible(show)
        }
    }
    // Also toggle loaded bounding box gizmos (from Supabase)
    arView.scene.rootNode.enumerateChildNodes { node, _ in
      if node.name?.hasPrefix("gizmo_") == true {
        node.isHidden = !show
      }
    }
  }

  // MARK: - Mesh Export (OBJ)
  @available(iOS 13.4, *)
  func exportMesh() -> [String: Any] {
    guard let session = arView.session.currentFrame else {
      return ["error": "No AR frame available", "obj": "", "vertexCount": 0, "faceCount": 0, "byteSize": 0]
    }
    
    let anchors = session.anchors.compactMap { $0 as? ARMeshAnchor }
    guard !anchors.isEmpty else {
      return ["error": "No mesh data available. Scan the room first.", "obj": "", "vertexCount": 0, "faceCount": 0, "byteSize": 0]
    }
    
    var obj = "# MISS3 AR Mesh Export\n# Vertices: TBD, Faces: TBD\n\n"
    var totalVertices = 0
    var totalFaces = 0
    var vertexOffset = 0
    
    for anchor in anchors {
      let geometry = anchor.geometry
      let transform = anchor.transform
      
      // Vertices — transform to world space
      let vertexBuffer = geometry.vertices
      let vertexCount = vertexBuffer.count
      let vertexStride = vertexBuffer.stride
      let vertexData = vertexBuffer.buffer.contents()
      
      for i in 0..<vertexCount {
        let ptr = vertexData.advanced(by: i * vertexStride)
        let x = ptr.assumingMemoryBound(to: Float.self)[0]
        let y = ptr.assumingMemoryBound(to: Float.self)[1]
        let z = ptr.assumingMemoryBound(to: Float.self)[2]
        
        // Transform local vertex to world space
        let local = simd_float4(x, y, z, 1)
        let world = transform * local
        
        obj += "v \(world.x) \(world.y) \(world.z)\n"
      }
      totalVertices += vertexCount
      
      // Faces
      let faceBuffer = geometry.faces
      let faceCount = faceBuffer.count
      let indexBuffer = faceBuffer.buffer.contents()
      let bytesPerIndex = faceBuffer.bytesPerIndex
      
      for i in 0..<faceCount {
        let offset = i * 3
        var i0: Int, i1: Int, i2: Int
        
        if bytesPerIndex == 4 {
          let ptr = indexBuffer.assumingMemoryBound(to: UInt32.self)
          i0 = Int(ptr[offset]) + vertexOffset + 1     // OBJ is 1-indexed
          i1 = Int(ptr[offset + 1]) + vertexOffset + 1
          i2 = Int(ptr[offset + 2]) + vertexOffset + 1
        } else {
          let ptr = indexBuffer.assumingMemoryBound(to: UInt16.self)
          i0 = Int(ptr[offset]) + vertexOffset + 1
          i1 = Int(ptr[offset + 1]) + vertexOffset + 1
          i2 = Int(ptr[offset + 2]) + vertexOffset + 1
        }
        
        obj += "f \(i0) \(i1) \(i2)\n"
        totalFaces += 1
      }
      
      vertexOffset += vertexCount
    }
    
    let byteSize = obj.utf8.count
    
    return [
      "obj": obj,
      "vertexCount": totalVertices,
      "faceCount": totalFaces,
      "byteSize": byteSize
    ]
  }

  @available(iOS 13.4, *)
  func exportMeshChunks(maxSizeMB: Int = 10) -> [[String: Any]] {
    guard let session = arView.session.currentFrame else { return [["error": "No AR frame"]] }
    let anchors = session.anchors.compactMap { $0 as? ARMeshAnchor }
    guard !anchors.isEmpty else { return [["error": "No mesh data"]] }
    
    var chunks: [[String: Any]] = []
    let maxSize = maxSizeMB * 1024 * 1024
    
    var currentObj = "# MISS3 AR Mesh Export Chunk\n\n"
    var currentVertexOffset = 0
    var chunkVertexCount = 0
    var chunkFaceCount = 0
    
    for anchor in anchors {
      let geometry = anchor.geometry
      let transform = anchor.transform
      
      let vertexBuffer = geometry.vertices
      let vertexCount = vertexBuffer.count
      let vertexData = vertexBuffer.buffer.contents()
      let vertexStride = vertexBuffer.stride
      
      var anchorV = ""
      for i in 0..<vertexCount {
        let ptr = vertexData.advanced(by: i * vertexStride)
        let x = ptr.assumingMemoryBound(to: Float.self)[0]
        let y = ptr.assumingMemoryBound(to: Float.self)[1]
        let z = ptr.assumingMemoryBound(to: Float.self)[2]
        
        let local = simd_float4(x, y, z, 1)
        let world = transform * local
        anchorV += "v \(world.x) \(world.y) \(world.z)\n"
      }
      
      let faceBuffer = geometry.faces
      let faceCount = faceBuffer.count
      let indexBuffer = faceBuffer.buffer.contents()
      let bytesPerIndex = faceBuffer.bytesPerIndex
      
      var classificationPtr: UnsafeMutableRawPointer? = nil
      if #available(iOS 13.4, *) {
        if let classSource = geometry.classification {
          classificationPtr = classSource.buffer.contents()
        }
      }
      
      var groupedFaces: [UInt8: String] = [:]
      
      for i in 0..<faceCount {
        let offset = i * 3
        var i0: Int, i1: Int, i2: Int
        
        if bytesPerIndex == 4 {
          let ptr = indexBuffer.assumingMemoryBound(to: UInt32.self)
          i0 = Int(ptr[offset]) + currentVertexOffset + 1
          i1 = Int(ptr[offset + 1]) + currentVertexOffset + 1
          i2 = Int(ptr[offset + 2]) + currentVertexOffset + 1
        } else {
          let ptr = indexBuffer.assumingMemoryBound(to: UInt16.self)
          i0 = Int(ptr[offset]) + currentVertexOffset + 1
          i1 = Int(ptr[offset + 1]) + currentVertexOffset + 1
          i2 = Int(ptr[offset + 2]) + currentVertexOffset + 1
        }
        
        let classId = classificationPtr?.load(fromByteOffset: i, as: UInt8.self) ?? 0
        groupedFaces[classId, default: ""] += "f \(i0) \(i1) \(i2)\n"
      }
      
      var anchorF = ""
      for (classId, faces) in groupedFaces {
          var mtlName = "None"
          switch classId {
          case 1: mtlName = "Wall"
          case 2: mtlName = "Floor"
          case 3: mtlName = "Ceiling"
          case 4: mtlName = "Table"
          case 5: mtlName = "Seat"
          case 6: mtlName = "Window"
          case 7: mtlName = "Door"
          default: mtlName = "None"
          }
          anchorF += "usemtl \(mtlName)\n"
          anchorF += faces
      }
      
      let anchorStr = anchorV + anchorF
      
      if currentObj.utf8.count + anchorStr.utf8.count > maxSize && chunkVertexCount > 0 {
        chunks.append([
          "obj": currentObj,
          "vertexCount": chunkVertexCount,
          "faceCount": chunkFaceCount,
          "byteSize": currentObj.utf8.count
        ])
        
        currentObj = "# MISS3 AR Mesh Export Chunk\n\n"
        currentVertexOffset = 0
        chunkVertexCount = 0
        chunkFaceCount = 0
        
        // Recompute face strings for new 1-indexed chunk offset
        var groupedFacesNew: [UInt8: String] = [:]
        for i in 0..<faceCount {
          let offset = i * 3
          var i0: Int, i1: Int, i2: Int
          if bytesPerIndex == 4 {
            let ptr = indexBuffer.assumingMemoryBound(to: UInt32.self)
            i0 = Int(ptr[offset]) + 1
            i1 = Int(ptr[offset + 1]) + 1
            i2 = Int(ptr[offset + 2]) + 1
          } else {
            let ptr = indexBuffer.assumingMemoryBound(to: UInt16.self)
            i0 = Int(ptr[offset]) + 1
            i1 = Int(ptr[offset + 1]) + 1
            i2 = Int(ptr[offset + 2]) + 1
          }
          let classId = classificationPtr?.load(fromByteOffset: i, as: UInt8.self) ?? 0
          groupedFacesNew[classId, default: ""] += "f \(i0) \(i1) \(i2)\n"
        }
        
        anchorF = ""
        for (classId, faces) in groupedFacesNew {
            var mtlName = "None"
            switch classId {
            case 1: mtlName = "Wall"
            case 2: mtlName = "Floor"
            case 3: mtlName = "Ceiling"
            case 4: mtlName = "Table"
            case 5: mtlName = "Seat"
            case 6: mtlName = "Window"
            case 7: mtlName = "Door"
            default: mtlName = "None"
            }
            anchorF += "usemtl \(mtlName)\n"
            anchorF += faces
        }
      }
      
      currentObj += (anchorV + anchorF)
      currentVertexOffset += vertexCount
      chunkVertexCount += vertexCount
      chunkFaceCount += faceCount
    }
    
    if chunkVertexCount > 0 {
      chunks.append([
        "obj": currentObj,
        "vertexCount": chunkVertexCount,
        "faceCount": chunkFaceCount,
        "byteSize": currentObj.utf8.count
      ])
    }
    
    return chunks
  }

  func exportCADData() -> [String: Any] {
    guard let session = arView.session.currentFrame else { return ["error": "No AR frame"] }
    
    let planeAnchors = session.anchors.compactMap { $0 as? ARPlaneAnchor }
    var planes: [[String: Any]] = []
    
    for plane in planeAnchors {
      let alignment = plane.alignment == .horizontal ? "horizontal" : "vertical"
      let center = plane.center
      let extent = plane.extent
      let transform = plane.transform
      
      var classification = "None"
      if #available(iOS 12.0, *) {
          switch plane.classification {
          case .wall: classification = "Wall"
          case .floor: classification = "Floor"
          case .ceiling: classification = "Ceiling"
          case .table: classification = "Table"
          case .seat: classification = "Seat"
          case .window: classification = "Window"
          case .door: classification = "Door"
          default: classification = "None"
          }
      }
      
      planes.append([
        "identifier": plane.identifier.uuidString,
        "alignment": alignment,
        "classification": classification,
        "center": ["x": center.x, "y": center.y, "z": center.z],
        "extent": ["width": extent.x, "length": extent.z],
        "transform": [
            transform.columns.0.x, transform.columns.0.y, transform.columns.0.z, transform.columns.0.w,
            transform.columns.1.x, transform.columns.1.y, transform.columns.1.z, transform.columns.1.w,
            transform.columns.2.x, transform.columns.2.y, transform.columns.2.z, transform.columns.2.w,
            transform.columns.3.x, transform.columns.3.y, transform.columns.3.z, transform.columns.3.w
        ]
      ])
    }
    
    var boundingBoxes: [[String: Any]] = []
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController, let room = rpc.latestRoom {
            for obj in room.objects {
                var className = "unknown"
                switch obj.category {
                case .chair: className = "chair"
                case .table: className = "table"
                case .sofa: className = "sofa"
                case .bed: className = "bed"
                case .storage: className = "storage"
                case .refrigerator: className = "refrigerator"
                case .stove: className = "stove"
                case .oven: className = "oven"
                case .sink: className = "sink"
                case .washerDryer: className = "washerDryer"
                case .toilet: className = "toilet"
                case .bathtub: className = "bathtub"
                case .television: className = "television"
                default: className = "unknown"
                }
                let transform = obj.transform
                let dim = obj.dimensions
                boundingBoxes.append([
                    "identifier": obj.identifier.uuidString,
                    "class_name": className,
                    "position": ["x": transform.columns.3.x, "y": transform.columns.3.y, "z": transform.columns.3.z],
                    "dimensions": ["width": dim.x, "height": dim.y, "depth": dim.z],
                    "transform": [
                        transform.columns.0.x, transform.columns.0.y, transform.columns.0.z, transform.columns.0.w,
                        transform.columns.1.x, transform.columns.1.y, transform.columns.1.z, transform.columns.1.w,
                        transform.columns.2.x, transform.columns.2.y, transform.columns.2.z, transform.columns.2.w,
                        transform.columns.3.x, transform.columns.3.y, transform.columns.3.z, transform.columns.3.w
                    ]
                ])
            }
        }
    }
    
    return [
      "planes": planes,
      "bounding_boxes": boundingBoxes,
      "trajectory": cameraTrajectory
    ]
  }

  func saveWorldMap(promise: ExpoModulesCore.Promise) {
    arView.session.getCurrentWorldMap { worldMap, error in
      if let err = error {
        promise.reject("WORLDMAP_ERROR", err.localizedDescription)
        return
      }
      guard let map = worldMap else {
        promise.reject("WORLDMAP_ERROR", "Map is null")
        return
      }
      do {
        let data = try NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true)
        let tempUrl = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".map")
        try data.write(to: tempUrl)
        promise.resolve(tempUrl.path)
      } catch {
        promise.reject("WORLDMAP_ENCODE_ERROR", error.localizedDescription)
      }
    }
  }

  func loadWorldMap(url: String, promise: ExpoModulesCore.Promise) {
    // URL string passed from React Native (e.g. file://...)
    let fileUrl = URL(fileURLWithPath: url.replacingOccurrences(of: "file://", with: ""))
    do {
      let data = try Data(contentsOf: fileUrl)
      if let worldMap = try NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data) {
         let configuration = ARWorldTrackingConfiguration()
         configuration.planeDetection = [.horizontal, .vertical]
         if #available(iOS 13.4, *), ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
             configuration.sceneReconstruction = .mesh
         }
         configuration.initialWorldMap = worldMap
         
         arView.session.run(configuration, options: [.resetTracking])
         promise.resolve(true)
      } else {
         promise.reject("WORLDMAP_LOAD", "Failed to deserialize ARWorldMap")
      }
    } catch {
      promise.reject("WORLDMAP_READ", error.localizedDescription)
    }
  }

  // MARK: - Scene Anchors (Multi-Session Alignment)
  
  func addSceneAnchor(name: String, type: String) -> [String: Any]? {
    let camera = arView.session.currentFrame?.camera
    guard let transform = camera?.transform else { return nil }
    
    let position = transform.columns.3
    let rotation = camera?.eulerAngles ?? simd_float3(0, 0, 0)
    
    let anchorId = UUID().uuidString
    let anchor: [String: Any] = [
      "id": anchorId,
      "name": name,
      "type": type,
      "position_x": position.x,
      "position_y": position.y,
      "position_z": position.z,
      "rotation_x": rotation.x,
      "rotation_y": rotation.y,
      "rotation_z": rotation.z
    ]
    sceneAnchors.append(anchor)
    
    // Render visual marker
    let markerNode = createAnchorMarker(
      position: SCNVector3(position.x, position.y, position.z),
      name: name,
      type: type
    )
    arView.scene.rootNode.addChildNode(markerNode)
    sceneAnchorNodes.append(markerNode)
    
    print("[SceneAnchor] Added '\(name)' (\(type)) at (\(position.x), \(position.y), \(position.z))")
    return anchor
  }
  
  func exportSceneAnchors() -> [[String: Any]] {
    return sceneAnchors
  }
  
  func loadSceneAnchors(anchors: [[String: Any]]) -> Int {
    // Clear existing markers
    for node in sceneAnchorNodes {
      node.removeFromParentNode()
    }
    sceneAnchorNodes.removeAll()
    sceneAnchors.removeAll()
    
    var count = 0
    for anchor in anchors {
      let px = Float(anchor["position_x"] as? Double ?? 0)
      let py = Float(anchor["position_y"] as? Double ?? 0)
      let pz = Float(anchor["position_z"] as? Double ?? 0)
      let name = anchor["name"] as? String ?? "Anchor"
      let type = anchor["type"] as? String ?? "manual"
      
      sceneAnchors.append(anchor)
      
      let markerNode = createAnchorMarker(
        position: SCNVector3(px, py, pz),
        name: name,
        type: type
      )
      arView.scene.rootNode.addChildNode(markerNode)
      sceneAnchorNodes.append(markerNode)
      count += 1
    }
    print("[SceneAnchor] Loaded \(count) anchors")
    return count
  }
  
  func createAnchorMarker(position: SCNVector3, name: String, type: String) -> SCNNode {
    let container = SCNNode()
    container.position = position
    
    // Color by type
    let color: UIColor
    switch type {
    case "manual":          color = UIColor(red: 0.2, green: 0.9, blue: 0.3, alpha: 1.0) // green
    case "auto":            color = UIColor(red: 0.3, green: 0.6, blue: 1.0, alpha: 1.0) // blue
    case "roomplan_corner": color = UIColor(red: 1.0, green: 0.6, blue: 0.2, alpha: 1.0) // orange
    default:                color = UIColor.white
    }
    
    // Sphere marker
    let sphere = SCNSphere(radius: 0.03)
    sphere.firstMaterial?.diffuse.contents = color
    sphere.firstMaterial?.emission.contents = color.withAlphaComponent(0.5)
    sphere.firstMaterial?.lightingModel = .constant
    let sphereNode = SCNNode(geometry: sphere)
    container.addChildNode(sphereNode)
    
    // Pulsing ring
    let ring = SCNTorus(ringRadius: 0.05, pipeRadius: 0.003)
    ring.firstMaterial?.diffuse.contents = color.withAlphaComponent(0.6)
    ring.firstMaterial?.emission.contents = color.withAlphaComponent(0.3)
    ring.firstMaterial?.lightingModel = .constant
    let ringNode = SCNNode(geometry: ring)
    container.addChildNode(ringNode)
    
    // Vertical line (pole) for visibility
    let pole = SCNCylinder(radius: 0.002, height: 0.15)
    pole.firstMaterial?.diffuse.contents = color.withAlphaComponent(0.4)
    pole.firstMaterial?.lightingModel = .constant
    let poleNode = SCNNode(geometry: pole)
    poleNode.position = SCNVector3(0, 0.075, 0)
    container.addChildNode(poleNode)
    
    // Billboard label
    let emoji: String
    switch type {
    case "manual":          emoji = "📌"
    case "auto":            emoji = "🔵"
    case "roomplan_corner": emoji = "🔶"
    default:                emoji = "⚓"
    }
    let textGeo = SCNText(string: "\(emoji) \(name)", extrusionDepth: 0.0)
    textGeo.font = UIFont.systemFont(ofSize: 4, weight: .semibold)
    textGeo.firstMaterial?.diffuse.contents = UIColor.white
    textGeo.firstMaterial?.emission.contents = color.withAlphaComponent(0.4)
    textGeo.firstMaterial?.lightingModel = .constant
    let textNode = SCNNode(geometry: textGeo)
    textNode.scale = SCNVector3(0.01, 0.01, 0.01)
    textNode.position = SCNVector3(0, 0.18, 0)
    textNode.constraints = [SCNBillboardConstraint()]
    
    // Center text
    let (bMin, bMax) = textNode.boundingBox
    textNode.pivot = SCNMatrix4MakeTranslation(
      bMin.x + 0.5 * (bMax.x - bMin.x),
      bMin.y + 0.5 * (bMax.y - bMin.y), 0
    )
    container.addChildNode(textNode)
    
    container.name = "scene_anchor_\(name)"
    return container
  }

  // MARK: - Export RoomPlan structured data
  func exportRoomPlanData() -> [String: Any] {
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController {
            return rpc.exportRoomPlanData()
        }
    }
    return [:]
  }

  // MARK: - Finalize RoomPlan (RoomBuilder ML post-processing)
  func finalizeRoomPlan() {
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController {
            rpc.finalizeRoom()
        }
    }
  }

  // MARK: - Export individual RoomPlan elements with UUIDs
  func exportRoomPlanElements() -> [[String: Any]] {
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController {
            return rpc.exportRoomPlanElements()
        }
    }
    return []
  }

  // MARK: - Start Room Scan (shared AR session for correct coordinates)
  func startRoomScan() {
    print("[RoomPlan] startRoomScan() called — roomPlanController is nil? \(roomPlanController == nil)")
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController {
            rpc.start(arSession: arView.session)
            print("[RoomPlan] ✅ User started room scan (shared AR session)")
        } else {
            print("[RoomPlan] ❌ roomPlanController cast failed — creating new one")
            let rpc = RoomPlanController()
            rpc.sceneView = arView
            self.roomPlanController = rpc
            rpc.start(arSession: arView.session)
            print("[RoomPlan] ✅ Created new RoomPlanController and started scan")
        }
    } else {
        print("[RoomPlan] ❌ iOS 16+ not available")
    }
  }

  // MARK: - Stop Room Scan (triggers finalization)
  func stopRoomScan() {
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController {
            rpc.stop()
            print("[RoomPlan] User stopped room scan — finalization will auto-trigger")
            
            // Resume ARWorldTracking to prevent the camera from freezing
            let configuration = ARWorldTrackingConfiguration()
            configuration.planeDetection = [.horizontal, .vertical]
            if #available(iOS 13.4, *), ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
                configuration.sceneReconstruction = .mesh
            }
            arView.session.run(configuration)
        }
    }
  }

  // MARK: - Pause/Resume Room Scan (for Object Detail Capture)
  private var isRoomPaused = false

  func pauseRoomScan() -> Bool {
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController, rpc.session != nil {
            // RoomCaptureSession doesn't have pause(), so we stop and flag for resume
            isRoomPaused = true
            print("[RoomPlan] ⏸ Room scan PAUSED (flagged for resume)")
            return true
        }
    }
    return false
  }
  
  func resumeRoomScan() -> Bool {
    if #available(iOS 16.0, *) {
        if isRoomPaused {
            isRoomPaused = false
            // Restart the room scan session using shared AR session
            if let rpc = roomPlanController as? RoomPlanController {
                let config = RoomCaptureSession.Configuration()
                rpc.session?.run(configuration: config)
                print("[RoomPlan] ▶ Room scan RESUMED")
                return true
            }
        }
    }
    return false
  }
  
  // MARK: - Get Camera Transform (4x4 matrix as flat array)
  func getCameraTransform() -> [Float]? {
    guard let frame = arView.session.currentFrame else { return nil }
    let t = frame.camera.transform
    return [
      t.columns.0.x, t.columns.0.y, t.columns.0.z, t.columns.0.w,
      t.columns.1.x, t.columns.1.y, t.columns.1.z, t.columns.1.w,
      t.columns.2.x, t.columns.2.y, t.columns.2.z, t.columns.2.w,
      t.columns.3.x, t.columns.3.y, t.columns.3.z, t.columns.3.w,
    ]
  }

  // MARK: - Load Shapes from Supabase
  func loadShapes(shapes: [[String: Any]]) -> Int {
    var count = 0
    for shape in shapes {
      guard let payload = shape["payload"] as? [String: Any] else { continue }
      let shapeType = payload["type"] as? String ?? "floor"
      
      let color: UIColor
      switch shapeType {
      case "wall": color = wallPink
      case "free", "line", "polyline": color = freeOrange
      default: color = tronBlue
      }
      
      if ["cube", "cylinder", "sphere"].contains(shapeType) {
          guard let positionDict = payload["position"] as? [String: Any],
                let rotationDict = payload["rotation"] as? [String: Any],
                let scaleDict = payload["scale"] as? [String: Any] else { continue }
          
          let px = Float(positionDict["x"] as? Double ?? 0)
          let py = Float(positionDict["y"] as? Double ?? 0)
          let pz = Float(positionDict["z"] as? Double ?? 0)
          
          let rx = Float(rotationDict["x"] as? Double ?? 0)
          let ry = Float(rotationDict["y"] as? Double ?? 0)
          let rz = Float(rotationDict["z"] as? Double ?? 0)
          
          let sx = Float(scaleDict["x"] as? Double ?? 1)
          let sy = Float(scaleDict["y"] as? Double ?? 1)
          let sz = Float(scaleDict["z"] as? Double ?? 1)
          
          let geo: SCNGeometry
          switch shapeType {
          case "cube":   geo = SCNBox(width: 1, height: 1, length: 1, chamferRadius: 0)
          case "sphere": geo = SCNSphere(radius: 0.5)
          case "cylinder": geo = SCNCylinder(radius: 0.5, height: 1)
          default:       geo = SCNBox(width: 1, height: 1, length: 1, chamferRadius: 0)
          }
          
          geo.firstMaterial?.diffuse.contents = color.withAlphaComponent(0.8)
          geo.firstMaterial?.isDoubleSided = true
          geo.firstMaterial?.lightingModel = .lambert
          
          let node = SCNNode(geometry: geo)
          node.position = SCNVector3(px, py, pz)
          node.eulerAngles = SCNVector3(rx, ry, rz)
          node.scale = SCNVector3(sx, sy, sz)
          
          arView.scene.rootNode.addChildNode(node)
          count += 1
          continue
      }
      
      guard let pointsArr = payload["points"] as? [[String: Any]] else { continue }
      
      var positions: [SCNVector3] = []
      for pt in pointsArr {
        let x = (pt["x"] as? Float) ?? Float(pt["x"] as? Double ?? 0)
        let y = (pt["y"] as? Float) ?? Float(pt["y"] as? Double ?? 0)
        let z = (pt["z"] as? Float) ?? Float(pt["z"] as? Double ?? 0)
        positions.append(SCNVector3(x, y, z))
      }
      
      // Draw points and lines
      for (i, pos) in positions.enumerated() {
        drawSphere(at: pos, color: color)
        if i > 0 {
          drawLine(from: positions[i-1], to: pos, color: color)
        }
      }
      
      // Close shape if it was a closed polygon (>= 3 points, type floor/wall)
      if positions.count >= 3 && (shapeType == "floor" || shapeType == "wall") {
        drawLine(from: positions.last!, to: positions.first!, color: color)
      }
      
      // Extrusion for 3D walls
      if let extrudeH = payload["extrusionHeight"] as? Double, extrudeH > 0 {
        let wallHeight = Float(extrudeH)
        let wallColor = color.withAlphaComponent(0.6)
        
        func buildWall(p1: SCNVector3, p2: SCNVector3) {
            let dx = p2.x - p1.x
            let dz = p2.z - p1.z
            let length = sqrt(dx*dx + dz*dz)
            guard length > 0.001 else { return }
            
            let box = SCNBox(width: CGFloat(length), height: CGFloat(wallHeight), length: 0.02, chamferRadius: 0)
            box.firstMaterial?.diffuse.contents = wallColor
            box.firstMaterial?.isDoubleSided = true
            box.firstMaterial?.lightingModel = .lambert
            
            let node = SCNNode(geometry: box)
            // Midpoint
            node.position = SCNVector3((p1.x + p2.x)/2, p1.y + wallHeight/2, (p1.z + p2.z)/2)
            // Rotation (yaw)
            node.eulerAngles.y = atan2(dx, dz) - Float.pi / 2
            
            arView.scene.rootNode.addChildNode(node)
            // Add to a collection if needed, or just let them be child nodes.
        }
        
        for i in 1..<positions.count {
            buildWall(p1: positions[i-1], p2: positions[i])
        }
        if positions.count >= 3 && (shapeType == "floor" || shapeType == "wall") {
            buildWall(p1: positions.last!, p2: positions.first!)
        }
      }
      
      // Draw area/length label at centroid
      if let area = payload["area"] as? Double, positions.count > 0 {
        let cx = positions.reduce(Float(0)) { $0 + $1.x } / Float(positions.count)
        let cy = positions.reduce(Float(0)) { $0 + $1.y } / Float(positions.count)
        let cz = positions.reduce(Float(0)) { $0 + $1.z } / Float(positions.count)
        drawText(text: String(format: "%.2f m²", area), at: SCNVector3(cx, cy + 0.05, cz), scale: 0.004)
      }
      
      count += 1
    }
    return count
    return count
  }
  
  // MARK: - Helper: Thick Wireframe Box
  func createThickWireframeBox(width w: Float, height h: Float, length d: Float, thickness: Float, color: UIColor) -> SCNNode {
      let root = SCNNode()
      let hw = w / 2
      let hh = h / 2
      let hd = d / 2
      let t = CGFloat(thickness)
      
      func addBoxEdge(w2: Float, h2: Float, d2: Float, x: Float, y: Float, z: Float) {
          let boxGeo = SCNBox(width: CGFloat(w2), height: CGFloat(h2), length: CGFloat(d2), chamferRadius: 0)
          boxGeo.firstMaterial?.diffuse.contents = color
          boxGeo.firstMaterial?.lightingModel = .constant
          boxGeo.firstMaterial?.readsFromDepthBuffer = false
          let node = SCNNode(geometry: boxGeo)
          node.position = SCNVector3(x, y, z)
          root.addChildNode(node)
      }
      
      // 4 edges parallel to X
      addBoxEdge(w2: w, h2: Float(t), d2: Float(t), x: 0, y: -hh, z: -hd)
      addBoxEdge(w2: w, h2: Float(t), d2: Float(t), x: 0, y: -hh, z:  hd)
      addBoxEdge(w2: w, h2: Float(t), d2: Float(t), x: 0, y:  hh, z: -hd)
      addBoxEdge(w2: w, h2: Float(t), d2: Float(t), x: 0, y:  hh, z:  hd)
      
      // 4 edges parallel to Y
      addBoxEdge(w2: Float(t), h2: h, d2: Float(t), x: -hw, y: 0, z: -hd)
      addBoxEdge(w2: Float(t), h2: h, d2: Float(t), x:  hw, y: 0, z: -hd)
      addBoxEdge(w2: Float(t), h2: h, d2: Float(t), x: -hw, y: 0, z:  hd)
      addBoxEdge(w2: Float(t), h2: h, d2: Float(t), x:  hw, y: 0, z:  hd)
      
      // 4 edges parallel to Z
      addBoxEdge(w2: Float(t), h2: Float(t), d2: d, x: -hw, y: -hh, z: 0)
      addBoxEdge(w2: Float(t), h2: Float(t), d2: d, x:  hw, y: -hh, z: 0)
      addBoxEdge(w2: Float(t), h2: Float(t), d2: d, x: -hw, y:  hh, z: 0)
      addBoxEdge(w2: Float(t), h2: Float(t), d2: d, x:  hw, y:  hh, z: 0)
      
      return root
  }

  // MARK: - Load Bounding Boxes (RoomPlan gizmos)
  func loadBoundingBoxes(boxes: [[String: Any]]) -> Int {
    var count = 0
    for box in boxes {
      let className = box["class_name"] as? String ?? "unknown"
      let px = Float(box["position_x"] as? Double ?? 0)
      let py = Float(box["position_y"] as? Double ?? 0)
      let pz = Float(box["position_z"] as? Double ?? 0)
      let w = Float(box["width"] as? Double ?? 0.5)
      let h = Float(box["height"] as? Double ?? 0.5)
      let d = Float(box["depth"] as? Double ?? 0.5)
      
      // Color based on classification
      let color: UIColor
      switch className {
      case "window": color = UIColor.cyan
      case "door": color = UIColor.orange
      case "chair", "seat": color = UIColor.yellow
      case "table": color = UIColor.green
      case "bed": color = UIColor.purple
      case "sofa": color = UIColor(red: 0.8, green: 0.4, blue: 0.1, alpha: 1.0)
      case "storage": color = UIColor.brown
      case "television": color = UIColor.blue
      default: color = UIColor.white
      }
      
      // Create thick wireframe box (10x thicker edges, approx 0.015m)
      let boxNode = createThickWireframeBox(width: w, height: h, length: d, thickness: 0.015, color: color)
      boxNode.position = SCNVector3(px, py, pz)
      boxNode.renderingOrder = 90
      boxNode.name = "gizmo_\(className)_\(count)"
      
      // Apply transform if available
      if let transformArr = box["payload"] as? [Double], transformArr.count == 16 {
        var m = SCNMatrix4Identity
        m.m11 = Float(transformArr[0]); m.m12 = Float(transformArr[1]); m.m13 = Float(transformArr[2]); m.m14 = Float(transformArr[3])
        m.m21 = Float(transformArr[4]); m.m22 = Float(transformArr[5]); m.m23 = Float(transformArr[6]); m.m24 = Float(transformArr[7])
        m.m31 = Float(transformArr[8]); m.m32 = Float(transformArr[9]); m.m33 = Float(transformArr[10]); m.m34 = Float(transformArr[11])
        m.m41 = Float(transformArr[12]); m.m42 = Float(transformArr[13]); m.m43 = Float(transformArr[14]); m.m44 = Float(transformArr[15])
        boxNode.transform = m
      }
      
      arView.scene.rootNode.addChildNode(boxNode)
      
      // Add label above the box
      drawText(text: className.uppercased(), at: SCNVector3(px, py + h/2 + 0.05, pz), scale: 0.003)
      
      count += 1
    }
    return count
  }

  // MARK: - Load Remote Collaboration Objects (Proxy Rendering)
  func loadRemoteObjects(objects: [[String: Any]]) -> Int {
    // Clear previously placed remote objects
    for node in remoteObjectNodes {
      node.removeFromParentNode()
    }
    remoteObjectNodes.removeAll()
    
    var count = 0
    for obj in objects {
      guard let type = obj["type"] as? String else { continue }
      
      let px = Float(obj["x"] as? Double ?? 0)
      let py = Float(obj["y"] as? Double ?? 0)
      let pz = Float(obj["z"] as? Double ?? 0)
      let name = obj["name"] as? String ?? "Object"
      
      if type == "model" {
        // Draw Proxy Bounding Box for .glb models
        let boxGeo = SCNBox(width: 0.3, height: 0.3, length: 0.3, chamferRadius: 0.02)
        boxGeo.firstMaterial?.fillMode = .lines
        boxGeo.firstMaterial?.diffuse.contents = UIColor.magenta.withAlphaComponent(0.8)
        boxGeo.firstMaterial?.lightingModel = .constant
        boxGeo.firstMaterial?.isDoubleSided = true
        
        let boxNode = SCNNode(geometry: boxGeo)
        boxNode.position = SCNVector3(px, py + 0.15, pz) // elevate so it sits on floor
        boxNode.renderingOrder = 95
        
        // Label
        let textGeo = SCNText(string: "🌍 [Web Operator]\n" + name, extrusionDepth: 0.0)
        textGeo.font = UIFont.systemFont(ofSize: 4)
        textGeo.firstMaterial?.diffuse.contents = UIColor.white
        textGeo.firstMaterial?.lightingModel = .constant
        let textNode = SCNNode(geometry: textGeo)
        textNode.scale = SCNVector3(0.01, 0.01, 0.01)
        textNode.position = SCNVector3(0, 0.25, 0)
        let bc = SCNBillboardConstraint()
        textNode.constraints = [bc]
        
        // Center text pivot
        let (bMin, bMax) = textNode.boundingBox
        textNode.pivot = SCNMatrix4MakeTranslation(
          bMin.x + 0.5*(bMax.x - bMin.x),
          bMin.y + 0.5*(bMax.y - bMin.y),
          0
        )
        
        boxNode.addChildNode(textNode)
        arView.scene.rootNode.addChildNode(boxNode)
        remoteObjectNodes.append(boxNode)
        count += 1
      } else if ["cube", "cylinder", "sphere"].contains(type) {
        // Web editor primitives (position/rotation/scale)
        guard let posDict = obj["position"] as? [String: Any],
              let rotDict = obj["rotation"] as? [String: Any],
              let scaleDict = obj["scale"] as? [String: Any] else { continue }
        
        let primPx = Float(posDict["x"] as? Double ?? 0)
        let primPy = Float(posDict["y"] as? Double ?? 0)
        let primPz = Float(posDict["z"] as? Double ?? 0)
        let primRx = Float(rotDict["x"] as? Double ?? 0)
        let primRy = Float(rotDict["y"] as? Double ?? 0)
        let primRz = Float(rotDict["z"] as? Double ?? 0)
        let primSx = Float(scaleDict["x"] as? Double ?? 1)
        let primSy = Float(scaleDict["y"] as? Double ?? 1)
        let primSz = Float(scaleDict["z"] as? Double ?? 1)
        
        let geo: SCNGeometry
        switch type {
        case "cube":     geo = SCNBox(width: 1, height: 1, length: 1, chamferRadius: 0)
        case "sphere":   geo = SCNSphere(radius: 0.5)
        case "cylinder": geo = SCNCylinder(radius: 0.5, height: 1)
        default:         geo = SCNBox(width: 1, height: 1, length: 1, chamferRadius: 0)
        }
        
        let primColor = UIColor.cyan.withAlphaComponent(0.6)
        geo.firstMaterial?.diffuse.contents = primColor
        geo.firstMaterial?.isDoubleSided = true
        geo.firstMaterial?.lightingModel = .lambert
        
        let primNode = SCNNode(geometry: geo)
        primNode.position = SCNVector3(primPx, primPy, primPz)
        primNode.eulerAngles = SCNVector3(primRx, primRy, primRz)
        primNode.scale = SCNVector3(primSx, primSy, primSz)
        
        // Label
        let primText = SCNText(string: "🌍 [Web]\n\(type.capitalized)", extrusionDepth: 0.0)
        primText.font = UIFont.systemFont(ofSize: 4)
        primText.firstMaterial?.diffuse.contents = UIColor.white
        primText.firstMaterial?.lightingModel = .constant
        let primTextNode = SCNNode(geometry: primText)
        primTextNode.scale = SCNVector3(0.01, 0.01, 0.01)
        primTextNode.position = SCNVector3(0, Float(primSy) * 0.5 + 0.15, 0)
        primTextNode.constraints = [SCNBillboardConstraint()]
        let (bMin2, bMax2) = primTextNode.boundingBox
        primTextNode.pivot = SCNMatrix4MakeTranslation(
          bMin2.x + 0.5*(bMax2.x - bMin2.x),
          bMin2.y + 0.5*(bMax2.y - bMin2.y), 0
        )
        primNode.addChildNode(primTextNode)
        
        arView.scene.rootNode.addChildNode(primNode)
        remoteObjectNodes.append(primNode)
        count += 1
      } else if type == "polygon" || type == "polyline" {
        guard let points = obj["points"] as? [[String: Any]] else { continue }
        
        let shapeColor = UIColor.orange
        var positions: [SCNVector3] = []
        for pt in points {
          let cx = (pt["x"] as? Float) ?? Float(pt["x"] as? Double ?? 0)
          let cy = (pt["y"] as? Float) ?? Float(pt["y"] as? Double ?? 0)
          let cz = (pt["z"] as? Float) ?? Float(pt["z"] as? Double ?? 0)
          positions.append(SCNVector3(cx, cy, cz))
        }
        
        // 1) Draw Base Lines
        func addRemoteLine(p1: SCNVector3, p2: SCNVector3) {
            let dx = p2.x - p1.x
            let dz = p2.z - p1.z
            let len = sqrt(dx*dx + dz*dz)
            guard len > 0.001 else { return }
            
            let lineBox = SCNBox(width: 0.01, height: 0.01, length: CGFloat(len), chamferRadius: 0)
            lineBox.firstMaterial?.diffuse.contents = shapeColor
            lineBox.firstMaterial?.lightingModel = .constant
            let lineNode = SCNNode(geometry: lineBox)
            lineNode.position = SCNVector3((p1.x+p2.x)/2, p1.y, (p1.z+p2.z)/2)
            lineNode.eulerAngles.y = atan2(dx, dz)
            
            arView.scene.rootNode.addChildNode(lineNode)
            remoteObjectNodes.append(lineNode)
        }
        
        for i in 1..<positions.count { addRemoteLine(p1: positions[i-1], p2: positions[i]) }
        if type == "polygon" && positions.count >= 3 { addRemoteLine(p1: positions.last!, p2: positions.first!) }
        
        // 2) Draw 3D Extrusion Wall
        if let extrudeH = obj["extrusionHeight"] as? Double, extrudeH > 0 {
            let wallHeight = Float(extrudeH)
            func buildWall(p1: SCNVector3, p2: SCNVector3) {
                let dx = p2.x - p1.x
                let dz = p2.z - p1.z
                let length = sqrt(dx*dx + dz*dz)
                guard length > 0.001 else { return }
                
                let box = SCNBox(width: CGFloat(length), height: CGFloat(wallHeight), length: 0.02, chamferRadius: 0)
                box.firstMaterial?.diffuse.contents = shapeColor.withAlphaComponent(0.6)
                box.firstMaterial?.isDoubleSided = true
                box.firstMaterial?.lightingModel = .lambert
                
                let node = SCNNode(geometry: box)
                node.position = SCNVector3((p1.x + p2.x)/2, p1.y + wallHeight/2, (p1.z + p2.z)/2)
                node.eulerAngles.y = atan2(dx, dz) - Float.pi / 2
                
                arView.scene.rootNode.addChildNode(node)
                remoteObjectNodes.append(node)
            }
            
            for i in 1..<positions.count { buildWall(p1: positions[i-1], p2: positions[i]) }
            if type == "polygon" && positions.count >= 3 { buildWall(p1: positions.last!, p2: positions.first!) }
        }
        
        // 3) Add Label for the shape
        if let first = positions.first {
            let shapeName = name == "Object" ? type.capitalized : name
            let textGeo = SCNText(string: "🌍 [Web Operator]\n" + shapeName, extrusionDepth: 0.0)
            textGeo.font = UIFont.systemFont(ofSize: 4)
            textGeo.firstMaterial?.diffuse.contents = UIColor.white
            textGeo.firstMaterial?.lightingModel = .constant
            let textNode = SCNNode(geometry: textGeo)
            textNode.scale = SCNVector3(0.01, 0.01, 0.01)
            let hOffset: Float = (obj["extrusionHeight"] as? Double ?? 0) > 0 ? Float(obj["extrusionHeight"] as! Double) + 0.15 : 0.15
            textNode.position = SCNVector3(first.x, first.y + hOffset, first.z)
            
            let bc = SCNBillboardConstraint()
            textNode.constraints = [bc]
            
            let (bMin, bMax) = textNode.boundingBox
            textNode.pivot = SCNMatrix4MakeTranslation(
              bMin.x + 0.5*(bMax.x - bMin.x),
              bMin.y + 0.5*(bMax.y - bMin.y),
              0
            )
            arView.scene.rootNode.addChildNode(textNode)
            remoteObjectNodes.append(textNode)
        }
        
        count += 1
      }
    }
    return count
  }

  // MARK: - Drawing Mode
  func setDrawingMode(mode: String) {
    if let dm = DrawingMode(rawValue: mode) {
      drawingMode = dm
      onUpdate(["event": "mode_changed", "mode": mode])
    }
  }

  // MARK: - Auto Edge Detection
  @available(iOS 13.4, *)
  func detectEdges(threshold: Float) -> [String: Any] {
    guard let frame = arView.session.currentFrame else {
      return ["error": "No AR frame", "edgeCount": 0]
    }
    
    let thresholdRad = threshold * Float.pi / 180.0  // degrees to radians
    let anchors = frame.anchors.compactMap { $0 as? ARMeshAnchor }
    guard !anchors.isEmpty else {
      return ["error": "No mesh data. Scan the room first.", "edgeCount": 0]
    }
    
    // Clear previous detections
    clearEdges()
    
    var edgeSegments: [(SCNVector3, SCNVector3)] = []
    
    for anchor in anchors {
      let geo = anchor.geometry
      let transform = anchor.transform
      let vertBuf = geo.vertices
      let faceBuf = geo.faces
      let vertCount = vertBuf.count
      let faceCount = faceBuf.count
      let vertStride = vertBuf.stride
      let vertData = vertBuf.buffer.contents()
      let idxData = faceBuf.buffer.contents()
      let bpi = faceBuf.bytesPerIndex
      
      // Build world-space vertices
      var worldVerts: [SCNVector3] = []
      worldVerts.reserveCapacity(vertCount)
      for i in 0..<vertCount {
        let ptr = vertData.advanced(by: i * vertStride)
        let x = ptr.assumingMemoryBound(to: Float.self)[0]
        let y = ptr.assumingMemoryBound(to: Float.self)[1]
        let z = ptr.assumingMemoryBound(to: Float.self)[2]
        let local = simd_float4(x, y, z, 1)
        let world = transform * local
        worldVerts.append(SCNVector3(world.x, world.y, world.z))
      }
      
      // Build face normals and index triples
      struct FaceInfo {
        let i0: Int, i1: Int, i2: Int
        let normal: SCNVector3
      }
      var faces: [FaceInfo] = []
      faces.reserveCapacity(faceCount)
      
      for f in 0..<faceCount {
        let off = f * 3
        let idx0: Int, idx1: Int, idx2: Int
        if bpi == 4 {
          let ptr = idxData.assumingMemoryBound(to: UInt32.self)
          idx0 = Int(ptr[off]); idx1 = Int(ptr[off+1]); idx2 = Int(ptr[off+2])
        } else {
          let ptr = idxData.assumingMemoryBound(to: UInt16.self)
          idx0 = Int(ptr[off]); idx1 = Int(ptr[off+1]); idx2 = Int(ptr[off+2])
        }
        
        let v0 = worldVerts[idx0], v1 = worldVerts[idx1], v2 = worldVerts[idx2]
        let e1 = SCNVector3(v1.x-v0.x, v1.y-v0.y, v1.z-v0.z)
        let e2 = SCNVector3(v2.x-v0.x, v2.y-v0.y, v2.z-v0.z)
        let n = crossProduct(v1: e1, v2: e2)
        let len = sqrt(n.x*n.x + n.y*n.y + n.z*n.z)
        let normal = len > 0.0001 ? SCNVector3(n.x/len, n.y/len, n.z/len) : SCNVector3(0,1,0)
        faces.append(FaceInfo(i0: idx0, i1: idx1, i2: idx2, normal: normal))
      }
      
      // Build edge-to-face adjacency map
      // Edge key = sorted pair of vertex indices
      var edgeToFaces: [String: [Int]] = [:]
      for (fi, face) in faces.enumerated() {
        let edges = [
          [min(face.i0,face.i1), max(face.i0,face.i1)],
          [min(face.i1,face.i2), max(face.i1,face.i2)],
          [min(face.i0,face.i2), max(face.i0,face.i2)]
        ]
        for e in edges {
          let key = "\(e[0])-\(e[1])"
          if edgeToFaces[key] == nil { edgeToFaces[key] = [] }
          edgeToFaces[key]!.append(fi)
        }
      }
      
      // Find edges where adjacent faces have normal angle > threshold
      for (key, faceIndices) in edgeToFaces {
        guard faceIndices.count == 2 else { continue }
        let n1 = faces[faceIndices[0]].normal
        let n2 = faces[faceIndices[1]].normal
        let dot = n1.x*n2.x + n1.y*n2.y + n1.z*n2.z
        let angle = acos(max(-1, min(1, dot)))
        
        if angle > thresholdRad {
          let parts = key.split(separator: "-")
          let vi0 = Int(parts[0])!
          let vi1 = Int(parts[1])!
          edgeSegments.append((worldVerts[vi0], worldVerts[vi1]))
        }
      }
    }
    
    // Render detected edges as yellow lines
    let edgeColor = measureYellow
    for (p0, p1) in edgeSegments {
      let lineNode = createLineBetween(from: p0, to: p1, color: edgeColor, width: 0.003)
      arView.scene.rootNode.addChildNode(lineNode)
      detectedEdgeNodes.append(lineNode)
    }
    
    // Chain segments into polylines (simplified)
    detectedEdgePolylines = chainEdgeSegments(edgeSegments)
    
    onUpdate(["event": "edges_detected", "edgeCount": edgeSegments.count, "polylineCount": detectedEdgePolylines.count])
    
    return [
      "edgeCount": edgeSegments.count,
      "polylineCount": detectedEdgePolylines.count
    ]
  }

  /// Confirm detected edges → save as polyline shapes
  func confirmEdges() -> [[String: Any]] {
    var confirmed: [[String: Any]] = []
    for polyline in detectedEdgePolylines {
      let shapeNumber = closedShapes.count + 1
      let totalLen = computePolylineLength(polyline)
      let shapeData: [String: Any] = [
        "shapeNumber": shapeNumber,
        "type": "edge",
        "area": 0,
        "totalLength": totalLen,
        "segmentCount": max(0, polyline.count - 1),
        "points": polyline,
        "height": abs((ceilingY ?? 0) - (floorY ?? 0)),
        "autoDetected": true
      ]
      closedShapes.append(shapeData)
      confirmed.append(shapeData)
    }
    // Keep visual lines, clear state
    detectedEdgePolylines.removeAll()
    onUpdate(["event": "edges_confirmed", "count": confirmed.count])
    return confirmed
  }

  /// Clear detected edges (reject)
  func clearEdges() {
    for node in detectedEdgeNodes {
      node.removeFromParentNode()
    }
    detectedEdgeNodes.removeAll()
    detectedEdgePolylines.removeAll()
  }

  // MARK: - Cut Room

  /// Activate/deactivate cutting plane
  func setCutActive(active: Bool, type: String) {
    cutActive = active
    cutType = type
    
    if active {
      // Default position: center of room
      let fy = floorY ?? 0
      let cy = ceilingY ?? (fy + 2.5)
      cutPlaneHeight = (fy + cy) / 2
      cutPlaneRotation = 0
      
      showCutPlane()
      performCut()
    } else {
      hideCutPlane()
    }
    
    onUpdate(["event": "cut_active", "active": active, "type": type])
  }

  /// Move the horizontal cutting plane to a given Y
  func setCutHeight(height: Float) {
    cutPlaneHeight = height
    updateCutPlanePosition()
    performCut()
  }

  /// Rotate the vertical cutting plane (degrees around Z)
  func setCutRotation(degrees: Float) {
    cutPlaneRotation = degrees * Float.pi / 180.0
    updateCutPlanePosition()
    performCut()
  }

  /// Get current cut result
  func getCutResult() -> [String: Any] {
    var totalLength: Float = 0
    for i in 0..<max(0, cutResultPolyline.count - 1) {
      let p0 = cutResultPolyline[i], p1 = cutResultPolyline[i+1]
      let dx = (p1["x"] ?? 0) - (p0["x"] ?? 0)
      let dy = (p1["y"] ?? 0) - (p0["y"] ?? 0)
      let dz = (p1["z"] ?? 0) - (p0["z"] ?? 0)
      totalLength += sqrt(dx*dx + dy*dy + dz*dz)
    }
    return [
      "cutType": cutType,
      "planeHeight": cutPlaneHeight,
      "planeRotation": cutPlaneRotation * 180.0 / Float.pi,
      "polyline": cutResultPolyline,
      "totalLength": totalLength,
      "segmentCount": max(0, cutResultPolyline.count - 1),
      "pointCount": cutResultPolyline.count
    ]
  }

  /// Clear cut
  func clearCut() {
    hideCutPlane()
    cutActive = false
    cutResultPolyline.removeAll()
    for node in cutPolylineNodes { node.removeFromParentNode() }
    cutPolylineNodes.removeAll()
  }

  // -- Private Cut helpers --

  private func showCutPlane() {
    cutPlaneNode?.removeFromParentNode()
    
    // Create semi-transparent cutting plane (2m x 2m)
    let planeSize: CGFloat = 4.0
    let plane = SCNPlane(width: planeSize, height: planeSize)
    let material = SCNMaterial()
    material.diffuse.contents = UIColor(red: 1.0, green: 0.3, blue: 0.1, alpha: 0.15)
    material.emission.contents = UIColor(red: 1.0, green: 0.3, blue: 0.1, alpha: 0.3)
    material.lightingModel = .constant
    material.isDoubleSided = true
    material.blendMode = .add
    plane.firstMaterial = material
    
    let node = SCNNode(geometry: plane)
    node.name = "cutPlane"
    
    arView.scene.rootNode.addChildNode(node)
    cutPlaneNode = node
    
    updateCutPlanePosition()
  }

  private func updateCutPlanePosition() {
    guard let node = cutPlaneNode else { return }
    
    if cutType == "horizontal" {
      // Horizontal: flat plane at cutPlaneHeight Y
      node.eulerAngles = SCNVector3(-Float.pi / 2, 0, 0)
      // Position at camera XZ but fixed Y
      if let cam = arView.pointOfView {
        let camPos = cam.position
        node.position = SCNVector3(camPos.x, cutPlaneHeight, camPos.z)
      } else {
        node.position = SCNVector3(0, cutPlaneHeight, 0)
      }
    } else {
      // Vertical: plane standing up, rotating around Z (world Y axis)
      if let cam = arView.pointOfView {
        let camPos = cam.position
        node.position = SCNVector3(camPos.x, cutPlaneHeight, camPos.z)
      }
      node.eulerAngles = SCNVector3(0, cutPlaneRotation, 0)
    }
  }

  private func hideCutPlane() {
    cutPlaneNode?.removeFromParentNode()
    cutPlaneNode = nil
  }

  /// Core: intersect cutting plane with all mesh triangles
  @available(iOS 13.4, *)
  private func performCut() {
    guard cutActive, let frame = arView.session.currentFrame else { return }
    
    // Clear previous cut result
    for node in cutPolylineNodes { node.removeFromParentNode() }
    cutPolylineNodes.removeAll()
    cutResultPolyline.removeAll()
    
    let anchors = frame.anchors.compactMap { $0 as? ARMeshAnchor }
    guard !anchors.isEmpty else { return }
    
    // Define cutting plane: point + normal
    let planePoint: SCNVector3
    let planeNormal: SCNVector3
    
    if cutType == "horizontal" {
      planePoint = SCNVector3(0, cutPlaneHeight, 0)
      planeNormal = SCNVector3(0, 1, 0)
    } else {
      // Vertical plane rotated around Y axis
      let nx = cos(cutPlaneRotation)
      let nz = sin(cutPlaneRotation)
      planePoint = SCNVector3(0, cutPlaneHeight, 0)
      planeNormal = SCNVector3(nx, 0, nz)
    }
    
    var intersectionPoints: [SCNVector3] = []
    
    for anchor in anchors {
      let geo = anchor.geometry
      let transform = anchor.transform
      let vertBuf = geo.vertices
      let faceBuf = geo.faces
      let vertCount = vertBuf.count
      let faceCount = faceBuf.count
      let vertStride = vertBuf.stride
      let vertData = vertBuf.buffer.contents()
      let idxData = faceBuf.buffer.contents()
      let bpi = faceBuf.bytesPerIndex
      
      // Build world-space vertices
      var worldVerts: [SCNVector3] = []
      worldVerts.reserveCapacity(vertCount)
      for i in 0..<vertCount {
        let ptr = vertData.advanced(by: i * vertStride)
        let x = ptr.assumingMemoryBound(to: Float.self)[0]
        let y = ptr.assumingMemoryBound(to: Float.self)[1]
        let z = ptr.assumingMemoryBound(to: Float.self)[2]
        let local = simd_float4(x, y, z, 1)
        let world = transform * local
        worldVerts.append(SCNVector3(world.x, world.y, world.z))
      }
      
      // For each triangle, find plane intersection
      for f in 0..<faceCount {
        let off = f * 3
        let idx0: Int, idx1: Int, idx2: Int
        if bpi == 4 {
          let ptr = idxData.assumingMemoryBound(to: UInt32.self)
          idx0 = Int(ptr[off]); idx1 = Int(ptr[off+1]); idx2 = Int(ptr[off+2])
        } else {
          let ptr = idxData.assumingMemoryBound(to: UInt16.self)
          idx0 = Int(ptr[off]); idx1 = Int(ptr[off+1]); idx2 = Int(ptr[off+2])
        }
        
        let v0 = worldVerts[idx0]
        let v1 = worldVerts[idx1]
        let v2 = worldVerts[idx2]
        
        // Signed distance from plane for each vertex
        let d0 = signedDistToPlane(point: v0, planePoint: planePoint, planeNormal: planeNormal)
        let d1 = signedDistToPlane(point: v1, planePoint: planePoint, planeNormal: planeNormal)
        let d2 = signedDistToPlane(point: v2, planePoint: planePoint, planeNormal: planeNormal)
        
        // Find edge intersections (where sign changes)
        var edgeHits: [SCNVector3] = []
        
        if let p = planeEdgeIntersection(a: v0, b: v1, da: d0, db: d1) { edgeHits.append(p) }
        if let p = planeEdgeIntersection(a: v1, b: v2, da: d1, db: d2) { edgeHits.append(p) }
        if let p = planeEdgeIntersection(a: v2, b: v0, da: d2, db: d0) { edgeHits.append(p) }
        
        if edgeHits.count == 2 {
          intersectionPoints.append(contentsOf: edgeHits)
        }
      }
    }
    
    // Render intersection as bright red/orange line segments
    let cutColor = UIColor(red: 1.0, green: 0.3, blue: 0.1, alpha: 1.0)
    var i = 0
    while i < intersectionPoints.count - 1 {
      let lineNode = createLineBetween(from: intersectionPoints[i], to: intersectionPoints[i+1], color: cutColor, width: 0.004)
      arView.scene.rootNode.addChildNode(lineNode)
      cutPolylineNodes.append(lineNode)
      i += 2
    }
    
    // Convert to serializable format
    cutResultPolyline = intersectionPoints.map { ["x": $0.x, "y": $0.y, "z": $0.z] }
    
    onUpdate([
      "event": "cut_updated",
      "pointCount": intersectionPoints.count,
      "cutType": cutType,
      "height": cutPlaneHeight,
      "rotation": cutPlaneRotation * 180.0 / Float.pi
    ])
  }

  // Signed distance from point to plane
  private func signedDistToPlane(point: SCNVector3, planePoint: SCNVector3, planeNormal: SCNVector3) -> Float {
    return (point.x - planePoint.x) * planeNormal.x +
           (point.y - planePoint.y) * planeNormal.y +
           (point.z - planePoint.z) * planeNormal.z
  }

  // Find intersection point of edge AB with plane, returns nil if no crossing
  private func planeEdgeIntersection(a: SCNVector3, b: SCNVector3, da: Float, db: Float) -> SCNVector3? {
    // If same sign, no crossing
    if da * db > 0 { return nil }
    // If both zero, on the plane (skip to avoid duplicates)
    if abs(da) < 0.0001 && abs(db) < 0.0001 { return nil }
    
    let t = da / (da - db)
    return SCNVector3(
      a.x + t * (b.x - a.x),
      a.y + t * (b.y - a.y),
      a.z + t * (b.z - a.z)
    )
  }

  // Helper: create a line node between two points
  private func createLineBetween(from: SCNVector3, to: SCNVector3, color: UIColor, width: CGFloat = 0.005) -> SCNNode {
    let vector = SCNVector3(to.x-from.x, to.y-from.y, to.z-from.z)
    let length = sqrt(vector.x*vector.x + vector.y*vector.y + vector.z*vector.z)
    guard length > 0.001 else { return SCNNode() }
    
    let plane = SCNPlane(width: width, height: CGFloat(length))
    plane.firstMaterial?.diffuse.contents = color
    plane.firstMaterial?.lightingModel = .constant
    plane.firstMaterial?.isDoubleSided = true
    
    let node = SCNNode(geometry: plane)
    node.position = SCNVector3((from.x+to.x)/2, (from.y+to.y)/2, (from.z+to.z)/2)
    
    let yAxis = SCNVector3(0, 1, 0)
    var axis = crossProduct(v1: yAxis, v2: vector)
    let axisLength = sqrt(axis.x*axis.x + axis.y*axis.y + axis.z*axis.z)
    var angle = acos(dotProduct(v1: yAxis, v2: vector) / length)
    
    if axisLength < 0.001 {
      axis = SCNVector3(1, 0, 0)
      angle = vector.y < 0 ? Float.pi : 0
    } else {
      axis = SCNVector3(axis.x/axisLength, axis.y/axisLength, axis.z/axisLength)
    }
    node.rotation = SCNVector4(axis.x, axis.y, axis.z, angle)
    return node
  }

  // Chain edge segments into polylines
  private func chainEdgeSegments(_ segments: [(SCNVector3, SCNVector3)]) -> [[[String: Float]]] {
    guard !segments.isEmpty else { return [] }
    
    // Simple chaining: group nearby endpoints
    var used = [Bool](repeating: false, count: segments.count)
    var polylines: [[[String: Float]]] = []
    let chainDist: Float = 0.02 // 2cm tolerance for chaining
    
    for i in 0..<segments.count {
      if used[i] { continue }
      used[i] = true
      
      var chain: [SCNVector3] = [segments[i].0, segments[i].1]
      var extended = true
      
      while extended {
        extended = false
        let chainEnd = chain.last!
        
        for j in 0..<segments.count {
          if used[j] { continue }
          let d0 = distance(from: chainEnd, to: segments[j].0)
          let d1 = distance(from: chainEnd, to: segments[j].1)
          
          if d0 < chainDist {
            chain.append(segments[j].1)
            used[j] = true
            extended = true
            break
          } else if d1 < chainDist {
            chain.append(segments[j].0)
            used[j] = true
            extended = true
            break
          }
        }
      }
      
      // Only keep polylines with 3+ points (meaningful edges)
      if chain.count >= 3 {
        let simplified = simplifyPolyline(chain, epsilon: 0.02)
        polylines.append(simplified.map { ["x": $0.x, "y": $0.y, "z": $0.z] })
      }
    }
    
    return polylines
  }

  // Ramer-Douglas-Peucker simplification
  private func simplifyPolyline(_ points: [SCNVector3], epsilon: Float) -> [SCNVector3] {
    guard points.count > 2 else { return points }
    
    var maxDist: Float = 0
    var maxIdx = 0
    let first = points.first!
    let last = points.last!
    
    for i in 1..<(points.count - 1) {
      let d = perpendicularDistance(point: points[i], lineStart: first, lineEnd: last)
      if d > maxDist {
        maxDist = d
        maxIdx = i
      }
    }
    
    if maxDist > epsilon {
      let left = simplifyPolyline(Array(points[0...maxIdx]), epsilon: epsilon)
      let right = simplifyPolyline(Array(points[maxIdx...]), epsilon: epsilon)
      return Array(left.dropLast()) + right
    } else {
      return [first, last]
    }
  }

  private func perpendicularDistance(point: SCNVector3, lineStart: SCNVector3, lineEnd: SCNVector3) -> Float {
    let dx = lineEnd.x - lineStart.x
    let dy = lineEnd.y - lineStart.y
    let dz = lineEnd.z - lineStart.z
    let lineLenSq = dx*dx + dy*dy + dz*dz
    guard lineLenSq > 0.0001 else { return distance(from: point, to: lineStart) }
    
    let t = max(0, min(1, ((point.x-lineStart.x)*dx + (point.y-lineStart.y)*dy + (point.z-lineStart.z)*dz) / lineLenSq))
    let proj = SCNVector3(lineStart.x + t*dx, lineStart.y + t*dy, lineStart.z + t*dz)
    return distance(from: point, to: proj)
  }

  private func computePolylineLength(_ points: [[String: Float]]) -> Float {
    var total: Float = 0
    for i in 0..<(points.count - 1) {
      let p0 = points[i], p1 = points[i+1]
      let dx = (p1["x"] ?? 0) - (p0["x"] ?? 0)
      let dy = (p1["y"] ?? 0) - (p0["y"] ?? 0)
      let dz = (p1["z"] ?? 0) - (p0["z"] ?? 0)
      total += sqrt(dx*dx + dy*dy + dz*dz)
    }
    return total
  }

  // MARK: - Math Helpers
  private func calculateArea(polygon: [SCNVector3]) -> Float {
    var normal = SCNVector3(0, 0, 0)
    let n = polygon.count
    if n < 3 { return 0 }
    
    for i in 0..<n {
        let current = polygon[i]
        let next = polygon[(i + 1) % n]
        normal.x += (current.y - next.y) * (current.z + next.z)
        normal.y += (current.z - next.z) * (current.x + next.x)
        normal.z += (current.x - next.x) * (current.y + next.y)
    }
    
    let area = sqrt(normal.x*normal.x + normal.y*normal.y + normal.z*normal.z) / 2.0
    return abs(area)
  }

  private func distance(from: SCNVector3, to: SCNVector3) -> Float {
    let dx = to.x - from.x
    let dy = to.y - from.y
    let dz = to.z - from.z
    return sqrt(dx*dx + dy*dy + dz*dz)
  }

  private func crossProduct(v1: SCNVector3, v2: SCNVector3) -> SCNVector3 {
    return SCNVector3(v1.y * v2.z - v1.z * v2.y,
                      v1.z * v2.x - v1.x * v2.z,
                      v1.x * v2.y - v1.y * v2.x)
  }

  private func dotProduct(v1: SCNVector3, v2: SCNVector3) -> Float {
    return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z
  }

  // MARK: - ARSessionDelegate to handle interruptions and resume camera
  func sessionWasInterrupted(_ session: ARSession) {
    print("[ARKit] Session was interrupted (e.g., app moved to background or camera covered)")
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    print("[ARKit] Session interruption ended, resuming tracking...")
    // Restore world tracking to unfreeze camera
    let configuration = ARWorldTrackingConfiguration()
    configuration.planeDetection = [.horizontal, .vertical]
    if #available(iOS 13.4, *), ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
        configuration.sceneReconstruction = .mesh
    }
    session.run(configuration)
  }

  // MARK: - Photo Capture
  func takePhoto(promise: ExpoModulesCore.Promise) {
    guard let frame = arView.session.currentFrame else {
      promise.reject("ERR", "No AR frame available")
      return
    }
    
    let pixelBuffer = frame.capturedImage
    let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
    let context = CIContext()
    guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else {
      promise.reject("ERR", "Could not create CGImage")
      return
    }
    
    // ARKit capturedImage is 90 deg rotated cw in portrait layout.
    let uiImage = UIImage(cgImage: cgImage, scale: 1.0, orientation: .right)
    
    guard let data = uiImage.jpegData(compressionQuality: 0.8) else {
      promise.reject("ERR", "Could not compress image to JPEG")
      return
    }
    
    let fm = FileManager.default
    let path = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".jpg")
    
    do {
      try data.write(to: path)
      
      let t = frame.camera.transform
      // 4x4 matrix representing full 6DOF transform
      let matrix: [Float] = [
        t.columns.0.x, t.columns.0.y, t.columns.0.z, t.columns.0.w,
        t.columns.1.x, t.columns.1.y, t.columns.1.z, t.columns.1.w,
        t.columns.2.x, t.columns.2.y, t.columns.2.z, t.columns.2.w,
        t.columns.3.x, t.columns.3.y, t.columns.3.z, t.columns.3.w
      ]
      
      promise.resolve([
        "uri": path.absoluteString,
        "transform": matrix
      ])
    } catch {
      promise.reject("ERR", "Could not write photo to \(path)")
    }
  }
  
  // MARK: - Auto-Photo Capture (internal, triggered by distance)
  
  private func autoCapture(at position: SCNVector3, frame: ARFrame) {
    lastAutoPhotoPosition = position
    
    let pixelBuffer = frame.capturedImage
    let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
    let context = CIContext()
    guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else { return }
    
    let uiImage = UIImage(cgImage: cgImage, scale: 1.0, orientation: .right)
    guard let data = uiImage.jpegData(compressionQuality: 0.6) else { return }
    
    let fm = FileManager.default
    let path = fm.temporaryDirectory.appendingPathComponent("auto_\(UUID().uuidString).jpg")
    
    do {
      try data.write(to: path)
      
      let t = frame.camera.transform
      let matrix: [Float] = [
        t.columns.0.x, t.columns.0.y, t.columns.0.z, t.columns.0.w,
        t.columns.1.x, t.columns.1.y, t.columns.1.z, t.columns.1.w,
        t.columns.2.x, t.columns.2.y, t.columns.2.z, t.columns.2.w,
        t.columns.3.x, t.columns.3.y, t.columns.3.z, t.columns.3.w
      ]
      
      autoPhotoPaths.append([
        "uri": path.absoluteString,
        "transform": matrix,
        "position_x": position.x,
        "position_y": position.y,
        "position_z": position.z
      ])
      
      // Place pink dot marker in AR
      let marker = SCNNode()
      marker.position = position
      let sphere = SCNSphere(radius: 0.03)
      sphere.firstMaterial?.diffuse.contents = UIColor(red: 1.0, green: 0.2, blue: 0.6, alpha: 0.9)
      sphere.firstMaterial?.emission.contents = UIColor(red: 1.0, green: 0.2, blue: 0.6, alpha: 0.5)
      marker.geometry = sphere
      
      // Add pulsing animation
      let pulse = CABasicAnimation(keyPath: "scale")
      pulse.fromValue = NSValue(scnVector3: SCNVector3(1, 1, 1))
      pulse.toValue = NSValue(scnVector3: SCNVector3(1.3, 1.3, 1.3))
      pulse.duration = 0.8
      pulse.autoreverses = true
      pulse.repeatCount = .infinity
      marker.addAnimation(pulse, forKey: "pulse")
      
      arView.scene.rootNode.addChildNode(marker)
      autoPhotoMarkerNodes.append(marker)
      
      print("[AutoPhoto] 📸 Captured at (\(String(format: "%.2f", position.x)), \(String(format: "%.2f", position.z))) — total: \(autoPhotoPaths.count)")
    } catch {
      print("[AutoPhoto] ❌ Failed to write auto photo")
    }
  }
  
  func enableAutoPhoto(enabled: Bool, spacing: Float) {
    autoPhotoEnabled = enabled
    autoPhotoGridSpacing = spacing
    if !enabled {
      lastAutoPhotoPosition = nil
    }
    print("[AutoPhoto] \(enabled ? "✅ Enabled" : "❌ Disabled") — spacing: \(spacing)m")
  }
  
  func exportAutoPhotos() -> [[String: Any]] {
    return autoPhotoPaths
  }
  
  func getAutoPhotoCount() -> Int {
    return autoPhotoPaths.count
  }
  
  // MARK: - AR Tape Visualization (walls, areas)
  
  private var tapeVisualizationNodes: [SCNNode] = []
  
  /// Extrude a wall from polyline points — creates vertical quad strips
  func extrudeWall(points: [[String: Float]], height: Float, label: String) {
    guard points.count >= 2 else { return }
    
    let container = SCNNode()
    container.name = "tape_wall_\(label)"
    
    for i in 0..<(points.count - 1) {
      let p1 = points[i]
      let p2 = points[i + 1]
      
      let x1 = p1["x"] ?? 0, z1 = p1["z"] ?? 0
      let x2 = p2["x"] ?? 0, z2 = p2["z"] ?? 0
      let y = p1["y"] ?? 0
      
      // Create a quad (two triangles) for each wall segment
      let vertices: [SCNVector3] = [
        SCNVector3(x1, y, z1),           // bottom-left
        SCNVector3(x2, y, z2),           // bottom-right
        SCNVector3(x2, y + height, z2),  // top-right
        SCNVector3(x1, y + height, z1),  // top-left
      ]
      
      let indices: [Int32] = [0, 1, 2, 0, 2, 3] // two triangles
      
      let vertexSource = SCNGeometrySource(vertices: vertices)
      let indexData = Data(bytes: indices, count: indices.count * MemoryLayout<Int32>.size)
      let element = SCNGeometryElement(data: indexData, primitiveType: .triangles, primitiveCount: 2, bytesPerIndex: 4)
      
      let geometry = SCNGeometry(sources: [vertexSource], elements: [element])
      
      // Semi-transparent green material (both sides)
      let material = SCNMaterial()
      material.diffuse.contents = UIColor(red: 0.2, green: 0.85, blue: 0.4, alpha: 0.25)
      material.emission.contents = UIColor(red: 0.2, green: 0.85, blue: 0.4, alpha: 0.1)
      material.isDoubleSided = true
      material.transparency = 0.25
      material.blendMode = .add
      geometry.materials = [material]
      
      let wallNode = SCNNode(geometry: geometry)
      container.addChildNode(wallNode)
      
      // Edge line on top
      let edgeVertices: [SCNVector3] = [
        SCNVector3(x1, y + height, z1),
        SCNVector3(x2, y + height, z2),
      ]
      let lineSource = SCNGeometrySource(vertices: edgeVertices)
      let lineIndices: [Int32] = [0, 1]
      let lineData = Data(bytes: lineIndices, count: lineIndices.count * MemoryLayout<Int32>.size)
      let lineElement = SCNGeometryElement(data: lineData, primitiveType: .line, primitiveCount: 1, bytesPerIndex: 4)
      let lineGeo = SCNGeometry(sources: [lineSource], elements: [lineElement])
      let lineMat = SCNMaterial()
      lineMat.diffuse.contents = UIColor(red: 0.2, green: 1.0, blue: 0.4, alpha: 0.8)
      lineMat.emission.contents = UIColor.green
      lineGeo.materials = [lineMat]
      let lineNode = SCNNode(geometry: lineGeo)
      container.addChildNode(lineNode)
    }
    
    // Label at center top
    if let firstP = points.first, let lastP = points.last {
      let cx = ((firstP["x"] ?? 0) + (lastP["x"] ?? 0)) / 2
      let cz = ((firstP["z"] ?? 0) + (lastP["z"] ?? 0)) / 2
      let cy = (firstP["y"] ?? 0) + height + 0.1
      
      let text = SCNText(string: label, extrusionDepth: 0.005)
      text.font = UIFont.boldSystemFont(ofSize: 0.08)
      text.firstMaterial?.diffuse.contents = UIColor.green
      text.firstMaterial?.emission.contents = UIColor.green
      let textNode = SCNNode(geometry: text)
      let (min, max) = textNode.boundingBox
      textNode.position = SCNVector3(cx - (max.x - min.x)/2, cy, cz)
      let billboard = SCNBillboardConstraint()
      billboard.freeAxes = .Y
      textNode.constraints = [billboard]
      container.addChildNode(textNode)
    }
    
    arView.scene.rootNode.addChildNode(container)
    tapeVisualizationNodes.append(container)
    
    print("[TapeViz] 🧱 Wall extruded: \(points.count) segments, h=\(height)m, label=\(label)")
  }
  
  /// Show a semi-transparent floor polygon for area measurement
  func showAreaSurface(points: [[String: Float]], label: String) {
    guard points.count >= 3 else { return }
    
    let container = SCNNode()
    container.name = "tape_area_\(label)"
    
    // Fan triangulation from first point
    var vertices: [SCNVector3] = points.map { p in
      SCNVector3(p["x"] ?? 0, (p["y"] ?? 0) + 0.005, p["z"] ?? 0) // slightly above floor
    }
    
    var indices: [Int32] = []
    for i in 1..<(vertices.count - 1) {
      indices.append(0)
      indices.append(Int32(i))
      indices.append(Int32(i + 1))
    }
    
    let vertexSource = SCNGeometrySource(vertices: vertices)
    let indexData = Data(bytes: indices, count: indices.count * MemoryLayout<Int32>.size)
    let element = SCNGeometryElement(data: indexData, primitiveType: .triangles, primitiveCount: indices.count / 3, bytesPerIndex: 4)
    
    let geometry = SCNGeometry(sources: [vertexSource], elements: [element])
    
    let material = SCNMaterial()
    material.diffuse.contents = UIColor(red: 0.3, green: 0.5, blue: 1.0, alpha: 0.2)
    material.emission.contents = UIColor(red: 0.3, green: 0.5, blue: 1.0, alpha: 0.1)
    material.isDoubleSided = true
    material.transparency = 0.2
    material.blendMode = .add
    geometry.materials = [material]
    
    let surfaceNode = SCNNode(geometry: geometry)
    container.addChildNode(surfaceNode)
    
    // Label at centroid
    var cx: Float = 0, cy: Float = 0, cz: Float = 0
    for p in points {
      cx += p["x"] ?? 0
      cy += p["y"] ?? 0
      cz += p["z"] ?? 0
    }
    let n = Float(points.count)
    cx /= n; cy /= n; cz /= n
    
    let text = SCNText(string: label, extrusionDepth: 0.005)
    text.font = UIFont.boldSystemFont(ofSize: 0.06)
    text.firstMaterial?.diffuse.contents = UIColor(red: 0.3, green: 0.5, blue: 1.0, alpha: 1.0)
    text.firstMaterial?.emission.contents = UIColor.blue
    let textNode = SCNNode(geometry: text)
    let (min, max) = textNode.boundingBox
    textNode.position = SCNVector3(cx - (max.x - min.x)/2, cy + 0.15, cz)
    let billboard = SCNBillboardConstraint()
    billboard.freeAxes = .Y
    textNode.constraints = [billboard]
    container.addChildNode(textNode)
    
    arView.scene.rootNode.addChildNode(container)
    tapeVisualizationNodes.append(container)
    
    print("[TapeViz] ⬜ Area surface: \(points.count) vertices, label=\(label)")
  }
  
  func clearTapeVisualizations() {
    for node in tapeVisualizationNodes {
      node.removeFromParentNode()
    }
    tapeVisualizationNodes = []
  }
  
  // MARK: - Manual Anchor Placement & Matching for Multi-Session Alignment
  
  private var manualAnchors: [[String: Any]] = []        // Placed this session
  private var manualAnchorNodes: [SCNNode] = []
  private var matchingPreviousAnchors: [[String: Any]] = [] // From DB
  private var matchingGhostNodes: [SCNNode] = []
  private var matchedPositions: [SCNVector3] = []          // New positions for old anchors
  private var matchedIndices: Set<Int> = []
  
  /// Place a numbered manual anchor at the cursor/crosshair position (raycast hit)
  /// type: "point" = sphere marker for corners, "edge" = vertical line for wall edges
  func placeManualAnchor(type anchorType: String = "point") -> [String: Any]? {
    // Use crosshair position (same raycast as measurement points)
    guard let cursorPosition = pointerNode?.position, !pointerNode!.isHidden else {
      // Fallback: if no surface detected, try camera-based placement
      guard let frame = arView.session.currentFrame else { return nil }
      let camera = frame.camera.transform
      // Place 2m in front of camera
      let forward = SCNVector3(-camera.columns.2.x, -camera.columns.2.y, -camera.columns.2.z)
      let pos = SCNVector3(camera.columns.3.x + forward.x * 2,
                           camera.columns.3.y + forward.y * 2,
                           camera.columns.3.z + forward.z * 2)
      return createAnchorNode(at: pos, type: anchorType)
    }
    
    return createAnchorNode(at: cursorPosition, type: anchorType)
  }
  
  private func createAnchorNode(at position: SCNVector3, type anchorType: String) -> [String: Any] {
    let index = manualAnchors.count + 1
    let typeLabel = anchorType == "edge" ? "Hrana" : "Bod"
    let name = "\(typeLabel) \(index)"
    let anchorId = UUID().uuidString
    
    let anchor: [String: Any] = [
      "id": anchorId,
      "name": name,
      "type": "manual",
      "anchor_type": anchorType, // "point" or "edge"
      "position_x": position.x,
      "position_y": position.y,
      "position_z": position.z,
      "index": index
    ]
    manualAnchors.append(anchor)
    
    // Create visual marker
    let container = SCNNode()
    container.position = position
    
    if anchorType == "edge" {
      // EDGE: vertical line with spheres at top and bottom
      let edgeHeight: Float = ceilingY != nil ? (ceilingY! - (floorY ?? position.y)) : 2.5
      let baseY = floorY ?? position.y
      
      // Vertical pole (full height)
      let pole = SCNCylinder(radius: 0.012, height: CGFloat(edgeHeight))
      pole.firstMaterial?.diffuse.contents = UIColor.red.withAlphaComponent(0.8)
      pole.firstMaterial?.emission.contents = UIColor.red.withAlphaComponent(0.3)
      let poleNode = SCNNode(geometry: pole)
      poleNode.position = SCNVector3(0, baseY - position.y + edgeHeight / 2, 0)
      container.addChildNode(poleNode)
      
      // Bottom sphere
      let bottomSphere = SCNSphere(radius: 0.05)
      bottomSphere.firstMaterial?.diffuse.contents = UIColor.red
      bottomSphere.firstMaterial?.emission.contents = UIColor(red: 0.9, green: 0, blue: 0, alpha: 0.5)
      let bottomNode = SCNNode(geometry: bottomSphere)
      bottomNode.position = SCNVector3(0, baseY - position.y, 0)
      container.addChildNode(bottomNode)
      
      // Top sphere
      let topSphere = SCNSphere(radius: 0.05)
      topSphere.firstMaterial?.diffuse.contents = UIColor.red
      topSphere.firstMaterial?.emission.contents = UIColor(red: 0.9, green: 0, blue: 0, alpha: 0.5)
      let topNode = SCNNode(geometry: topSphere)
      topNode.position = SCNVector3(0, baseY - position.y + edgeHeight, 0)
      container.addChildNode(topNode)
      
      // Pulse on top sphere
      let pulse = CABasicAnimation(keyPath: "scale")
      pulse.fromValue = NSValue(scnVector3: SCNVector3(1, 1, 1))
      pulse.toValue = NSValue(scnVector3: SCNVector3(1.3, 1.3, 1.3))
      pulse.duration = 0.6
      pulse.autoreverses = true
      pulse.repeatCount = .infinity
      topNode.addAnimation(pulse, forKey: "pulse")
    } else {
      // POINT: red sphere at exact position
      let sphere = SCNSphere(radius: 0.06)
      sphere.firstMaterial?.diffuse.contents = UIColor.red
      sphere.firstMaterial?.emission.contents = UIColor(red: 0.9, green: 0, blue: 0, alpha: 0.5)
      let sphereNode = SCNNode(geometry: sphere)
      container.addChildNode(sphereNode)
      
      // Pulse animation
      let pulse = CABasicAnimation(keyPath: "scale")
      pulse.fromValue = NSValue(scnVector3: SCNVector3(1, 1, 1))
      pulse.toValue = NSValue(scnVector3: SCNVector3(1.2, 1.2, 1.2))
      pulse.duration = 0.6
      pulse.autoreverses = true
      pulse.repeatCount = .infinity
      sphereNode.addAnimation(pulse, forKey: "pulse")
    }
    
    // Number label
    let text = SCNText(string: "\(index)", extrusionDepth: 0.01)
    text.font = UIFont.boldSystemFont(ofSize: 0.12)
    text.firstMaterial?.diffuse.contents = UIColor.white
    text.firstMaterial?.emission.contents = UIColor.red
    let textNode = SCNNode(geometry: text)
    let (min, max) = textNode.boundingBox
    textNode.position = SCNVector3(-(max.x - min.x)/2, 0.08, 0)
    let billboard = SCNBillboardConstraint()
    billboard.freeAxes = .Y
    textNode.constraints = [billboard]
    container.addChildNode(textNode)
    
    arView.scene.rootNode.addChildNode(container)
    manualAnchorNodes.append(container)
    
    // Also save to sceneAnchors for DB persistence
    sceneAnchors.append(anchor)
    
    print("[ManualAnchor] ✅ Placed '\(name)' (\(anchorType)) at (\(String(format: "%.2f", position.x)), \(String(format: "%.2f", position.y)), \(String(format: "%.2f", position.z)))")
    return anchor
  }
  
  func getManualAnchorCount() -> Int {
    return manualAnchors.count
  }
  
  func getManualAnchors() -> [[String: Any]] {
    return manualAnchors
  }
  
  /// Start matching: show ghost markers from previous session
  func startAnchorMatching(previousAnchors: [[String: Any]]) {
    matchingPreviousAnchors = previousAnchors
    matchedPositions = Array(repeating: SCNVector3Zero, count: previousAnchors.count)
    matchedIndices = []
    
    // Show ghost markers (semi-transparent yellow)
    for (i, anchor) in previousAnchors.enumerated() {
      let px = (anchor["position_x"] as? Float) ?? 0
      let py = (anchor["position_y"] as? Float) ?? 0
      let pz = (anchor["position_z"] as? Float) ?? 0
      let name = (anchor["name"] as? String) ?? "Kotva \(i+1)"
      
      let container = SCNNode()
      // Place ghost at ORIGIN — user needs to walk there
      container.position = SCNVector3(0, 0, 0) // hidden initially
      container.isHidden = true
      
      // Yellow ghost sphere
      let sphere = SCNSphere(radius: 0.08)
      sphere.firstMaterial?.diffuse.contents = UIColor.yellow.withAlphaComponent(0.4)
      sphere.firstMaterial?.emission.contents = UIColor.yellow.withAlphaComponent(0.2)
      let sphereNode = SCNNode(geometry: sphere)
      container.addChildNode(sphereNode)
      
      // Number label
      let text = SCNText(string: "\(i+1) — \(name)", extrusionDepth: 0.01)
      text.font = UIFont.boldSystemFont(ofSize: 0.1)
      text.firstMaterial?.diffuse.contents = UIColor.yellow
      let textNode = SCNNode(geometry: text)
      let (min, max) = textNode.boundingBox
      textNode.position = SCNVector3(-(max.x - min.x)/2, 0.12, 0)
      let billboard = SCNBillboardConstraint()
      billboard.freeAxes = .Y
      textNode.constraints = [billboard]
      container.addChildNode(textNode)
      
      arView.scene.rootNode.addChildNode(container)
      matchingGhostNodes.append(container)
    }
    
    print("[Matching] Started with \(previousAnchors.count) previous anchors to match")
  }
  
  /// Match current crosshair position to a previous anchor by index
  func matchAnchor(index: Int) -> Bool {
    guard index >= 0 && index < matchingPreviousAnchors.count else { return false }
    
    // Use crosshair position if available, fallback to camera
    let newPos: SCNVector3
    if let cursorPos = pointerNode?.position, !pointerNode!.isHidden {
      newPos = cursorPos
    } else {
      guard let frame = arView.session.currentFrame else { return false }
      let camera = frame.camera.transform
      newPos = SCNVector3(camera.columns.3.x, 0, camera.columns.3.z)
    }
    
    matchedPositions[index] = newPos
    matchedIndices.insert(index)
    
    // Show matched marker (solid green at new position)
    if index < matchingGhostNodes.count {
      let ghost = matchingGhostNodes[index]
      ghost.position = newPos
      ghost.isHidden = false
      // Change color to green (matched!)
      ghost.enumerateChildNodes { child, _ in
        if let geo = child.geometry as? SCNSphere {
          geo.firstMaterial?.diffuse.contents = UIColor.green
          geo.firstMaterial?.emission.contents = UIColor.green.withAlphaComponent(0.5)
        }
        if let tGeo = child.geometry as? SCNText {
          tGeo.firstMaterial?.diffuse.contents = UIColor.green
        }
      }
    }
    
    let name = (matchingPreviousAnchors[index]["name"] as? String) ?? "Kotva \(index+1)"
    print("[Matching] ✅ Matched '\(name)' at (\(String(format: "%.2f", newPos.x)), \(String(format: "%.2f", newPos.z))) — \(matchedIndices.count)/\(matchingPreviousAnchors.count)")
    return true
  }
  
  func getMatchedCount() -> Int {
    return matchedIndices.count
  }
  
  /// Compute Kabsch rigid body transform (rotation + translation)
  /// Returns 4x4 transform matrix as flat Float array, or nil if not enough matches
  func computeKabschTransform() -> [Float]? {
    guard matchedIndices.count >= 3 else {
      print("[Kabsch] Need at least 3 matched anchors, have \(matchedIndices.count)")
      return nil
    }
    
    let indices = Array(matchedIndices).sorted()
    
    // Collect old (previous session) and new (current session) positions
    var oldPoints: [simd_float3] = []
    var newPoints: [simd_float3] = []
    
    for i in indices {
      let anchor = matchingPreviousAnchors[i]
      let ox = (anchor["position_x"] as? Float) ?? 0
      let oy = (anchor["position_y"] as? Float) ?? 0
      let oz = (anchor["position_z"] as? Float) ?? 0
      oldPoints.append(simd_float3(ox, oy, oz))
      
      let np = matchedPositions[i]
      newPoints.append(simd_float3(np.x, np.y, np.z))
    }
    
    // Compute centroids
    var centroidOld = simd_float3(0, 0, 0)
    var centroidNew = simd_float3(0, 0, 0)
    let n = Float(oldPoints.count)
    
    for i in 0..<oldPoints.count {
      centroidOld += oldPoints[i]
      centroidNew += newPoints[i]
    }
    centroidOld /= n
    centroidNew /= n
    
    // Center the points
    var centeredOld: [simd_float3] = []
    var centeredNew: [simd_float3] = []
    for i in 0..<oldPoints.count {
      centeredOld.append(oldPoints[i] - centroidOld)
      centeredNew.append(newPoints[i] - centroidNew)
    }
    
    // Compute cross-covariance matrix H = sum(new_i * old_i^T)
    // For 2D floor alignment (Y is constant), we use XZ plane
    var h00: Float = 0, h01: Float = 0
    var h10: Float = 0, h11: Float = 0
    
    for i in 0..<centeredOld.count {
      h00 += centeredNew[i].x * centeredOld[i].x
      h01 += centeredNew[i].x * centeredOld[i].z
      h10 += centeredNew[i].z * centeredOld[i].x
      h11 += centeredNew[i].z * centeredOld[i].z
    }
    
    // 2D rotation angle via atan2
    let angle = atan2(h10 - h01, h00 + h11)
    let cosA = cos(angle)
    let sinA = sin(angle)
    
    // Translation: t = centroid_new - R * centroid_old
    let tx = centroidNew.x - (cosA * centroidOld.x - sinA * centroidOld.z)
    let tz = centroidNew.z - (sinA * centroidOld.x + cosA * centroidOld.z)
    let ty = centroidNew.y - centroidOld.y
    
    // Build 4x4 transform matrix (column-major for SceneKit/ARKit)
    let transform: [Float] = [
       cosA,  0, sinA, 0,  // column 0
       0,     1, 0,    0,  // column 1
      -sinA,  0, cosA, 0,  // column 2
       tx,   ty, tz,   1   // column 3
    ]
    
    // Compute alignment error (RMSE)
    var totalError: Float = 0
    for i in 0..<oldPoints.count {
      let rotatedX = cosA * centeredOld[i].x - sinA * centeredOld[i].z
      let rotatedZ = sinA * centeredOld[i].x + cosA * centeredOld[i].z
      let errX = centeredNew[i].x - rotatedX
      let errZ = centeredNew[i].z - rotatedZ
      totalError += errX * errX + errZ * errZ
    }
    let rmse = sqrt(totalError / n)
    
    print("[Kabsch] ✅ Transform computed! Angle: \(String(format: "%.1f", angle * 180 / .pi))° Translation: (\(String(format: "%.2f", tx)), \(String(format: "%.2f", tz))) RMSE: \(String(format: "%.3f", rmse))m")
    
    return transform
  }
  
  func clearMatchingState() {
    for node in matchingGhostNodes {
      node.removeFromParentNode()
    }
    matchingGhostNodes = []
    matchingPreviousAnchors = []
    matchedPositions = []
    matchedIndices = []
    manualAnchors = []
    for node in manualAnchorNodes {
      node.removeFromParentNode()
    }
    manualAnchorNodes = []
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    print("[ARKit] Session failed: \(error.localizedDescription)")
    // Try to recover to prevent complete freeze
    let configuration = ARWorldTrackingConfiguration()
    configuration.planeDetection = [.horizontal, .vertical]
    if #available(iOS 13.4, *), ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
        configuration.sceneReconstruction = .mesh
    }
    session.run(configuration, options: [.resetTracking])
  }

  func sessionWasInterrupted(_ session: ARSession) {
    // Camera covered or app backgrounded — pause rendering to prevent freeze
    print("[ARKit] Session interrupted (camera covered?)")
    onPlaneStateChange(["status": "interrupted"])
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    // Camera uncovered — resume tracking
    print("[ARKit] Session interruption ended, resuming")
    let configuration = ARWorldTrackingConfiguration()
    configuration.planeDetection = [.horizontal, .vertical]
    if #available(iOS 13.4, *), ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      configuration.sceneReconstruction = .mesh
    }
    // Don't reset tracking — try to relocalize so we keep existing anchors
    session.run(configuration)
    onPlaneStateChange(["status": "searching"])
  }
  // MARK: - Sketch 3D CSG Methods

  func addPrimitive(type: String, size: Float, label: String) -> [String: Any]? {
    guard let pointer = pointerNode, !pointer.isHidden else { return nil }
    let pos = pointer.position
    let position = simd_float3(pos.x, pos.y, pos.z)

    var shape: SketchShape?
    switch type {
    case "cube":
      shape = sketchManager.addBox(at: position, size: size, label: label)
    case "sphere":
      shape = sketchManager.addSphere(at: position, radius: size / 2, label: label)
    case "cylinder":
      shape = sketchManager.addCylinder(at: position, radius: size / 2, height: size, label: label)
    case "cone":
      shape = sketchManager.addCone(at: position, radius: size / 2, height: size, label: label)
    case "torus":
      shape = sketchManager.addTorus(at: position, majorRadius: size / 2, minorRadius: size / 6, label: label)
    default:
      return nil
    }

    guard let s = shape else { return nil }
    return sketchManager.shapeToDict(s)
  }

  /// Add a primitive at an explicit position with explicit dimensions
  func addPrimitiveAt(type: String, position: [String: Float], dimensions: [String: Float], label: String) -> [String: Any]? {
    let pos = simd_float3(
      position["x"] ?? 0,
      position["y"] ?? 0,
      position["z"] ?? 0
    )
    let w = dimensions["width"] ?? 1.0
    let h = dimensions["height"] ?? 1.0
    let d = dimensions["depth"] ?? w
    let r = dimensions["radius"] ?? w / 2

    var shape: SketchShape?
    switch type {
    case "cube":
      shape = sketchManager.addBox(at: pos, size: max(w, h, d), label: label)
      // Rescale to actual dimensions
      if let idx = sketchManager.shapes.indices.last {
        sketchManager.scaleShape(id: sketchManager.shapes[idx].id, sx: w / max(w,h,d), sy: h / max(w,h,d), sz: d / max(w,h,d))
      }
    case "sphere":
      shape = sketchManager.addSphere(at: pos, radius: r, label: label)
    case "cylinder":
      shape = sketchManager.addCylinder(at: pos, radius: r, height: h, label: label)
    case "cone":
      shape = sketchManager.addCone(at: pos, radius: r, height: h, label: label)
    default:
      return nil
    }

    guard let s = shape else { return nil }
    return sketchManager.shapeToDict(s)
  }

  func extrudeSketchShape(points: [[String: Float]], height: Float, label: String) -> [String: Any]? {
    guard let shape = sketchManager.extrudePolygon(points: points, height: height, label: label) else { return nil }
    return sketchManager.shapeToDict(shape)
  }

  func selectSketchShapeAtCenter() -> [String: Any]? {
    let center = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
    guard let shape = sketchManager.hitTestSelect(at: center) else { return nil }
    return sketchManager.shapeToDict(shape)
  }

  func selectSketchShapeById(id: String) {
    sketchManager.selectShape(id: id)
  }

  func toggleSketchShapeSelection(id: String) {
    sketchManager.toggleSelection(id: id)
  }

  func deselectAllSketchShapes() {
    sketchManager.deselectAll()
  }

  func getSelectedSketchShapeIds() -> [String] {
    return sketchManager.getSelectedShapes().map { $0.id }
  }

  func getSketchShapes() -> [[String: Any]] {
    return sketchManager.exportShapes()
  }

  func moveSketchShape(id: String, dx: Float, dy: Float, dz: Float) {
    sketchManager.moveShape(id: id, dx: dx, dy: dy, dz: dz)
  }

  func rotateSketchShape(id: String, rx: Float, ry: Float, rz: Float) {
    sketchManager.rotateShape(id: id, rx: rx, ry: ry, rz: rz)
  }

  func scaleSketchShape(id: String, sx: Float, sy: Float, sz: Float) {
    sketchManager.scaleShape(id: id, sx: sx, sy: sy, sz: sz)
  }

  func booleanSubtract(keepId: String, cutId: String) -> [String: Any]? {
    guard let shape = sketchManager.booleanSubtract(keepId: keepId, cutId: cutId) else { return nil }
    return sketchManager.shapeToDict(shape)
  }

  func booleanUnion(idA: String, idB: String) -> [String: Any]? {
    guard let shape = sketchManager.booleanUnion(idA: idA, idB: idB) else { return nil }
    return sketchManager.shapeToDict(shape)
  }

  func booleanIntersect(idA: String, idB: String) -> [String: Any]? {
    guard let shape = sketchManager.booleanIntersect(idA: idA, idB: idB) else { return nil }
    return sketchManager.shapeToDict(shape)
  }

  func pushPullFace(shapeId: String, facePoints: [[String: Float]], depth: Float) -> [String: Any]? {
    guard let shape = sketchManager.pushPull(shapeId: shapeId, facePoints: facePoints, depth: depth) else { return nil }
    return sketchManager.shapeToDict(shape)
  }

  func deleteSketchShape(id: String) -> Bool {
    return sketchManager.deleteShape(id: id)
  }

  func deleteSelectedSketchShapes() -> Int {
    return sketchManager.deleteSelected()
  }

  // MARK: - Cut / Subdivision Tool

  func hitTestMeshElement() -> [String: Any]? {
    let center = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
    return sketchManager.hitTestMeshElement(at: center)
  }

  func showSnapHighlight(x: Float, y: Float, z: Float, snapType: String) {
    let pos = simd_float3(x, y, z)
    let type = SketchShapeManager.MeshSnapType(rawValue: snapType) ?? .face
    sketchManager.showSnapHighlight(at: pos, snapType: type)
  }

  func clearSnapHighlight() {
    sketchManager.clearSnapHighlight()
  }

  func applyCutLine(shapeId: String, pointA: [String: Any], pointB: [String: Any]) -> Bool {
    return sketchManager.applyCutLine(shapeId: shapeId, pointA: pointA, pointB: pointB)
  }
}

// MARK: - UIColor Hex Extension
extension UIColor {
  static func fromHex(_ hex: String) -> UIColor {
    var hexStr = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if hexStr.hasPrefix("#") { hexStr.removeFirst() }
    guard hexStr.count == 6, let rgb = UInt64(hexStr, radix: 16) else { return .white }
    return UIColor(
      red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
      green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
      blue: CGFloat(rgb & 0xFF) / 255.0,
      alpha: 1.0
    )
  }
}

@available(iOS 16.0, *)
class RoomPlanController: NSObject, RoomCaptureSessionDelegate, NSCoding {
    var session: RoomCaptureSession?
    var latestRoom: CapturedRoom?
    var finalizedRoom: CapturedRoom?  // Post-processed by RoomBuilder
    var capturedRoomData: CapturedRoomData?  // Raw data for RoomBuilder
    var isFinalized: Bool = false
    weak var sceneView: ARSCNView?
    
    // NSCoding conformance (required for RoomCaptureViewDelegate at iOS 17+)
    required init?(coder: NSCoder) { super.init() }
    func encode(with coder: NSCoder) {}
    override init() { super.init() }
    
    // RoomCaptureView overlay (stored as UIView for iOS 16 compat)
    var roomCaptureViewRef: UIView?
    
    // Inferred ceiling
    var inferredCeilingY: Float?
    var inferredFloorY: Float?
    
    // Nodes for real-time rendering (fallback for iOS 16)
    private var roomNodes: [SCNNode] = []           // Current scan (cleared during live updates)
    private var persistentRoomNodes: [SCNNode] = []  // Previous scans (never cleared by live updates)
    private let roomRootNode = SCNNode()
    var isVisible: Bool = true
    
    // Edge colors for fallback SceneKit rendering (iOS 16)
    private let wallColor = UIColor(red: 0.4, green: 0.6, blue: 1.0, alpha: 0.08)
    private let doorColor = UIColor(red: 1.0, green: 0.65, blue: 0.1, alpha: 0.1)
    private let windowColor = UIColor(red: 0.0, green: 0.95, blue: 1.0, alpha: 0.1)
    private let floorColor = UIColor(red: 0.0, green: 0.8, blue: 0.3, alpha: 0.06)
    private let openingColor = UIColor(red: 0.9, green: 0.9, blue: 0.0, alpha: 0.08)
    private let objectColor = UIColor(red: 1.0, green: 0.4, blue: 1.0, alpha: 0.08)
    private let ceilingColor = UIColor(red: 0.7, green: 0.7, blue: 0.9, alpha: 0.05)
    private let wallEdgeColor = UIColor(red: 0.5, green: 0.7, blue: 1.0, alpha: 1.0)
    private let doorEdgeColor = UIColor(red: 1.0, green: 0.7, blue: 0.2, alpha: 1.0)
    private let windowEdgeColor = UIColor(red: 0.0, green: 1.0, blue: 1.0, alpha: 1.0)
    private let floorEdgeColor = UIColor(red: 0.2, green: 0.9, blue: 0.4, alpha: 1.0)
    private let openingEdgeColor = UIColor(red: 1.0, green: 1.0, blue: 0.3, alpha: 1.0)
    private let objectEdgeColor = UIColor.white
    private let ceilingEdgeColor = UIColor(red: 0.8, green: 0.8, blue: 1.0, alpha: 0.8)
    
    // startWithCaptureView is in iOS 17+ extension below
    
    // MARK: - Start session-only (iOS 16 fallback)
    
    func start(arSession: ARSession) {
        let config = RoomCaptureSession.Configuration()
        if #available(iOS 17.0, *) {
            session = RoomCaptureSession(arSession: arSession)
            print("[RoomPlan] Session created with SHARED arSession (iOS 17+)")
        } else {
            session = RoomCaptureSession()
            print("[RoomPlan] Session created WITHOUT shared arSession (iOS 16 fallback)")
        }
        session?.delegate = self
        session?.run(configuration: config)
        isFinalized = false
        finalizedRoom = nil
        capturedRoomData = nil
        sceneView?.scene.rootNode.addChildNode(roomRootNode)
        print("[RoomPlan] ✅ Session started, delegate set, running. session=\(session != nil)")
    }
    
    // MARK: - Stop and remove overlay
    
    func stopAndRemoveOverlay() {
        session?.stop()
        // Remove RoomCaptureView overlay
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.roomCaptureViewRef?.removeFromSuperview()
            self?.roomCaptureViewRef = nil
        }
        print("[RoomPlan] Session stopped, removing overlay...")
    }
    
    func stop() {
        session?.stop()
        print("[RoomPlan] Session stopped, waiting for finalization...")
    }
    
    // RoomCaptureViewDelegate methods are in iOS 17+ extension below
    
    // MARK: - RoomCaptureSessionDelegate
    
    func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
        self.latestRoom = room
        print("[RoomPlan] 📡 didUpdate: \(room.walls.count) walls, \(room.doors.count) doors")
        inferCeilingAndFloor(from: room)
        // Re-enabled: render RoomPlan data in SceneKit (shared AR session = correct coords)
        DispatchQueue.main.async { [weak self] in
            self?.updateARVisualization(room: room)
        }
    }
    
    func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        if let error = error {
            print("[RoomPlan] Session ended with error: \(error.localizedDescription)")
        } else {
            print("[RoomPlan] Session ended, storing CapturedRoomData for finalization")
            self.capturedRoomData = data
            finalizeRoom()
        }
    }
    
    // MARK: - RoomBuilder Finalization (ML post-processing)
    
    func finalizeRoom() {
        guard let data = capturedRoomData else {
            print("[RoomPlan] No CapturedRoomData to finalize")
            return
        }
        
        print("[RoomPlan] Starting RoomBuilder finalization...")
        
        Task {
            do {
                let roomBuilder = RoomBuilder(options: [.beautifyObjects])
                let finalRoom = try await roomBuilder.capturedRoom(from: data)
                
                await MainActor.run {
                    self.finalizedRoom = finalRoom
                    self.latestRoom = finalRoom
                    self.isFinalized = true
                    self.inferCeilingAndFloor(from: finalRoom)
                    
                    // Move current live nodes to persistent (they survive future scans)
                    self.persistentRoomNodes.append(contentsOf: self.roomNodes)
                    self.roomNodes.removeAll()
                    
                    // Re-render with finalized data (adds to scene as new roomNodes)
                    self.updateARVisualization(room: finalRoom)
                    
                    // Move finalized nodes to persistent too
                    self.persistentRoomNodes.append(contentsOf: self.roomNodes)
                    self.roomNodes.removeAll()
                    
                    // Auto-create scene anchors at wall corners
                    self.autoPlaceWallCornerAnchors(room: finalRoom)
                    
                    print("[RoomPlan] ✅ Finalized! Walls:\(finalRoom.walls.count) Doors:\(finalRoom.doors.count) Win:\(finalRoom.windows.count) Obj:\(finalRoom.objects.count) Persistent:\(self.persistentRoomNodes.count)")
                }
            } catch {
                print("[RoomPlan] ❌ RoomBuilder error: \(error.localizedDescription)")
            }
        }
    }
    
    // MARK: - Ceiling / Floor Inference
    
    private func inferCeilingAndFloor(from room: CapturedRoom) {
        guard !room.walls.isEmpty else { return }
        
        var maxY: Float = -Float.greatestFiniteMagnitude
        var minY: Float = Float.greatestFiniteMagnitude
        
        for wall in room.walls {
            let posY = wall.transform.columns.3.y
            let halfH = wall.dimensions.y / 2
            let topY = posY + halfH
            let bottomY = posY - halfH
            if topY > maxY { maxY = topY }
            if bottomY < minY { minY = bottomY }
        }
        
        inferredCeilingY = maxY
        inferredFloorY = minY
    }
    
    // MARK: - Auto-Place Anchors at Wall Corners
    
    private func autoPlaceWallCornerAnchors(room: CapturedRoom) {
        guard let view = sceneView?.superview as? ARRulerNativeView else { return }
        
        // Extract wall endpoints (corners) from transform + dimensions
        var cornerPoints: [SCNVector3] = []
        
        for wall in room.walls {
            let pos = wall.transform.columns.3
            let halfW = wall.dimensions.x / 2
            
            // Wall local X axis (width direction)
            let xAxis = simd_float3(wall.transform.columns.0.x, wall.transform.columns.0.y, wall.transform.columns.0.z)
            let normalizedX = simd_normalize(xAxis)
            
            // Two endpoints of the wall (at floor level)
            let floorY = pos.y - wall.dimensions.y / 2
            let p1 = SCNVector3(
                pos.x + normalizedX.x * halfW,
                floorY,
                pos.z + normalizedX.z * halfW
            )
            let p2 = SCNVector3(
                pos.x - normalizedX.x * halfW,
                floorY,
                pos.z - normalizedX.z * halfW
            )
            cornerPoints.append(p1)
            cornerPoints.append(p2)
        }
        
        // Deduplicate corners within 30cm radius
        var uniqueCorners: [SCNVector3] = []
        for pt in cornerPoints {
            let isDuplicate = uniqueCorners.contains { existing in
                let dx = existing.x - pt.x
                let dz = existing.z - pt.z
                return sqrt(dx*dx + dz*dz) < 0.3
            }
            if !isDuplicate {
                uniqueCorners.append(pt)
            }
        }
        
        // Create anchors at corner positions
        var addedCount = 0
        for (i, corner) in uniqueCorners.enumerated() {
            let anchorId = UUID().uuidString
            let anchor: [String: Any] = [
                "id": anchorId,
                "name": "Corner \(i + 1)",
                "type": "roomplan_corner",
                "position_x": corner.x,
                "position_y": corner.y,
                "position_z": corner.z,
                "rotation_x": Float(0),
                "rotation_y": Float(0),
                "rotation_z": Float(0)
            ]
            view.sceneAnchors.append(anchor)
            
            let markerNode = view.createAnchorMarker(
                position: corner,
                name: "Corner \(i + 1)",
                type: "roomplan_corner"
            )
            view.arView.scene.rootNode.addChildNode(markerNode)
            view.sceneAnchorNodes.append(markerNode)
            addedCount += 1
        }
        
        print("[RoomPlan] Auto-placed \(addedCount) corner anchors from \(room.walls.count) walls")
    }
    
    // MARK: - Real-time AR Visualization (fallback for iOS 16 / post-scan)
    
    private func updateARVisualization(room: CapturedRoom) {
        for node in roomNodes {
            node.removeFromParentNode()
        }
        roomNodes.removeAll()
        
        for wall in room.walls {
            let node = createBoxNode(dimensions: wall.dimensions, transform: wall.transform, color: wallColor, edgeColor: wallEdgeColor, label: "Wall")
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
        
        for door in room.doors {
            let node = createBoxNode(dimensions: door.dimensions, transform: door.transform, color: doorColor, edgeColor: doorEdgeColor, label: "Door")
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
        
        for window in room.windows {
            let node = createBoxNode(dimensions: window.dimensions, transform: window.transform, color: windowColor, edgeColor: windowEdgeColor, label: "Window")
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
        
        for opening in room.openings {
            let node = createBoxNode(dimensions: opening.dimensions, transform: opening.transform, color: openingColor, edgeColor: openingEdgeColor, label: "Opening")
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
        
        if #available(iOS 17.0, *) {
            for floor in room.floors {
                let node = createBoxNode(dimensions: floor.dimensions, transform: floor.transform, color: floorColor, edgeColor: floorEdgeColor, label: "Floor")
                roomRootNode.addChildNode(node)
                roomNodes.append(node)
            }
        }
        
        // Render objects (furniture)
        for obj in room.objects {
            let label: String
            switch obj.category {
            case .table: label = "Table"
            case .chair: label = "Chair"
            case .sofa: label = "Sofa"
            case .bed: label = "Bed"
            case .storage: label = "Storage"
            case .refrigerator: label = "Fridge"
            case .stove: label = "Stove"
            case .oven: label = "Oven"
            case .sink: label = "Sink"
            case .washerDryer: label = "Washer"
            case .toilet: label = "Toilet"
            case .bathtub: label = "Bathtub"
            case .television: label = "TV"
            default: label = "Object"
            }
            let node = createBoxNode(
                dimensions: obj.dimensions,
                transform: obj.transform,
                color: objectColor,
                edgeColor: objectEdgeColor,
                label: label
            )
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
    }
    
    private func createBoxNode(dimensions: simd_float3, transform: simd_float4x4, color: UIColor, edgeColor: UIColor = .white, label: String) -> SCNNode {
        let container = SCNNode()
        container.categoryBitMask = 4  // Tag for toggle + snapping
        container.name = "roomplan_\(label.lowercased())"
        
        // Very subtle translucent fill
        let box = SCNBox(width: CGFloat(dimensions.x), height: CGFloat(dimensions.y), length: CGFloat(dimensions.z), chamferRadius: 0)
        let material = SCNMaterial()
        material.diffuse.contents = color
        material.lightingModel = .constant
        material.isDoubleSided = true
        material.transparency = 1.0
        material.writesToDepthBuffer = false
        box.materials = [material]
        let boxNode = SCNNode(geometry: box)
        boxNode.categoryBitMask = 4
        container.addChildNode(boxNode)
        
        // Primary wireframe — bright, visible edges
        let wireBox = SCNBox(width: CGFloat(dimensions.x) + 0.005, height: CGFloat(dimensions.y) + 0.005, length: CGFloat(dimensions.z) + 0.005, chamferRadius: 0)
        let wireMat = SCNMaterial()
        wireMat.diffuse.contents = edgeColor
        wireMat.emission.contents = edgeColor.withAlphaComponent(0.6)  // Glow effect
        wireMat.lightingModel = .constant
        wireMat.fillMode = .lines
        wireMat.isDoubleSided = true
        wireBox.materials = [wireMat]
        let wireNode = SCNNode(geometry: wireBox)
        wireNode.categoryBitMask = 4
        container.addChildNode(wireNode)
        
        // Outer glow wireframe — thicker, softer bloom
        let glowBox = SCNBox(width: CGFloat(dimensions.x) + 0.02, height: CGFloat(dimensions.y) + 0.02, length: CGFloat(dimensions.z) + 0.02, chamferRadius: 0)
        let glowMat = SCNMaterial()
        glowMat.diffuse.contents = edgeColor.withAlphaComponent(0.15)
        glowMat.emission.contents = edgeColor.withAlphaComponent(0.3)
        glowMat.lightingModel = .constant
        glowMat.fillMode = .lines
        glowMat.isDoubleSided = true
        glowBox.materials = [glowMat]
        let glowNode = SCNNode(geometry: glowBox)
        glowNode.categoryBitMask = 4
        container.addChildNode(glowNode)
        
        // Compact label — small, clean, no emoji
        let text = SCNText(string: label.uppercased(), extrusionDepth: 0.2)
        text.font = UIFont.systemFont(ofSize: 5, weight: .semibold)
        text.flatness = 0.1
        let textMat = SCNMaterial()
        textMat.diffuse.contents = edgeColor
        textMat.emission.contents = edgeColor.withAlphaComponent(0.4)
        textMat.lightingModel = .constant
        text.materials = [textMat]
        let textNode = SCNNode(geometry: text)
        textNode.scale = SCNVector3(0.004, 0.004, 0.004)
        let (minBound, maxBound) = textNode.boundingBox
        let textW = (maxBound.x - minBound.x) * 0.004
        let textH = (maxBound.y - minBound.y) * 0.004
        textNode.position = SCNVector3(
            -textW / 2,
            dimensions.y / 2 + 0.04,
            0
        )
        
        // Small dark background pill
        let bgPlane = SCNPlane(width: CGFloat(textW + 0.02), height: CGFloat(textH + 0.01))
        let bgMat = SCNMaterial()
        bgMat.diffuse.contents = UIColor.black.withAlphaComponent(0.6)
        bgMat.lightingModel = .constant
        bgPlane.materials = [bgMat]
        bgPlane.cornerRadius = CGFloat(textH * 0.4)
        let bgNode = SCNNode(geometry: bgPlane)
        bgNode.position = SCNVector3(0, dimensions.y / 2 + 0.04 + textH / 2, -0.001)
        
        let labelGroup = SCNNode()
        labelGroup.addChildNode(bgNode)
        labelGroup.addChildNode(textNode)
        labelGroup.constraints = [SCNBillboardConstraint()]
        labelGroup.categoryBitMask = 4
        container.addChildNode(labelGroup)
        
        // Apply transform
        container.simdTransform = transform
        
        return container
    }
    
    // MARK: - Toggle Visibility
    func setVisible(_ visible: Bool) {
        isVisible = visible
        roomRootNode.isHidden = !visible
    }
    
    // MARK: - Export structured RoomPlan data
    
    func exportRoomPlanData() -> [String: Any] {
        guard let room = latestRoom else {
            print("[RoomPlan] ⚠️ exportRoomPlanData: latestRoom is nil — no data yet")
            return [:]
        }
        print("[RoomPlan] 📤 exportRoomPlanData: \(room.walls.count) walls, \(room.doors.count) doors")
        
        var walls: [[String: Any]] = []
        for wall in room.walls {
            walls.append(surfaceToDict(id: wall.identifier, dimensions: wall.dimensions, transform: wall.transform, category: "wall"))
        }
        
        var doors: [[String: Any]] = []
        for door in room.doors {
            doors.append(surfaceToDict(id: door.identifier, dimensions: door.dimensions, transform: door.transform, category: "door"))
        }
        
        var windows: [[String: Any]] = []
        for window in room.windows {
            windows.append(surfaceToDict(id: window.identifier, dimensions: window.dimensions, transform: window.transform, category: "window"))
        }
        
        var openings: [[String: Any]] = []
        for opening in room.openings {
            openings.append(surfaceToDict(id: opening.identifier, dimensions: opening.dimensions, transform: opening.transform, category: "opening"))
        }
        
        var floors: [[String: Any]] = []
        if #available(iOS 17.0, *) {
            for floor in room.floors {
                floors.append(surfaceToDict(id: floor.identifier, dimensions: floor.dimensions, transform: floor.transform, category: "floor"))
            }
        }
        
        var objects: [[String: Any]] = []
        for obj in room.objects {
            var className = "unknown"
            switch obj.category {
            case .chair: className = "chair"
            case .table: className = "table"
            case .sofa: className = "sofa"
            case .bed: className = "bed"
            case .storage: className = "storage"
            case .refrigerator: className = "refrigerator"
            case .stove: className = "stove"
            case .oven: className = "oven"
            case .sink: className = "sink"
            case .washerDryer: className = "washerDryer"
            case .toilet: className = "toilet"
            case .bathtub: className = "bathtub"
            case .television: className = "television"
            default: className = "unknown"
            }
            objects.append(surfaceToDict(id: obj.identifier, dimensions: obj.dimensions, transform: obj.transform, category: className))
        }
        
        return [
            "walls": walls,
            "doors": doors,
            "windows": windows,
            "openings": openings,
            "floors": floors,
            "objects": objects,
            "wallCount": walls.count,
            "doorCount": doors.count,
            "windowCount": windows.count,
            "objectCount": objects.count,
            "isFinalized": isFinalized,
            "inferredCeilingY": inferredCeilingY as Any,
            "inferredFloorY": inferredFloorY as Any
        ]
    }
    
    private func surfaceToDict(id: UUID, dimensions: simd_float3, transform: simd_float4x4, category: String) -> [String: Any] {
        return [
            "identifier": id.uuidString,
            "category": category,
            "dimensions": ["width": dimensions.x, "height": dimensions.y, "depth": dimensions.z],
            "position": ["x": transform.columns.3.x, "y": transform.columns.3.y, "z": transform.columns.3.z],
            "transform": [
                transform.columns.0.x, transform.columns.0.y, transform.columns.0.z, transform.columns.0.w,
                transform.columns.1.x, transform.columns.1.y, transform.columns.1.z, transform.columns.1.w,
                transform.columns.2.x, transform.columns.2.y, transform.columns.2.z, transform.columns.2.w,
                transform.columns.3.x, transform.columns.3.y, transform.columns.3.z, transform.columns.3.w
            ]
        ]
    }
    
    // MARK: - Per-Element Export (for UUID-based DB persistence)
    
    func exportRoomPlanElements() -> [[String: Any]] {
        guard let room = latestRoom else { return [] }
        
        var elements: [[String: Any]] = []
        
        // Walls
        for wall in room.walls {
            elements.append(elementToDict(id: wall.identifier, category: "wall", subcategory: nil, 
                                          dimensions: wall.dimensions, transform: wall.transform))
        }
        
        // Doors
        for door in room.doors {
            elements.append(elementToDict(id: door.identifier, category: "door", subcategory: nil,
                                          dimensions: door.dimensions, transform: door.transform))
        }
        
        // Windows
        for window in room.windows {
            elements.append(elementToDict(id: window.identifier, category: "window", subcategory: nil,
                                          dimensions: window.dimensions, transform: window.transform))
        }
        
        // Openings
        for opening in room.openings {
            elements.append(elementToDict(id: opening.identifier, category: "opening", subcategory: nil,
                                          dimensions: opening.dimensions, transform: opening.transform))
        }
        
        // Floors
        if #available(iOS 17.0, *) {
            for floor in room.floors {
                elements.append(elementToDict(id: floor.identifier, category: "floor", subcategory: nil,
                                              dimensions: floor.dimensions, transform: floor.transform))
            }
        }
        
        // Objects (furniture)
        for obj in room.objects {
            var subcategory = "unknown"
            switch obj.category {
            case .chair: subcategory = "chair"
            case .table: subcategory = "table"
            case .sofa: subcategory = "sofa"
            case .bed: subcategory = "bed"
            case .storage: subcategory = "storage"
            case .refrigerator: subcategory = "refrigerator"
            case .stove: subcategory = "stove"
            case .oven: subcategory = "oven"
            case .sink: subcategory = "sink"
            case .washerDryer: subcategory = "washerDryer"
            case .toilet: subcategory = "toilet"
            case .bathtub: subcategory = "bathtub"
            case .television: subcategory = "television"
            case .fireplace: subcategory = "fireplace"
            case .dishwasher: subcategory = "dishwasher"
            case .stairs: subcategory = "stairs"
            default: subcategory = "unknown"
            }
            elements.append(elementToDict(id: obj.identifier, category: "object", subcategory: subcategory,
                                          dimensions: obj.dimensions, transform: obj.transform))
        }
        
        return elements
    }
    
    private func elementToDict(id: UUID, category: String, subcategory: String?,
                                dimensions: simd_float3, transform: simd_float4x4) -> [String: Any] {
        var dict: [String: Any] = [
            "id": id.uuidString,
            "category": category,
            "dimensions": ["width": dimensions.x, "height": dimensions.y, "depth": dimensions.z],
            "transform": [
                transform.columns.0.x, transform.columns.0.y, transform.columns.0.z, transform.columns.0.w,
                transform.columns.1.x, transform.columns.1.y, transform.columns.1.z, transform.columns.1.w,
                transform.columns.2.x, transform.columns.2.y, transform.columns.2.z, transform.columns.2.w,
                transform.columns.3.x, transform.columns.3.y, transform.columns.3.z, transform.columns.3.w
            ],
            "is_finalized": isFinalized
        ]
        if let sub = subcategory {
            dict["subcategory"] = sub
        }
        return dict
    }
}

// MARK: - iOS 17+ Extension: RoomCaptureView support
@available(iOS 17.0, *)
extension RoomPlanController: RoomCaptureViewDelegate {
    // MARK: - Start with RoomCaptureView overlay
    
    func startWithCaptureView(parentView: UIView, arSession: ARSession) {
        isFinalized = false
        finalizedRoom = nil
        capturedRoomData = nil
        
        let rcView = RoomCaptureView(frame: parentView.bounds)
        rcView.captureSession.delegate = self
        rcView.delegate = self
        rcView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        rcView.tag = 999  // For easy removal
        parentView.addSubview(rcView)
        
        let config = RoomCaptureSession.Configuration()
        rcView.captureSession.run(configuration: config)
        self.session = rcView.captureSession
        self.roomCaptureViewRef = rcView
        
        print("[RoomPlan] RoomCaptureView overlay started")
    }
    
    // MARK: - RoomCaptureViewDelegate
    
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        // Return false to skip Apple's post-scan preview (we handle our own)
        return false
    }
    
    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        // Only called if shouldPresent returns true
        self.finalizedRoom = processedResult
        self.latestRoom = processedResult
        self.isFinalized = true
    }
}
