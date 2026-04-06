import ExpoModulesCore

public class ARRulerNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ARRulerNative")

    View(ARRulerNativeView.self) {
      Events("onUpdate", "onPlaneStateChange")
      
      Prop("measuringState") { (view: ARRulerNativeView, state: String) in
        // e.g., "finding_floor", "finding_ceiling", "polygon"
      }

      Prop("drawingMode") { (view: ARRulerNativeView, mode: String) in
        if let dm = ARRulerNativeView.DrawingMode(rawValue: mode) {
          view.drawingMode = dm
        }
      }

      Prop("meshColor") { (view: ARRulerNativeView, hex: String) in
        view.setMeshColor(hex: hex)
      }

      Prop("showWire") { (view: ARRulerNativeView, show: Bool) in
        view.setShowWire(show: show)
      }

      Prop("showVisualGuides") { (view: ARRulerNativeView, show: Bool) in
        view.showVisualGuides = show
      }

      Prop("showRoomPlan") { (view: ARRulerNativeView, show: Bool) in
        view.setShowRoomPlan(show: show)
      }

      AsyncFunction("closeShape") { (view: ARRulerNativeView) -> [String: Any]? in
        return view.closeShape()
      }
      
      AsyncFunction("undoLastPoint") { (view: ARRulerNativeView) in
        view.undoLastPoint()
      }

      AsyncFunction("addPoint") { (view: ARRulerNativeView) in
        view.addPoint()
      }

      AsyncFunction("addPointAt") { (view: ARRulerNativeView, x: Float, y: Float, z: Float) in
        view.addPointAt(x: x, y: y, z: z)
      }

      AsyncFunction("getCursorPosition") { (view: ARRulerNativeView) -> [String: Float]? in
        return view.getCursorPosition()
      }

      AsyncFunction("getCursorPositionOnPlane") { (view: ARRulerNativeView, nx: Float, ny: Float, nz: Float, px: Float, py: Float, pz: Float) -> [String: Float]? in
        return view.getCursorPositionOnPlane(nx: nx, ny: ny, nz: nz, px: px, py: py, pz: pz)
      }

      AsyncFunction("clearCurrentShape") { (view: ARRulerNativeView) in
        view.clearCurrentShape()
      }

      AsyncFunction("setPreviewShape") { (view: ARRulerNativeView, type: String, points: [[String: Float]]) in
        view.setPreviewShape(type: type, points: points)
      }

      AsyncFunction("clearShapePreview") { (view: ARRulerNativeView) in
        view.clearShapePreview()
      }

      AsyncFunction("startFreehandStroke") { (view: ARRulerNativeView, thickness: Float, colorHex: String) in
        view.startFreehandStroke(thickness: thickness, colorHex: colorHex)
      }

      AsyncFunction("stopFreehandStroke") { (view: ARRulerNativeView, label: String) -> [String: Any]? in
        return view.stopFreehandStroke(label: label)
      }

      AsyncFunction("getCurrentShapes") { (view: ARRulerNativeView) -> [[String: Any]] in
        return view.getShapes()
      }
      
      AsyncFunction("reset") { (view: ARRulerNativeView) in
        view.reset()
      }

      AsyncFunction("setCeiling") { (view: ARRulerNativeView) in
        view.setCeiling()
      }

      AsyncFunction("saveOpenShape") { (view: ARRulerNativeView) -> [String: Any]? in
        return view.saveOpenShape()
      }

      // ═══ MEMORY MONITORING ═══
      AsyncFunction("getMemoryStats") { (view: ARRulerNativeView) -> [String: Any] in
        return view.getMemoryStats()
      }

      AsyncFunction("pauseMesh") { (view: ARRulerNativeView) in
        view.pauseMeshReconstruction(session: view.arView.session, reason: "user_request")
      }

      AsyncFunction("resumeMesh") { (view: ARRulerNativeView) in
        view.resumeMeshReconstruction(session: view.arView.session)
      }

      AsyncFunction("markAnchorsUploaded") { (view: ARRulerNativeView) in
        view.markAnchorsAsUploaded()
      }

      AsyncFunction("clearUploadedMeshNodes") { (view: ARRulerNativeView) -> Int in
        return view.clearUploadedMeshNodes()
      }

      AsyncFunction("exportMesh") { (view: ARRulerNativeView) -> [String: Any] in
        if #available(iOS 13.4, *) {
          return view.exportMesh()
        } else {
          return ["error": "iOS 13.4+ required for mesh export"]
        }
      }

      AsyncFunction("exportMeshChunks") { (view: ARRulerNativeView, maxSizeMB: Int) -> [[String: Any]] in
        if #available(iOS 13.4, *) {
          return view.exportMeshChunks(maxSizeMB: maxSizeMB)
        } else {
          return [["error": "iOS 13.4+ required for mesh export"]]
        }
      }

      AsyncFunction("exportCADData") { (view: ARRulerNativeView) -> [String: Any] in
        return view.exportCADData()
      }

      AsyncFunction("saveWorldMap") { (view: ARRulerNativeView, promise: Promise) in
        view.saveWorldMap(promise: promise)
      }

      AsyncFunction("loadWorldMap") { (view: ARRulerNativeView, url: String, promise: Promise) in
        view.loadWorldMap(url: url, promise: promise)
      }


      AsyncFunction("detectEdges") { (view: ARRulerNativeView, threshold: Float) -> [String: Any] in
        if #available(iOS 13.4, *) {
          return view.detectEdges(threshold: threshold)
        } else {
          return ["error": "iOS 13.4+ required"]
        }
      }

      AsyncFunction("confirmEdges") { (view: ARRulerNativeView) -> [[String: Any]] in
        return view.confirmEdges()
      }

      AsyncFunction("clearEdges") { (view: ARRulerNativeView) in
        view.clearEdges()
      }

      // Cut Room
      AsyncFunction("setCutActive") { (view: ARRulerNativeView, active: Bool, type: String) in
        view.setCutActive(active: active, type: type)
      }

      AsyncFunction("setCutHeight") { (view: ARRulerNativeView, height: Float) in
        view.setCutHeight(height: height)
      }

      AsyncFunction("setCutRotation") { (view: ARRulerNativeView, degrees: Float) in
        view.setCutRotation(degrees: degrees)
      }

      AsyncFunction("getCutResult") { (view: ARRulerNativeView) -> [String: Any] in
        return view.getCutResult()
      }

      AsyncFunction("clearCut") { (view: ARRulerNativeView) in
        view.clearCut()
      }

      AsyncFunction("loadShapes") { (view: ARRulerNativeView, shapes: [[String: Any]]) -> Int in
        return view.loadShapes(shapes: shapes)
      }

      AsyncFunction("loadBoundingBoxes") { (view: ARRulerNativeView, boxes: [[String: Any]]) -> Int in
        return view.loadBoundingBoxes(boxes: boxes)
      }

      AsyncFunction("loadRemoteObjects") { (view: ARRulerNativeView, objects: [[String: Any]]) -> Int in
        return view.loadRemoteObjects(objects: objects)
      }

      AsyncFunction("exportRoomPlanData") { (view: ARRulerNativeView) -> [String: Any] in
        return view.exportRoomPlanData()
      }

      AsyncFunction("exportRoomPlanElements") { (view: ARRulerNativeView) -> [[String: Any]] in
        return view.exportRoomPlanElements()
      }

      AsyncFunction("addSceneAnchor") { (view: ARRulerNativeView, name: String, type: String) -> [String: Any]? in
        return view.addSceneAnchor(name: name, type: type)
      }

      AsyncFunction("exportSceneAnchors") { (view: ARRulerNativeView) -> [[String: Any]] in
        return view.exportSceneAnchors()
      }

      AsyncFunction("loadSceneAnchors") { (view: ARRulerNativeView, anchors: [[String: Any]]) -> Int in
        return view.loadSceneAnchors(anchors: anchors)
      }

      AsyncFunction("finalizeRoomPlan") { (view: ARRulerNativeView) in
        view.finalizeRoomPlan()
      }

      AsyncFunction("startRoomScan") { (view: ARRulerNativeView) in
        view.startRoomScan()
      }

      AsyncFunction("stopRoomScan") { (view: ARRulerNativeView) in
        view.stopRoomScan()
      }

      AsyncFunction("pauseRoomScan") { (view: ARRulerNativeView) -> Bool in
        return view.pauseRoomScan()
      }

      AsyncFunction("resumeRoomScan") { (view: ARRulerNativeView) -> Bool in
        return view.resumeRoomScan()
      }

      AsyncFunction("getCameraTransform") { (view: ARRulerNativeView) -> [Float]? in
        return view.getCameraTransform()
      }

      AsyncFunction("enableAutoPhoto") { (view: ARRulerNativeView, enabled: Bool, spacing: Float) in
        view.enableAutoPhoto(enabled: enabled, spacing: spacing)
      }

      AsyncFunction("exportAutoPhotos") { (view: ARRulerNativeView) -> [[String: Any]] in
        return view.exportAutoPhotos()
      }

      AsyncFunction("getAutoPhotoCount") { (view: ARRulerNativeView) -> Int in
        return view.getAutoPhotoCount()
      }

      // --- Manual Anchor Placement & Matching ---
      AsyncFunction("placeManualAnchor") { (view: ARRulerNativeView, type: String) -> [String: Any]? in
        return view.placeManualAnchor(type: type)
      }

      AsyncFunction("getManualAnchorCount") { (view: ARRulerNativeView) -> Int in
        return view.getManualAnchorCount()
      }

      AsyncFunction("getManualAnchors") { (view: ARRulerNativeView) -> [[String: Any]] in
        return view.getManualAnchors()
      }

      AsyncFunction("startAnchorMatching") { (view: ARRulerNativeView, previousAnchors: [[String: Any]]) in
        view.startAnchorMatching(previousAnchors: previousAnchors)
      }

      AsyncFunction("matchAnchor") { (view: ARRulerNativeView, index: Int) -> Bool in
        return view.matchAnchor(index: index)
      }

      AsyncFunction("getMatchedCount") { (view: ARRulerNativeView) -> Int in
        return view.getMatchedCount()
      }

      AsyncFunction("computeKabschTransform") { (view: ARRulerNativeView) -> [Float]? in
        return view.computeKabschTransform()
      }

      AsyncFunction("clearMatchingState") { (view: ARRulerNativeView) in
        view.clearMatchingState()
      }

      // --- Tape Visualization ---
      AsyncFunction("extrudeWall") { (view: ARRulerNativeView, points: [[String: Float]], height: Float, label: String) in
        view.extrudeWall(points: points, height: height, label: label)
      }

      AsyncFunction("showAreaSurface") { (view: ARRulerNativeView, points: [[String: Float]], label: String) in
        view.showAreaSurface(points: points, label: label)
      }

      AsyncFunction("clearTapeVisualizations") { (view: ARRulerNativeView) in
        view.clearTapeVisualizations()
      }

      AsyncFunction("setPhotoQuality") { (view: ARRulerNativeView, quality: String) in
        view.photoQuality = quality
        print("[Photo] Quality set to: \(quality)")
      }

      AsyncFunction("takePhoto") { (view: ARRulerNativeView, promise: Promise) in
        view.takePhoto(promise: promise)
      }

      // --- Sketch 3D CSG ---

      AsyncFunction("addPrimitive") { (view: ARRulerNativeView, type: String, size: Float, label: String) -> [String: Any]? in
        return view.addPrimitive(type: type, size: size, label: label)
      }

      AsyncFunction("addPrimitiveAt") { (view: ARRulerNativeView, type: String, position: [String: Float], dimensions: [String: Float], label: String) -> [String: Any]? in
        return view.addPrimitiveAt(type: type, position: position, dimensions: dimensions, label: label)
      }

      AsyncFunction("extrudeSketchShape") { (view: ARRulerNativeView, points: [[String: Float]], height: Float, label: String) -> [String: Any]? in
        return view.extrudeSketchShape(points: points, height: height, label: label)
      }

      AsyncFunction("selectSketchShapeAtCenter") { (view: ARRulerNativeView) -> [String: Any]? in
        return view.selectSketchShapeAtCenter()
      }

      AsyncFunction("selectSketchShapeById") { (view: ARRulerNativeView, id: String) in
        view.selectSketchShapeById(id: id)
      }

      AsyncFunction("toggleSketchShapeSelection") { (view: ARRulerNativeView, id: String) in
        view.toggleSketchShapeSelection(id: id)
      }

      AsyncFunction("deselectAllSketchShapes") { (view: ARRulerNativeView) in
        view.deselectAllSketchShapes()
      }

      AsyncFunction("getSelectedSketchShapeIds") { (view: ARRulerNativeView) -> [String] in
        return view.getSelectedSketchShapeIds()
      }

      AsyncFunction("getSketchShapes") { (view: ARRulerNativeView) -> [[String: Any]] in
        return view.getSketchShapes()
      }

      AsyncFunction("moveSketchShape") { (view: ARRulerNativeView, id: String, dx: Float, dy: Float, dz: Float) in
        view.moveSketchShape(id: id, dx: dx, dy: dy, dz: dz)
      }

      AsyncFunction("rotateSketchShape") { (view: ARRulerNativeView, id: String, rx: Float, ry: Float, rz: Float) in
        view.rotateSketchShape(id: id, rx: rx, ry: ry, rz: rz)
      }

      AsyncFunction("scaleSketchShape") { (view: ARRulerNativeView, id: String, sx: Float, sy: Float, sz: Float) in
        view.scaleSketchShape(id: id, sx: sx, sy: sy, sz: sz)
      }

      AsyncFunction("booleanSubtract") { (view: ARRulerNativeView, keepId: String, cutId: String) -> [String: Any]? in
        return view.booleanSubtract(keepId: keepId, cutId: cutId)
      }

      AsyncFunction("booleanUnion") { (view: ARRulerNativeView, idA: String, idB: String) -> [String: Any]? in
        return view.booleanUnion(idA: idA, idB: idB)
      }

      AsyncFunction("booleanIntersect") { (view: ARRulerNativeView, idA: String, idB: String) -> [String: Any]? in
        return view.booleanIntersect(idA: idA, idB: idB)
      }

      AsyncFunction("pushPullFace") { (view: ARRulerNativeView, shapeId: String, facePoints: [[String: Float]], depth: Float) -> [String: Any]? in
        return view.pushPullFace(shapeId: shapeId, facePoints: facePoints, depth: depth)
      }

      AsyncFunction("deleteSketchShape") { (view: ARRulerNativeView, id: String) -> Bool in
        return view.deleteSketchShape(id: id)
      }

      AsyncFunction("deleteSelectedSketchShapes") { (view: ARRulerNativeView) -> Int in
        return view.deleteSelectedSketchShapes()
      }

      // --- Cut / Subdivision Tool ---

      AsyncFunction("hitTestMeshElement") { (view: ARRulerNativeView) -> [String: Any]? in
        return view.hitTestMeshElement()
      }

      AsyncFunction("showSnapHighlight") { (view: ARRulerNativeView, x: Float, y: Float, z: Float, snapType: String) in
        view.showSnapHighlight(x: x, y: y, z: z, snapType: snapType)
      }

      AsyncFunction("clearSnapHighlight") { (view: ARRulerNativeView) in
        view.clearSnapHighlight()
      }

      AsyncFunction("applyCutLine") { (view: ARRulerNativeView, shapeId: String, pointA: [String: Any], pointB: [String: Any]) -> Bool in
        return view.applyCutLine(shapeId: shapeId, pointA: pointA, pointB: pointB)
      }
    }
  }
}
