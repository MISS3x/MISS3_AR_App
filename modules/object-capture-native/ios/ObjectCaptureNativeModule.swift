import ExpoModulesCore
import RealityKit
import UIKit
import SwiftUI

public class ObjectCaptureNativeModule: Module {
  var photogrammetrySession: Any?
  var processingTask: Task<Void, Never>?
  var activeScannerVC: UIViewController?  // Strong ref to prevent premature dealloc
    
  public func definition() -> ModuleDefinition {
    Name("ObjectCaptureNative")
    Events("onProcessingProgress", "onProcessingState")

    // ── Start Scanning ──────────────────────────────────────────
    AsyncFunction("startScanning") { (promise: Promise) in
        DispatchQueue.main.async {
            #if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)
            guard #available(iOS 17.0, *) else {
                promise.reject("UNSUPPORTED", "Object Capture requires iOS 17.0 or newer.")
                return
            }
            guard ObjectCaptureSession.isSupported else {
                promise.reject("UNSUPPORTED", "This device does not support Object Capture (LiDAR + A15 required).")
                return
            }

            guard let currentVC = UIApplication.shared.windows.first?.rootViewController else {
                promise.reject("NO_VIEW_CONTROLLER", "Could not find root view controller.")
                return
            }

            let scannerVC = ScannerViewController()
            scannerVC.modalPresentationStyle = .fullScreen
            self.activeScannerVC = scannerVC  // Retain strongly
            scannerVC.onCompletion = { [weak self] imageDirPath in
                self?.activeScannerVC = nil  // Release after completion
                if let path = imageDirPath {
                    // Count images in directory to verify capture quality
                    let imageDir = URL(fileURLWithPath: path)
                    let imageCount = (try? FileManager.default.contentsOfDirectory(at: imageDir, includingPropertiesForKeys: nil)
                        .filter { ["jpg", "jpeg", "heic", "png"].contains($0.pathExtension.lowercased()) }
                        .count) ?? 0
                    
                    print("[ObjectCapture] Scan completed with \(imageCount) images at: \(path)")
                    promise.resolve([
                        "imageDirectory": path,
                        "imageCount": imageCount
                    ])
                } else {
                    promise.reject("CANCELLED", "Scanning was cancelled.")
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

    // ── Process Model (Photogrammetry) ──────────────────────────
    AsyncFunction("processModel") { (imageDirPath: String, promise: Promise) in
        guard #available(iOS 17.0, *) else {
            promise.reject("UNSUPPORTED", "Processing requires iOS 17.0 or newer.")
            return
        }
        
        let imageDir = URL(fileURLWithPath: imageDirPath)
        
        // Verify images exist
        let images = (try? FileManager.default.contentsOfDirectory(at: imageDir, includingPropertiesForKeys: nil)
            .filter { ["jpg", "jpeg", "heic", "png"].contains($0.pathExtension.lowercased()) }) ?? []
        
        guard images.count >= 3 else {
            promise.reject("TOO_FEW_IMAGES", "Need at least 3 images, found \(images.count). Try scanning for longer.")
            return
        }
        
        print("[ObjectCapture] Processing \(images.count) images from: \(imageDirPath)")
        self.sendEvent("onProcessingState", ["state": "starting", "imageCount": images.count])
        
        let outputDir = FileManager.default.temporaryDirectory.appendingPathComponent("Models")
        try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true, attributes: nil)
        let outputUrl = outputDir.appendingPathComponent("model_\(UUID().uuidString).usdz")
        
        do {
            var config = PhotogrammetrySession.Configuration()
            config.isObjectMaskingEnabled = true
            
            let pSession = try PhotogrammetrySession(input: imageDir, configuration: config)
            self.photogrammetrySession = pSession
            
            // Start output stream monitoring
            self.processingTask = Task {
                do {
                    for try await output in pSession.outputs {
                        switch output {
                        case .processingComplete:
                            print("[ObjectCapture] Processing complete! Output: \(outputUrl.path)")
                            
                            // Get file size
                            let attrs = try? FileManager.default.attributesOfItem(atPath: outputUrl.path)
                            let fileSize = (attrs?[.size] as? Int64) ?? 0
                            
                            self.sendEvent("onProcessingState", ["state": "completed"])
                            promise.resolve([
                                "modelPath": outputUrl.path,
                                "fileSize": fileSize,
                                "format": "usdz"
                            ])
                        case .requestProgress(_, let fractionComplete):
                            self.sendEvent("onProcessingProgress", ["progress": fractionComplete])
                        case .requestError(_, let error):
                            print("[ObjectCapture] Processing error: \(error)")
                            self.sendEvent("onProcessingState", ["state": "error", "message": error.localizedDescription])
                            promise.reject("PROCESSING_ERROR", error.localizedDescription)
                        case .inputComplete:
                            print("[ObjectCapture] Input complete, processing...")
                            self.sendEvent("onProcessingState", ["state": "processing"])
                        default:
                            break
                        }
                    }
                } catch {
                    self.sendEvent("onProcessingState", ["state": "error", "message": error.localizedDescription])
                    promise.reject("STREAM_ERROR", "Output stream error: \(error.localizedDescription)")
                }
            }
            
            // Request model generation
            let request = PhotogrammetrySession.Request.modelFile(url: outputUrl)
            try pSession.process(requests: [request])
            
        } catch {
            self.sendEvent("onProcessingState", ["state": "error", "message": error.localizedDescription])
            promise.reject("START_ERROR", "Failed to start processing: \(error.localizedDescription)")
        }
    }
    
    // ── Cancel Processing ───────────────────────────────────────
    AsyncFunction("cancelProcessing") { (promise: Promise) in
        if #available(iOS 17.0, *) {
            if let pSession = photogrammetrySession as? PhotogrammetrySession {
                pSession.cancel()
                processingTask?.cancel()
                self.sendEvent("onProcessingState", ["state": "cancelled"])
                promise.resolve(true)
                return
            }
        }
        promise.resolve(false)
    }
    
    // ── Check Support ───────────────────────────────────────────
    AsyncFunction("isSupported") { (promise: Promise) in
        DispatchQueue.main.async {
            #if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)
            if #available(iOS 17.0, *) {
                promise.resolve(ObjectCaptureSession.isSupported)
            } else {
                promise.resolve(false)
            }
            #else
            promise.resolve(false)
            #endif
        }
    }
  }
}
