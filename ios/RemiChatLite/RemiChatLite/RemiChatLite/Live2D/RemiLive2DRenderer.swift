import MetalKit
import Foundation

@MainActor
final class RemiLive2DRenderer: NSObject, MTKViewDelegate, ObservableObject {

    private var device: MTLDevice?
    private var commandQueue: MTLCommandQueue?
    private var modelLoaded = false
    private var startTimeMs: Int64 = 0

    @Published var isReady = false
    @Published var loadError: String?

    let parameterDriver = RemiLive2DParameterDriver()

    var emotion: String = "neutral"
    var phase: RemiAvatarPhase = .idle
    var lipWeight: Float = 0

    func setup(device: MTLDevice, view: MTKView) {
        self.device = device
        self.commandQueue = device.makeCommandQueue()
        self.startTimeMs = currentMs()
        loadModel()
    }

    nonisolated func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    nonisolated func draw(in view: MTKView) {
        Task { @MainActor in
            drawFrame(in: view)
        }
    }

    // MARK: - Internal

    private func drawFrame(in view: MTKView) {
        guard let commandQueue,
              let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let commandBuffer = commandQueue.makeCommandBuffer()
        else { return }

        let nowMs = currentMs() - startTimeMs

        // Compute motion parameters
        let frame = parameterDriver.sample(
            nowMs: nowMs,
            emotion: emotion,
            phase: phase,
            lipWeight: lipWeight
        )
        let breath = parameterDriver.sampleBreath(nowMs: nowMs)

        // TODO: Phase 1 completion — apply frame parameters to Cubism model
        // cubismModel.setParameterValue("ParamMouthOpenY", frame.mouthOpen)
        // cubismModel.setParameterValue("ParamMouthForm", frame.mouthForm)
        // cubismModel.setParameterValue("ParamEyeLOpen", frame.eyeOpen)
        // cubismModel.setParameterValue("ParamEyeROpen", frame.eyeOpen)
        // cubismModel.setParameterValue("ParamAngleX", frame.angleX)
        // cubismModel.setParameterValue("ParamAngleY", frame.angleY)
        // cubismModel.setParameterValue("ParamBodyAngleX", frame.bodyAngleX)
        // cubismModel.setParameterValue("ParamBreath", breath)
        // cubismModel.update()
        // cubismRenderer.draw(descriptor)

        // Placeholder: clear with transparent
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.colorAttachments[0].storeAction = .store

        if let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: descriptor) {
            encoder.endEncoding()
        }

        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    private func loadModel() {
        guard let modelPath = Bundle.main.path(
            forResource: "hiyori_pro_t11.model3",
            ofType: "json",
            inDirectory: "Resources/live2d/hiyori-pro"
        ) else {
            loadError = "Live2D model not found in bundle"
            return
        }

        // TODO: Phase 1 completion — load .moc3 via CubismCore C++ bridge
        // 1. Parse model3.json to get moc3 path, texture paths, physics path
        // 2. Load moc3 binary via CubismMoc::create()
        // 3. Load textures into MTLTexture
        // 4. Initialize CubismPhysics from physics3.json
        // 5. Set up CubismMotionManager with idle motions
        // 6. Create CubismRenderer_Metal

        print("[Live2D] Model path found: \(modelPath)")
        modelLoaded = true
        isReady = true
    }

    private func currentMs() -> Int64 {
        Int64(Date.timeIntervalSinceReferenceDate * 1000)
    }
}
