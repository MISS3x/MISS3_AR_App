#if os(iOS) && !targetEnvironment(simulator) && !targetEnvironment(macCatalyst)

import UIKit
import SwiftUI
import RealityKit
import AVFoundation

// ==========================================================================
// MARK: - ObjectCaptureViewWrapper
// EXACT Apple SuperSimpleObjectCapture pattern:
//   1. session is NON-OPTIONAL, created immediately
//   2. ObjectCaptureView is shown UNCONDITIONALLY (not behind if-let)
//   3. session.start() is called in .task {}
//   4. ObjectCaptureView handles ALL state transitions internally
//   5. We NEVER call startDetecting() or startCapturing()
// ==========================================================================

@available(iOS 17.0, *)
struct ObjectCaptureViewWrapper: View {
    // NON-OPTIONAL — created immediately, exactly like Apple's sample
    @State var session = ObjectCaptureSession()
    @State private var overlayText: String = "⏳ Starting..."
    @State private var canFinish: Bool = false
    
    var onCancel: (() -> Void)?
    var onComplete: ((String?) -> Void)?
    
    // Directories
    private let imagesDir: URL
    private let snapshotsDir: URL
    
    init(onCancel: (() -> Void)? = nil, onComplete: ((String?) -> Void)? = nil) {
        self.onCancel = onCancel
        self.onComplete = onComplete
        
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("ObjectCapture_\(UUID().uuidString)")
        self.imagesDir = base.appendingPathComponent("Images")
        self.snapshotsDir = base.appendingPathComponent("Snapshots")
        try? FileManager.default.createDirectory(at: imagesDir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: snapshotsDir, withIntermediateDirectories: true)
    }
    
    var body: some View {
        ZStack {
            // ============================================================
            // ObjectCaptureView is ALWAYS shown — it needs to be present
            // BEFORE session.start() so it can set up the camera pipeline.
            // It provides ALL interactive UI: bounding box, continue btn,
            // orbit guidance, capture feedback.
            // ============================================================
            ObjectCaptureView(session: session)
                .edgesIgnoringSafeArea(.all)
            
            // === Status + buttons at TOP — keep bottom clear for Apple's UI ===
            VStack {
                HStack {
                    // Cancel — top-left
                    Button(action: {
                        session.cancel()
                        onCancel?()
                    }) {
                        Text("Cancel")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                            .background(Color.black.opacity(0.5))
                            .cornerRadius(20)
                    }
                    
                    // Manual Start button to bypass auto-detect if stuck
                    if session.state == .ready {
                        Button(action: {
                            print("[ObjectCapture] Manually calling startDetecting()")
                            session.startDetecting()
                        }) {
                            Text("START")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(.black)
                                .padding(.horizontal, 18)
                                .padding(.vertical, 10)
                                .background(Color.white)
                                .cornerRadius(20)
                        }
                    }
                    
                    Spacer()
                    
                    // Status text — top-center area
                    Text(overlayText)
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.6))
                        .cornerRadius(8)
                        .allowsHitTesting(false)
                    
                    Spacer()
                    
                    // FINISH — top-right (only when scan pass complete)
                    if canFinish {
                        Button(action: {
                            session.finish()
                            overlayText = "⏳ Finishing..."
                            canFinish = false
                        }) {
                            HStack(spacing: 4) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 16))
                                Text("FINISH")
                                    .font(.system(size: 14, weight: .bold))
                            }
                            .foregroundColor(.black)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                            .background(Color(red: 0, green: 1, blue: 0.85))
                            .cornerRadius(20)
                        }
                        .transition(.scale.combined(with: .opacity))
                    }
                }
                .animation(.easeInOut(duration: 0.3), value: canFinish)
                .animation(.easeInOut(duration: 0.3), value: session.state)
                .padding(.top, 60)
                .padding(.horizontal, 16)
                
                Spacer() // Push everything to top — bottom is 100% Apple's UI
            }
        }
        .task {
            // ============================================================
            // Apple pattern: start session in .task — view is already
            // mounted at this point so ObjectCaptureView can set up camera
            // ============================================================
            print("[ObjectCapture] Starting session...")
            print("[ObjectCapture] Images dir: \(imagesDir.path)")
            
            var configuration = ObjectCaptureSession.Configuration()
            configuration.checkpointDirectory = snapshotsDir
            configuration.isOverCaptureEnabled = true
            
            session.start(imagesDirectory: imagesDir, configuration: configuration)
            print("[ObjectCapture] session.start() called")
        }
        .onChange(of: session.state) { _, newValue in
            print("[ObjectCapture] State → \(newValue)")
            switch newValue {
            case .initializing:
                overlayText = "⏳ Initializing..."
            case .ready:
                overlayText = "📦 Point at object"
            case .detecting:
                overlayText = "🔍 Adjust box, tap Continue"
            case .capturing:
                overlayText = "📸 Move around object"
            case .finishing:
                overlayText = "⏳ Finishing..."
                canFinish = false
            case .completed:
                overlayText = "🎉 Done!"
                canFinish = false
                let parentDir = imagesDir.deletingLastPathComponent()
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    onComplete?(parentDir.path)
                }
            case .failed(let error):
                overlayText = "❌ \(error.localizedDescription)"
                canFinish = false
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    onComplete?(nil)
                }
            @unknown default:
                overlayText = "❓ Unknown"
            }
        }
        .onChange(of: session.userCompletedScanPass) { _, newValue in
            if newValue == true {
                canFinish = true
                overlayText = "✅ Orbit done — FINISH or keep going"
                print("[ObjectCapture] userCompletedScanPass = true")
            }
        }
    }
}

// ==========================================================================
// MARK: - UIKit ViewController (bridge from React Native / Expo Module)
// ==========================================================================

@available(iOS 17.0, *)
class ScannerViewController: UIViewController {
    
    var onCompletion: ((String?) -> Void)?
    private var hostingController: UIViewController?
    
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        
        print("[ObjectCapture] ScannerViewController loading...")
        
        Task { @MainActor in
            let status = AVCaptureDevice.authorizationStatus(for: .video)
            if status == .notDetermined {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                if !granted {
                    showError("Camera access is required.")
                    return
                }
            } else if status != .authorized {
                showError("Camera access denied. Check Settings.")
                return
            }
            
            guard ObjectCaptureSession.isSupported else {
                showError("Device does not support Object Capture.")
                return
            }
            
            presentCaptureView()
        }
    }
    
    private func showError(_ message: String) {
        let alert = UIAlertController(title: "Object Capture", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            self.dismiss(animated: true) { self.onCompletion?(nil) }
        })
        present(alert, animated: true)
    }
    
    private func presentCaptureView() {
        print("[ObjectCapture] Presenting capture view")
        
        let captureView = ObjectCaptureViewWrapper(
            onCancel: { [weak self] in
                self?.dismiss(animated: true) { self?.onCompletion?(nil) }
            },
            onComplete: { [weak self] path in
                self?.dismiss(animated: true) { self?.onCompletion?(path) }
            }
        )
        
        let hc = UIHostingController(rootView: captureView)
        self.hostingController = hc
        
        addChild(hc)
        self.view.addSubview(hc.view)
        hc.view.frame = self.view.bounds
        hc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hc.didMove(toParent: self)
    }
    
    deinit {
        print("[ObjectCapture] ScannerViewController deallocated")
    }
}

#endif
