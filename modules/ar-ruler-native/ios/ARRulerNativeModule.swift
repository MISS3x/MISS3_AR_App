import ExpoModulesCore

public class ARRulerNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ARRulerNative")

    View(ARRulerNativeView.self) {
      Events("onUpdate", "onPlaneStateChange")
      
      Prop("measuringState") { (view: ARRulerNativeView, state: String) in
        // e.g., "finding_floor", "finding_ceiling", "polygon"
      }

      Prop("isWallMode") { (view: ARRulerNativeView, isWall: Bool) in
        view.isWallMode = isWall
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
    }
  }
}
