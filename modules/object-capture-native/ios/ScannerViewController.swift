#if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)

import UIKit
import SwiftUI
import RealityKit
import os

@available(iOS 17.0, *)
struct ObjectCaptureViewWrapper: View {
    @ObservedObject var session: ObjectCaptureSession
    var onStateChange: (String) -> Void
    
    @State private var showOverlayText: String = "Initializing..."
    
    var body: some View {
        ZStack {
            ObjectCaptureView(session: session)
            
            // State overlay at the top
            VStack {
                Text(showOverlayText)
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.7))
                    .cornerRadius(8)
                    .padding(.top, 60)
                
                Spacer()
            }
        }
        .onChange(of: session.state) { _, newState in
            let stateStr = describeState(newState)
            showOverlayText = stateStr
            onStateChange(stateStr)
            print("[ObjectCapture] State: \(stateStr)")
        }
        .onAppear {
            print("[ObjectCapture] View appeared, session state: \(describeState(session.state))")
            showOverlayText = describeState(session.state)
        }
    }
    
    func describeState(_ state: ObjectCaptureSession.CaptureState) -> String {
        switch state {
        case .initializing:
            return "⏳ Initializing session..."
        case .ready:
            return "✅ Ready — Point camera at object"
        case .detecting:
            return "🔍 Detecting object — Move closer"
        case .capturing:
            return "📸 Capturing — Move around object slowly"
        case .finishing:
            return "⏳ Finishing capture..."
        case .completed:
            return "🎉 Capture complete!"
        case .failed(let error):
            return "❌ Failed: \(error.localizedDescription)"
        @unknown default:
            return "❓ Unknown state"
        }
    }
}

@available(iOS 17.0, *)
class ScannerViewController: UIViewController {
    
    var session: ObjectCaptureSession?
    var imageDir: URL?
    var onCompletion: ((String?) -> Void)?
    
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        
        print("[ObjectCapture] ScannerViewController loading...")
        
        // 1. Check device support
        guard ObjectCaptureSession.isSupported else {
            print("[ObjectCapture] ERROR: Device does not support ObjectCaptureSession")
            let alert = UIAlertController(title: "Not Supported", message: "This device does not support Object Capture. Requires LiDAR + A15 chip or newer.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                self.dismiss(animated: true) { self.onCompletion?(nil) }
            })
            present(alert, animated: true)
            return
        }
        
        print("[ObjectCapture] Device supported ✅")
        
        // 2. Create a directory to store the captured images
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("ObjectCapture_\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true, attributes: nil)
            self.imageDir = tempDir
            print("[ObjectCapture] Image dir: \(tempDir.path)")
        } catch {
            print("[ObjectCapture] Failed to create image directory: \(error)")
            onCompletion?(nil)
            dismiss(animated: true)
            return
        }
        
        // 3. Create checkpoint directory
        let checkpointDir = tempDir.appendingPathComponent("Snapshots")
        do {
            try FileManager.default.createDirectory(at: checkpointDir, withIntermediateDirectories: true, attributes: nil)
        } catch {
            print("[ObjectCapture] Failed to create checkpoint dir: \(error)")
        }
        
        // 4. Initialize the ObjectCaptureSession
        var configuration = ObjectCaptureSession.Configuration()
        configuration.checkpointDirectory = checkpointDir
        
        session = ObjectCaptureSession()
        
        guard let session = session else {
            print("[ObjectCapture] ERROR: Failed to create ObjectCaptureSession")
            onCompletion?(nil)
            dismiss(animated: true)
            return
        }
        
        print("[ObjectCapture] Session created, initial state: \(session.state)")
        
        // 5. Create the SwiftUI ObjectCaptureView wrapper
        let contentView = ObjectCaptureViewWrapper(session: session) { [weak self] stateStr in
            print("[ObjectCapture] State callback: \(stateStr)")
            
            if stateStr.contains("complete") {
                DispatchQueue.main.async {
                    self?.dismiss(animated: true) { self?.onCompletion?(self?.imageDir?.path) }
                }
            } else if stateStr.contains("Failed") {
                DispatchQueue.main.async {
                    self?.dismiss(animated: true) { self?.onCompletion?(nil) }
                }
            }
        }
        let hostingController = UIHostingController(rootView: contentView)
        
        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.view.frame = view.bounds
        hostingController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hostingController.didMove(toParent: self)
        
        // 6. Add a custom Close/Cancel button
        let closeButton = UIButton(type: .system)
        closeButton.setTitle("Cancel", for: .normal)
        closeButton.setTitleColor(.white, for: .normal)
        closeButton.backgroundColor = UIColor(white: 0.2, alpha: 0.8)
        closeButton.layer.cornerRadius = 8
        closeButton.frame = CGRect(x: 20, y: 50, width: 80, height: 40)
        closeButton.addTarget(self, action: #selector(cancelCapture), for: .touchUpInside)
        view.addSubview(closeButton)
        view.bringSubviewToFront(closeButton)
        
        // 7. Start the session
        print("[ObjectCapture] Starting session with imagesDirectory: \(tempDir.path)")
        session.start(imagesDirectory: tempDir, configuration: configuration)
        print("[ObjectCapture] Session started, state after start: \(session.state)")
    }
    
    @objc func cancelCapture() {
        print("[ObjectCapture] Cancel pressed")
        session?.cancel()
        dismiss(animated: true) {
            self.onCompletion?(nil)
        }
    }
}

#endif
