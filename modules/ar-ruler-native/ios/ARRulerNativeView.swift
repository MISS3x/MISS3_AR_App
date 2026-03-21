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
  
  // RoomPlan (iOS 16+)
  private var roomPlanController: Any?

  // Scene Nodes
  private var pointNodes: [SCNNode] = []
  private var lineNodes: [SCNNode] = []
  private var labels: [SCNNode] = []
  
  // Ghost preview line (from last point to cursor)
  private var ghostLineNode: SCNNode?
  private var ghostDistLabel: SCNNode?
  
  private var pointerNode: SCNNode?
  private var distanceLabel: SCNNode?
  private var axisNodes: [SCNNode] = [] // X, Y, Z axis lines

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
    drawSphere(at: snappedPos, color: color)
    
    if currentPolygon.count > 1 {
      let prevPos = currentPolygon[currentPolygon.count - 2]
      drawLine(from: prevPos, to: snappedPos, color: color)

      let length = distance(from: prevPos, to: snappedPos)
      let midPoint = SCNVector3((prevPos.x + snappedPos.x)/2, (prevPos.y + snappedPos.y)/2, (prevPos.z + snappedPos.z)/2)
      drawText(text: String(format: "%.2fm", length), at: midPoint)
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
      "bounding_boxes": boundingBoxes
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
         
         arView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
         promise.resolve(true)
      } else {
         promise.reject("WORLDMAP_LOAD", "Failed to deserialize ARWorldMap")
      }
    } catch {
      promise.reject("WORLDMAP_READ", error.localizedDescription)
    }
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

  // MARK: - Start Room Scan (user-controlled)
  func startRoomScan() {
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController {
            rpc.start(arSession: arView.session)
            print("[RoomPlan] User started room scan")
        }
    }
  }

  // MARK: - Stop Room Scan (triggers finalization)
  func stopRoomScan() {
    if #available(iOS 16.0, *) {
        if let rpc = roomPlanController as? RoomPlanController {
            rpc.stop()
            print("[RoomPlan] User stopped room scan — finalization will auto-trigger")
        }
    }
  }

  // MARK: - Load Shapes from Supabase
  func loadShapes(shapes: [[String: Any]]) -> Int {
    var count = 0
    for shape in shapes {
      guard let payload = shape["payload"] as? [String: Any],
            let pointsArr = payload["points"] as? [[String: Any]] else { continue }
      
      let shapeType = payload["type"] as? String ?? "floor"
      let color: UIColor
      switch shapeType {
      case "wall": color = wallPink
      case "free", "line", "polyline": color = freeOrange
      default: color = tronBlue
      }
      
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
      
      // Create wireframe box
      let boxGeo = SCNBox(width: CGFloat(w), height: CGFloat(h), length: CGFloat(d), chamferRadius: 0)
      boxGeo.firstMaterial?.fillMode = .lines
      boxGeo.firstMaterial?.diffuse.contents = color
      boxGeo.firstMaterial?.lightingModel = .constant
      boxGeo.firstMaterial?.isDoubleSided = true
      boxGeo.firstMaterial?.readsFromDepthBuffer = false
      
      let boxNode = SCNNode(geometry: boxGeo)
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
class RoomPlanController: NSObject, RoomCaptureSessionDelegate {
    var session: RoomCaptureSession?
    var latestRoom: CapturedRoom?
    var finalizedRoom: CapturedRoom?  // Post-processed by RoomBuilder
    var capturedRoomData: CapturedRoomData?  // Raw data for RoomBuilder
    var isFinalized: Bool = false
    weak var sceneView: ARSCNView?
    
    // Inferred ceiling
    var inferredCeilingY: Float?
    var inferredFloorY: Float?
    
    // Nodes for real-time rendering
    private var roomNodes: [SCNNode] = []
    private let roomRootNode = SCNNode()
    
    // Colors for each element type
    private let wallColor = UIColor(red: 0.3, green: 0.5, blue: 0.9, alpha: 0.25)
    private let doorColor = UIColor(red: 1.0, green: 0.6, blue: 0.0, alpha: 0.35)
    private let windowColor = UIColor(red: 0.0, green: 0.9, blue: 1.0, alpha: 0.35)
    private let floorColor = UIColor(red: 0.0, green: 0.8, blue: 0.3, alpha: 0.15)
    private let openingColor = UIColor(red: 0.8, green: 0.8, blue: 0.0, alpha: 0.25)
    private let objectColor = UIColor(red: 0.9, green: 0.3, blue: 0.9, alpha: 0.2)
    private let ceilingColor = UIColor(red: 0.7, green: 0.7, blue: 0.9, alpha: 0.1)
    
    func start(arSession: ARSession) {
        if #available(iOS 17.0, *) {
            let config = RoomCaptureSession.Configuration()
            session = RoomCaptureSession(arSession: arSession)
            session?.delegate = self
            session?.run(configuration: config)
            isFinalized = false
            finalizedRoom = nil
            capturedRoomData = nil
            // Add root node to scene
            sceneView?.scene.rootNode.addChildNode(roomRootNode)
            print("[RoomPlan] Session started")
        }
    }
    
    func stop() {
        session?.stop()
        // Don't remove visualization — keep it visible
        print("[RoomPlan] Session stopped, waiting for finalization...")
    }
    
    func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
        self.latestRoom = room
        inferCeilingAndFloor(from: room)
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
            // Auto-finalize
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
                    self.latestRoom = finalRoom  // Override preview with clean version
                    self.isFinalized = true
                    self.inferCeilingAndFloor(from: finalRoom)
                    self.updateARVisualization(room: finalRoom)
                    print("[RoomPlan] ✅ Finalized! Walls:\(finalRoom.walls.count) Doors:\(finalRoom.doors.count) Win:\(finalRoom.windows.count) Obj:\(finalRoom.objects.count)")
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
    
    // MARK: - Real-time AR Visualization
    
    private func updateARVisualization(room: CapturedRoom) {
        // Clear old nodes
        for node in roomNodes {
            node.removeFromParentNode()
        }
        roomNodes.removeAll()
        
        // Render walls
        for wall in room.walls {
            let node = createBoxNode(
                dimensions: wall.dimensions,
                transform: wall.transform,
                color: wallColor,
                label: "Wall"
            )
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
        
        // Render doors
        for door in room.doors {
            let node = createBoxNode(
                dimensions: door.dimensions,
                transform: door.transform,
                color: doorColor,
                label: "Door"
            )
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
        
        // Render windows
        for window in room.windows {
            let node = createBoxNode(
                dimensions: window.dimensions,
                transform: window.transform,
                color: windowColor,
                label: "Window"
            )
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
        
        // Render openings
        for opening in room.openings {
            let node = createBoxNode(
                dimensions: opening.dimensions,
                transform: opening.transform,
                color: openingColor,
                label: "Opening"
            )
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
        
        // Render floors (iOS 17+)
        if #available(iOS 17.0, *) {
            for floor in room.floors {
                let node = createBoxNode(
                    dimensions: floor.dimensions,
                    transform: floor.transform,
                    color: floorColor,
                    label: "Floor"
                )
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
                label: label
            )
            roomRootNode.addChildNode(node)
            roomNodes.append(node)
        }
    }
    
    private func createBoxNode(dimensions: simd_float3, transform: simd_float4x4, color: UIColor, label: String) -> SCNNode {
        let container = SCNNode()
        
        // Translucent filled box
        let box = SCNBox(width: CGFloat(dimensions.x), height: CGFloat(dimensions.y), length: CGFloat(dimensions.z), chamferRadius: 0)
        let material = SCNMaterial()
        material.diffuse.contents = color
        material.lightingModel = .constant
        material.isDoubleSided = true
        material.transparency = 1.0
        material.writesToDepthBuffer = false
        box.materials = [material]
        let boxNode = SCNNode(geometry: box)
        container.addChildNode(boxNode)
        
        // Wireframe edges — THICK offset for visibility
        let offset: CGFloat = 0.01
        let wireBox = SCNBox(width: CGFloat(dimensions.x) + offset, height: CGFloat(dimensions.y) + offset, length: CGFloat(dimensions.z) + offset, chamferRadius: 0)
        let wireMaterial = SCNMaterial()
        wireMaterial.diffuse.contents = color.withAlphaComponent(1.0)
        wireMaterial.lightingModel = .constant
        wireMaterial.fillMode = .lines
        wireMaterial.isDoubleSided = true
        wireBox.materials = [wireMaterial]
        let wireNode = SCNNode(geometry: wireBox)
        container.addChildNode(wireNode)
        
        // Label above — LARGE with emoji prefix and background
        let emoji: String
        switch label {
        case "Wall": emoji = "🧱"
        case "Door": emoji = "🚪"
        case "Window": emoji = "🪟"
        case "Floor": emoji = "⬛"
        case "Opening": emoji = "🚶"
        case "Table": emoji = "🪑"
        case "Chair": emoji = "💺"
        case "Sofa": emoji = "🛋"
        case "Bed": emoji = "🛏"
        case "TV": emoji = "📺"
        default: emoji = "📦"
        }
        
        let displayLabel = "\(emoji) \(label)"
        let text = SCNText(string: displayLabel, extrusionDepth: 0.5)
        text.font = UIFont.systemFont(ofSize: 8, weight: .heavy)
        text.flatness = 0.1
        let textMat = SCNMaterial()
        textMat.diffuse.contents = UIColor.white
        textMat.lightingModel = .constant
        text.materials = [textMat]
        let textNode = SCNNode(geometry: text)
        textNode.scale = SCNVector3(0.008, 0.008, 0.008)
        let (minBound, maxBound) = textNode.boundingBox
        let textW = (maxBound.x - minBound.x) * 0.008
        let textH = (maxBound.y - minBound.y) * 0.008
        textNode.position = SCNVector3(
            -textW / 2,
            dimensions.y / 2 + 0.08,
            0
        )
        
        // Background pill behind text
        let bgPlane = SCNPlane(width: CGFloat(textW + 0.04), height: CGFloat(textH + 0.02))
        let bgMat = SCNMaterial()
        bgMat.diffuse.contents = UIColor.black.withAlphaComponent(0.75)
        bgMat.lightingModel = .constant
        bgPlane.materials = [bgMat]
        bgPlane.cornerRadius = CGFloat(textH * 0.3)
        let bgNode = SCNNode(geometry: bgPlane)
        bgNode.position = SCNVector3(0, dimensions.y / 2 + 0.08 + textH / 2, -0.001)
        
        let labelGroup = SCNNode()
        labelGroup.addChildNode(bgNode)
        labelGroup.addChildNode(textNode)
        labelGroup.constraints = [SCNBillboardConstraint()]
        container.addChildNode(labelGroup)
        
        // Apply transform
        container.simdTransform = transform
        
        return container
    }
    
    // MARK: - Export structured RoomPlan data
    
    func exportRoomPlanData() -> [String: Any] {
        guard let room = latestRoom else { return [:] }
        
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
}
