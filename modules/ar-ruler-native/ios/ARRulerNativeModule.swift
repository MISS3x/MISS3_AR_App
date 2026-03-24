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

      AsyncFunction("takePhoto") { (view: ARRulerNativeView, promise: Promise) in
        view.takePhoto(promise: promise)
      }
    }
  }
}
