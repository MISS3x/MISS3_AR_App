#if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)

import UIKit
import SwiftUI
import RealityKit
import os

@available(iOS 17.0, *)
struct ObjectCaptureViewWrapper: View {
    var session: ObjectCaptureSession
    var onStateChange: (ObjectCaptureSession.CaptureState) -> Void
    
    var body: some View {
        ObjectCaptureView(session: session)
            .onChange(of: session.state) { _, newState in
                onStateChange(newState)
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
        
        // 1. Create a directory to store the captured images
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("ObjectCapture_\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true, attributes: nil)
            self.imageDir = tempDir
        } catch {
            print("Failed to create image directory: \(error)")
            onCompletion?(nil)
            dismiss(animated: true)
            return
        }
        
        // 2. Initialize the ObjectCaptureSession
        var configuration = ObjectCaptureSession.Configuration()
        configuration.checkpointDirectory = tempDir.appendingPathComponent("Snapshots/")
        
        session = ObjectCaptureSession()
        
        // 3. Create the SwiftUI ObjectCaptureView wrapper
        let contentView = ObjectCaptureViewWrapper(session: session!) { [weak self] newState in
            switch newState {
            case .completed:
                DispatchQueue.main.async {
                    self?.dismiss(animated: true) { self?.onCompletion?(self?.imageDir?.path) }
                }
            case .failed(let error):
                print("Session failed: \(error)")
                DispatchQueue.main.async {
                    self?.dismiss(animated: true) { self?.onCompletion?(nil) }
                }
            default: break
            }
        }
        let hostingController = UIHostingController(rootView: contentView)
        
        addChild(hostingController)
        view.addSubview(hostingController.view)
        hostingController.view.frame = view.bounds
        hostingController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hostingController.didMove(toParent: self)
        
        // 4. Add a custom Close/Cancel button
        let closeButton = UIButton(type: .system)
        closeButton.setTitle("Cancel", for: .normal)
        closeButton.setTitleColor(.white, for: .normal)
        closeButton.backgroundColor = UIColor(white: 0.2, alpha: 0.8)
        closeButton.layer.cornerRadius = 8
        closeButton.frame = CGRect(x: 20, y: 50, width: 80, height: 40)
        closeButton.addTarget(self, action: #selector(cancelCapture), for: .touchUpInside)
        view.addSubview(closeButton)
        
        // 5. Start the session
        session?.start(imagesDirectory: tempDir, configuration: configuration)
    }
    
    @objc func cancelCapture() {
        session?.cancel()
        dismiss(animated: true) {
            self.onCompletion?(nil)
        }
    }
}

#endif
