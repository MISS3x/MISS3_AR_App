import ExpoModulesCore
import RealityKit
import UIKit
import SwiftUI

public class ObjectCaptureNativeModule: Module {
  var photogrammetrySession: Any? // Store as Any to avoid availability issues in class def
  var processingTask: Task<Void, Never>?
    
  public func definition() -> ModuleDefinition {
    Name("ObjectCaptureNative")
    Events("onProcessingProgress")

    AsyncFunction("startScanning") { (promise: Promise) in
        DispatchQueue.main.async {
            #if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)
            guard #available(iOS 17.0, *) else {
                promise.reject("UNSUPPORTED", "Object Capture requires iOS 17.0 or newer.")
                return
            }
            guard ObjectCaptureSession.isSupported else {
                promise.reject("UNSUPPORTED", "This device does not support Object Capture (LiDAR required).")
                return
            }

            guard let currentVC = UIApplication.shared.windows.first?.rootViewController else {
                promise.reject("NO_VIEW_CONTROLLER", "Could not find root view controller.")
                return
            }

            let scannerVC = ScannerViewController()
            scannerVC.modalPresentationStyle = .fullScreen
            scannerVC.onCompletion = { imageDirPath in
                if let path = imageDirPath {
                    promise.resolve(["imageDirectory": path])
                } else {
                    promise.reject("CANCELLED", "Scanning was cancelled or failed.")
                }
            }
            
            var topController = currentVC
            while let presented = topController.presentedViewController {
                topController = presented
            }
            topController.present(scannerVC, animated: true, completion: nil)
            #else
            promise.reject("SIMULATOR_UNSUPPORTED", "Object Capture requires a real iOS device.")
            #endif
        }
    }

    AsyncFunction("processModel") { (imageDirPath: String, promise: Promise) in
        guard #available(iOS 17.0, *) else {
            promise.reject("UNSUPPORTED", "Processing requires iOS 17.0 or newer.")
            return
        }
        
        let imageDir = URL(fileURLWithPath: imageDirPath)
        let outputDir = FileManager.default.temporaryDirectory.appendingPathComponent("Models")
        try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true, attributes: nil)
        let outputUrl = outputDir.appendingPathComponent("model_\(UUID().uuidString).usdz")
        
        do {
            // Use lowest detail to avoid massive 100MB OBJs
            var req = PhotogrammetrySession.Request.modelFile(url: outputUrl, detail: .reduced)
            var config = PhotogrammetrySession.Configuration()
            config.isObjectMaskingEnabled = true // Auto-mask the object
            
            let pSession = try PhotogrammetrySession(input: imageDir, configuration: config)
            self.photogrammetrySession = pSession
            
            self.processingTask = Task {
                for try await output in pSession.outputs {
                    switch output {
                    case .processingComplete:
                        promise.resolve(["objPath": outputUrl.path])
                    case .requestProgress(_, let fractionComplete):
                        self.sendEvent("onProcessingProgress", ["progress": fractionComplete])
                    case .requestError(_, let error):
                        promise.reject("PROCESSING_ERROR", error.localizedDescription)
                    default:
                        break
                    }
                }
            }
            
            try pSession.process(requests: [req])
            
        } catch {
            promise.reject("START_ERROR", "Failed to start processing: \(error.localizedDescription)")
        }
    }
    
    AsyncFunction("cancelProcessing") { (promise: Promise) in
        if #available(iOS 17.0, *) {
            if let pSession = photogrammetrySession as? PhotogrammetrySession {
                pSession.cancel()
                processingTask?.cancel()
                promise.resolve(true)
                return
            }
        }
        promise.resolve(false)
    }
  }
}
