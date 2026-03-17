import ExpoModulesCore
import ARKit
import SceneKit
import UIKit
import Metal

class ARRulerNativeView: ExpoView, ARSCNViewDelegate, ARSessionDelegate {
  let arView = ARSCNView(frame: .zero)
  let onUpdate = EventDispatcher()
  let onPlaneStateChange = EventDispatcher()

  // State
  public var isWallMode: Bool = false
  
  private var floorPoints: [SCNVector3] = []
  private var ceilingPoints: [SCNVector3] = []
  private var floorY: Float? = nil
  private var ceilingY: Float? = nil
  private var currentPolygon: [SCNVector3] = []
  private var closedShapes: [[String: Any]] = []
  
  private var floorNumberNodes: [SCNNode] = []
  private var ceilingNumberNodes: [SCNNode] = []
  private var floorStartPointNode: SCNNode?

  // Scene Nodes
  private var pointNodes: [SCNNode] = []
  private var lineNodes: [SCNNode] = []
  private var labels: [SCNNode] = []
  
  private var pointerNode: SCNNode?
  private var distanceLabel: SCNNode?
  private var crosshairRing: SCNNode?
  private var ghostSphere: SCNNode?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    addSubview(arView)
    
    arView.delegate = self
    arView.session.delegate = self
    arView.autoenablesDefaultLighting = false // Custom lighting for wireframe
    
