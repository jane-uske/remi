import SwiftUI
import MetalKit

@MainActor
struct RemiLive2DView: UIViewRepresentable {

    let renderer: RemiLive2DRenderer

    func makeUIView(context: Context) -> MTKView {
        guard let device = MTLCreateSystemDefaultDevice() else {
            fatalError("Metal is not supported on this device")
        }
        let mtkView = MTKView(frame: .zero, device: device)
        mtkView.delegate = renderer
        mtkView.colorPixelFormat = .bgra8Unorm
        mtkView.clearColor = MTLClearColorMake(0, 0, 0, 0)
        mtkView.isOpaque = false
        mtkView.backgroundColor = .clear
        mtkView.layer.isOpaque = false
        mtkView.preferredFramesPerSecond = 30
        mtkView.enableSetNeedsDisplay = false
        mtkView.isPaused = false
        renderer.setup(device: device, view: mtkView)
        return mtkView
    }

    func updateUIView(_ uiView: MTKView, context: Context) {}

    static func dismantleUIView(_ uiView: MTKView, coordinator: ()) {
        uiView.isPaused = true
        uiView.delegate = nil
    }
}