    // Ambient for general UI if needed (though we use .constant)
    let ambient = SCNLight()
    ambient.type = .ambient
    ambient.color = UIColor.white
    ambient.categoryBitMask = 1
    let ambNode = SCNNode()
    ambNode.light = ambient
    arView.scene.rootNode.addChildNode(ambNode)
    
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
      // Enable LiDAR scene reconstruction if available
      if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
        config.sceneReconstruction = .mesh
      }
      arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    } else {
      arView.session.pause()
    }
  }

  private func setupPointer() {
    let focusNode = SCNNode()

    // 1) The Crosshair Ring
    let ring = SCNTorus(ringRadius: 0.05, pipeRadius: 0.002)
    ring.firstMaterial?.diffuse.contents = UIColor.yellow
    let ringNode = SCNNode(geometry: ring)
    ringNode.eulerAngles.x = .pi / 2 // lay flat
    focusNode.addChildNode(ringNode)
    self.crosshairRing = ringNode

    // 2) Ghost Sphere Preview
    let ghost = SCNPlane(width: 0.04, height: 0.04)
    ghost.cornerRadius = 0.02
    ghost.firstMaterial?.diffuse.contents = UIColor(white: 1.0, alpha: 0.5) // semi-transparent white
    ghost.firstMaterial?.isDoubleSided = true
    let ghostNode = SCNNode(geometry: ghost)
    ghostNode.eulerAngles.x = -.pi / 2
    focusNode.addChildNode(ghostNode)
    self.ghostSphere = ghostNode

    // 3) Distance Label
    let textGeo = SCNText(string: "0.00m", extrusionDepth: 0.0)
    textGeo.font = UIFont.systemFont(ofSize: 5)
    textGeo.firstMaterial?.diffuse.contents = UIColor.white
    textGeo.firstMaterial?.isDoubleSided = true
    let textNode = SCNNode(geometry: textGeo)
    textNode.scale = SCNVector3(0.005, 0.005, 0.005)
    
    // Billboard constraint so text always faces camera
    let billboard = SCNBillboardConstraint()
    billboard.freeAxes = .Y
    textNode.constraints = [billboard]
    
    // Position label slightly offset from the ring
    textNode.position = SCNVector3(0.06, 0.02, 0)
    focusNode.addChildNode(textNode)
    self.distanceLabel = textNode
    
    // 4) LiDAR Scanner Light (Category mask 2)
    let scannerLight = SCNLight()
    scannerLight.type = .omni
    scannerLight.color = UIColor(red: 0, green: 1, blue: 1, alpha: 1.0) // Cyan
    scannerLight.attenuationStartDistance = 0.0
    scannerLight.attenuationEndDistance = 0.5
    scannerLight.attenuationFalloffExponent = 2.0
    scannerLight.categoryBitMask = 2
    
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

  func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
      if #available(iOS 13.4, *) {
          if let meshAnchor = anchor as? ARMeshAnchor {
              let rootNode = SCNNode()
              
              // 1) Occluder
              let occGeometry = createGeometry(from: meshAnchor)
              occGeometry.firstMaterial?.colorBufferWriteMask = []
              let occNode = SCNNode(geometry: occGeometry)
              rootNode.addChildNode(occNode)
              
              // 2) Wireframe (Only illuminated by pointer light)
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

  private func updatePointer(frame: ARFrame) {
    let screenCenter = CGPoint(x: bounds.midX, y: bounds.midY)
    
    let cameraPos = SCNVector3(frame.camera.transform.columns.3.x,
                               frame.camera.transform.columns.3.y,
                               frame.camera.transform.columns.3.z)
    let cameraDir = SCNVector3(-frame.camera.transform.columns.2.x,
                               -frame.camera.transform.columns.2.y,
                               -frame.camera.transform.columns.2.z)

    var hitPosition: SCNVector3? = nil
    var pointerColor: UIColor = .white

    // 1) Raycast Logic
    if isWallMode {
         // Wall Mode prioritizes catching vertical planes or Raw LiDAR feature points
         if let result = arView.hitTest(screenCenter, types: [.existingPlaneUsingExtent, .estimatedVerticalPlane, .featurePoint]).first {
             hitPosition = SCNVector3(result.worldTransform.columns.3.x,
                                      result.worldTransform.columns.3.y,
                                      result.worldTransform.columns.3.z)
         }
    } else {
        // Floor Mode
        if floorY != nil && ceilingY != nil {
            // We are drawing polygons -> MATHEMATICAL INTERSECTION on infinite Floor Plane
            let t = (floorY! - cameraPos.y) / cameraDir.y
            if t > 0 && t < 20.0 { // limit distance to 20m
                hitPosition = SCNVector3(cameraPos.x + t * cameraDir.x,
                                         floorY!,
                                         cameraPos.z + t * cameraDir.z)
            }
        } else {
            // We are detecting Floor / Ceiling -> PHYSICAL Hit Test
            if let result = arView.hitTest(screenCenter, types: [.existingPlaneUsingExtent, .estimatedHorizontalPlane, .estimatedVerticalPlane, .featurePoint]).first {
                hitPosition = SCNVector3(result.worldTransform.columns.3.x,
                                         result.worldTransform.columns.3.y,
                                         result.worldTransform.columns.3.z)
            }
        }
    }

    guard let position = hitPosition else {
      pointerNode?.isHidden = true
      onPlaneStateChange(["status": "searching"])
      return
    }

    pointerNode?.isHidden = false
    pointerNode?.position = position
    
    // 2) Pointer Visuals
    var ghostColor = pointerColor
    
    if isWallMode {
        pointerColor = .blue
        ghostColor = UIColor(red: 0, green: 0, blue: 1, alpha: 0.5)
    } else {
        if floorY == nil {
            pointerColor = .green
            ghostColor = UIColor(red: 0, green: 1, blue: 0, alpha: 0.5)
        } else if ceilingY == nil {
            pointerColor = .blue
            ghostColor = UIColor(red: 0, green: 0, blue: 1, alpha: 0.5)
        } else {
            pointerColor = .red
            ghostColor = UIColor(red: 1, green: 0, blue: 0, alpha: 0.5)
        }
    }
    
    crosshairRing?.geometry?.firstMaterial?.diffuse.contents = pointerColor
    ghostSphere?.geometry?.firstMaterial?.diffuse.contents = ghostColor
    ghostSphere?.position = SCNVector3(0, 0, 0) // Align exactly with pointerNode since pointerNode is already on the floor

    // Calculate Real Distance from camera to point
    let dist = distance(from: cameraPos, to: position)
    
    // Scale pointer inversely to distance: smaller when far, bigger when close
    let scaleFactor = max(0.2, min(5.0, 1.0 / max(0.1, dist))) // clamp between 0.2 and 5.0
    pointerNode?.scale = SCNVector3(scaleFactor, scaleFactor, scaleFactor)
    
    if let textGeo = distanceLabel?.geometry as? SCNText {
        textGeo.string = String(format: "%.2fm", dist)
        
        // Re-center text node
        let (min, max) = textGeo.boundingBox
        let dx = min.x + 0.5 * (max.x - min.x)
        let dy = min.y + 0.5 * (max.y - min.y)
        textLabelPivot(node: distanceLabel!, dx: dx, dy: dy)
    }
    
    onPlaneStateChange(["status": "plane_found"])
  }

  private func textLabelPivot(node: SCNNode, dx: Float, dy: Float) {
      node.pivot = SCNMatrix4MakeTranslation(dx, dy, 0)
  }

  // MARK: - Interaction
  func addPoint() {
    // The "Ruler" paradigm relies on the center-screen crosshair.
    guard let pointer = pointerNode, !pointer.isHidden else { return }
    
    let hitPos = pointer.position

    if isWallMode {
        addPolygonPoint(at: hitPos, color: .cyan)
    } else {
        if floorY == nil {
          if floorPoints.count < 3 {
            placeFloorPoint(at: hitPos)
          }
        } else if ceilingY == nil {
          if ceilingPoints.count < 3 {
            placeCeilingPoint(at: hitPos)
          }
        } else {
          addPolygonPoint(at: hitPos, color: .red) // Snaps to floor internally
        }
    }
  }

  private func placeFloorPoint(at position: SCNVector3) {
    floorPoints.append(position)
    drawSphere(at: position, color: .green)
    
    // Draw 1, 2, 3 text label
    drawNumberLabel(number: floorPoints.count, at: position, nodesArray: &floorNumberNodes, isFloor: true)
    
    if floorPoints.count == 3 {
      let sum = floorPoints.reduce(0) { $0 + $1.y }
      self.floorY = sum / 3.0
      
      // Delete hovering numbers
      floorNumberNodes.forEach { $0.removeFromParentNode() }
      floorNumberNodes.removeAll()
      
      // Place start point (red dot) on the estimated floor average coordinate
      let cx = floorPoints.reduce(0) { $0 + $1.x } / 3
      let cz = floorPoints.reduce(0) { $0 + $1.z } / 3
      let centerFloorPos = SCNVector3(cx, self.floorY!, cz)
      
      let circle = SCNPlane(width: 0.04, height: 0.04)
      circle.cornerRadius = 0.02
      circle.firstMaterial?.diffuse.contents = UIColor.red
      circle.firstMaterial?.lightingModel = .constant
      circle.firstMaterial?.isDoubleSided = true
      
      let node = SCNNode(geometry: circle)
      node.position = centerFloorPos
      node.eulerAngles.x = -.pi / 2
      arView.scene.rootNode.addChildNode(node)
      self.floorStartPointNode = node
      pointNodes.append(node)
      
      onUpdate(["event": "floor_set", "y": self.floorY!])
    } else {
      onUpdate(["event": "floor_point_added", "count": floorPoints.count])
    }
  }

  private func placeCeilingPoint(at position: SCNVector3) {
    ceilingPoints.append(position)
    drawSphere(at: position, color: .blue)
    
    // Draw 1, 2, 3 text label
    drawNumberLabel(number: ceilingPoints.count, at: position, nodesArray: &ceilingNumberNodes, isFloor: false)
    
    if ceilingPoints.count == 3 {
      let sum = ceilingPoints.reduce(0) { $0 + $1.y }
      self.ceilingY = sum / 3.0
      
      // Delete hovering numbers
      ceilingNumberNodes.forEach { $0.removeFromParentNode() }
      ceilingNumberNodes.removeAll()
      
      // Draw a SINGLE red line from the ceiling average to the floor average
      let cx = ceilingPoints.reduce(0) { $0 + $1.x } / 3
      let cz = ceilingPoints.reduce(0) { $0 + $1.z } / 3
      let ceilingCenter = SCNVector3(cx, self.ceilingY!, cz)
      let floorPos = SCNVector3(cx, self.floorY ?? 0, cz)
      
      drawLine(from: floorPos, to: ceilingCenter, color: .red)
      
      let height = abs(self.ceilingY! - (self.floorY ?? 0))
      let midPoint = SCNVector3(cx, (self.ceilingY! + self.floorY!) / 2, cz)
      drawText(text: String(format: "%.2fm", height), at: midPoint)
      
      onUpdate(["event": "ceiling_set", "y": self.ceilingY!, "roomHeight": height])
    } else {
      onUpdate(["event": "ceiling_point_added", "count": ceilingPoints.count])
    }
  }

  private func addPolygonPoint(at position: SCNVector3, color: UIColor) {
    var snappedPos = position
    
    // Snap to floor Y only if we are in floor shape mode (red)
    if !isWallMode, let fy = floorY {
        snappedPos = SCNVector3(position.x, fy, position.z)
    }
    
    currentPolygon.append(snappedPos)
    drawSphere(at: snappedPos, color: color)
    
    if currentPolygon.count > 1 {
      let prevPos = currentPolygon[currentPolygon.count - 2]
      drawLine(from: prevPos, to: snappedPos, color: color)

      let length = distance(from: prevPos, to: snappedPos)
      let midPoint = SCNVector3((prevPos.x + snappedPos.x)/2, (prevPos.y + snappedPos.y)/2, (prevPos.z + snappedPos.z)/2)
      drawText(text: String(format: "%.2fm", length), at: midPoint)
    }
    
    onUpdate(["event": "point_added", "count": currentPolygon.count])
  }

  // MARK: - SceneKit Helpers
  private func drawNumberLabel(number: Int, at pos: SCNVector3, nodesArray: inout [SCNNode], isFloor: Bool) {
    let textGeo = SCNText(string: "\(number)", extrusionDepth: 0.0)
    textGeo.font = UIFont.systemFont(ofSize: 10)
    textGeo.firstMaterial?.diffuse.contents = UIColor.white
    textGeo.firstMaterial?.isDoubleSided = true
    
    let node = SCNNode(geometry: textGeo)
    node.scale = SCNVector3(0.005, 0.005, 0.005)
    
    // Center it horizontally and vertically
    let (min, max) = node.boundingBox
    let dx = min.x + 0.5 * (max.x - min.x)
    let dy = min.y + 0.5 * (max.y - min.y)
    let dz = min.z + 0.5 * (max.z - min.z)
    node.pivot = SCNMatrix4MakeTranslation(dx, dy, dz)
    
    // Show label slightly above floor points, slightly below ceiling points
    let yOffset: Float = isFloor ? 0.05 : -0.05
    node.position = SCNVector3(pos.x, pos.y + yOffset, pos.z)
    
    let billboard = SCNBillboardConstraint()
    billboard.freeAxes = .Y
    node.constraints = [billboard]
    
    arView.scene.rootNode.addChildNode(node)
    nodesArray.append(node)
    labels.append(node)
  }

  private func drawSphere(at position: SCNVector3, color: UIColor) {
    let circle = SCNPlane(width: 0.04, height: 0.04)
    circle.cornerRadius = 0.02
    circle.firstMaterial?.diffuse.contents = color
    circle.firstMaterial?.lightingModel = .constant
    circle.firstMaterial?.isDoubleSided = true
    let node = SCNNode(geometry: circle)
    node.position = position
    node.eulerAngles.x = -.pi / 2
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
        angle = vector.y < 0 ? .pi : 0
    } else {
        axis = SCNVector3(axis.x/axisLength, axis.y/axisLength, axis.z/axisLength)
    }
    
    node.rotation = SCNVector4(axis.x, axis.y, axis.z, angle)
    
    arView.scene.rootNode.addChildNode(node)
    lineNodes.append(node)
  }

  private func drawText(text: String, at pos: SCNVector3, scale: Float = 0.005) {
    let textGeo = SCNText(string: text, extrusionDepth: 0.0)
    textGeo.font = UIFont.systemFont(ofSize: 10)
    textGeo.firstMaterial?.diffuse.contents = UIColor.white
    textGeo.firstMaterial?.isDoubleSided = true
    
    let node = SCNNode(geometry: textGeo)
    node.scale = SCNVector3(scale, scale, scale)
    
    // Center text
    let (min, max) = node.boundingBox
    let dx = min.x + 0.5 * (max.x - min.x)
    let dy = min.y + 0.5 * (max.y - min.y)
    let dz = min.z + 0.5 * (max.z - min.z)
    node.pivot = SCNMatrix4MakeTranslation(dx, dy, dz)
    
    // Position slightly above the line
    node.position = SCNVector3(pos.x, pos.y + 0.1, pos.z)
    
    // Make it always face camera
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
    let color: UIColor = isWallMode ? .cyan : .red
    
    // Draw closing line
    drawLine(from: lastPos, to: firstPos, color: color)
    let length = distance(from: lastPos, to: firstPos)
    let midPoint = SCNVector3((lastPos.x + firstPos.x)/2, (lastPos.y + firstPos.y)/2, (lastPos.z + firstPos.z)/2)
    drawText(text: String(format: "%.2fm", length), at: midPoint)
    
    let area = calculateArea(polygon: currentPolygon)
    
    // Center label for Area
    var cx: Float = 0
    var cy: Float = 0
    var cz: Float = 0
    for p in currentPolygon {
        cx += p.x
        cy += p.y
        cz += p.z
    }
    cx /= Float(currentPolygon.count)
    cy /= Float(currentPolygon.count)
    cz /= Float(currentPolygon.count)
    
    let centerPos = SCNVector3(cx, cy, cz)
    drawText(text: String(format: "%.2f m²", area), at: centerPos, scale: 0.01)
    
    let shapeData: [String: Any] = [
        "type": isWallMode ? "wall" : "floor",
        "area": area,
        "points": currentPolygon.map { ["x": $0.x, "y": $0.y, "z": $0.z] },
        "height": abs((ceilingY ?? 0) - (floorY ?? 0))
    ]
    
    closedShapes.append(shapeData)
    
    // Start new shape, keeping old geometry
    currentPolygon.removeAll()
    
    return shapeData
  }

  func undoLastPoint() {
    guard !currentPolygon.isEmpty else { return }
    currentPolygon.removeLast()
    
    if let lastPoint = pointNodes.popLast() { lastPoint.removeFromParentNode() }
    
    // The first point doesn't have an associated line. 2 points = 1 line.
    if !lineNodes.isEmpty && currentPolygon.count > 0 {
      let lastLine = lineNodes.popLast()
      lastLine?.removeFromParentNode()
      
      let lastLabel = labels.popLast()
      lastLabel?.removeFromParentNode()
    }
    
    onUpdate(["event": "point_removed", "count": currentPolygon.count])
  }

  func getShapes() -> [[String: Any]] {
    return closedShapes
  }
  
  func reset() {
    floorY = nil
    ceilingY = nil
    floorPoints.removeAll()
    ceilingPoints.removeAll()
    currentPolygon.removeAll()
    closedShapes.removeAll()
    
    floorNumberNodes.forEach { $0.removeFromParentNode() }
    ceilingNumberNodes.forEach { $0.removeFromParentNode() }
    floorNumberNodes.removeAll()
    ceilingNumberNodes.removeAll()
    
    floorStartPointNode?.removeFromParentNode()
    floorStartPointNode = nil
    
    pointNodes.forEach { $0.removeFromParentNode() }
    lineNodes.forEach { $0.removeFromParentNode() }
    labels.forEach { $0.removeFromParentNode() }
    
    pointNodes.removeAll()
    lineNodes.removeAll()
    labels.removeAll()
    
    onUpdate(["event": "reset"])
  }

  // MARK: - Math Helpers
  private func calculateArea(polygon: [SCNVector3]) -> Float {
    // generalized 3D Shoelace formula (Newell's method based area)
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
