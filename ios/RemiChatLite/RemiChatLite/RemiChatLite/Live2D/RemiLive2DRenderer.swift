import Combine
import Foundation
import UIKit
import WebKit

@MainActor
final class RemiLive2DRenderer: NSObject, ObservableObject {

    @Published var isReady = false
    @Published var loadError: String?

    private weak var webView: WKWebView?
    private var displayLink: CADisplayLink?
    private var startTimeMs: Int64 = 0
    /// False while the app is backgrounded/inactive — pauses both the param push
    /// loop and the WebView's PIXI ticker so the GPU goes idle.
    private var isSceneActive = true
    private var thermalObserver: NSObjectProtocol?

    let parameterDriver = RemiLive2DParameterDriver()

    /// Borrowed from the chat store; supplies viseme-driven mouth values per frame.
    /// When set, it overrides the static `lipWeight` placeholder.
    weak var lipSyncEngine: RemiLipSyncEngine?

    var emotion: String = "neutral"
    var phase: RemiAvatarPhase = .idle
    var lipWeight: Float = 0

    deinit {
        displayLink?.invalidate()
        if let thermalObserver {
            NotificationCenter.default.removeObserver(thermalObserver)
        }
    }

    func attach(webView: WKWebView) {
        self.webView = webView
        startTimeMs = currentMs()
        isReady = false
        loadError = nil
        startDisplayLinkIfNeeded()
        observeThermalStateIfNeeded()
    }

    func markReady() {
        isReady = true
        loadError = nil
        // JS hooks now exist — push the current target fps so an idle avatar
        // immediately drops below the 30fps boot default.
        applyFrameRate()
    }

    func markError(_ message: String) {
        isReady = false
        loadError = message
        print("[Live2D] Web runtime error: \(message)")
    }

    func update(emotion: String, phase: RemiAvatarPhase, lipWeight: Float) {
        let phaseChanged = phase != self.phase
        self.emotion = emotion
        self.phase = phase
        self.lipWeight = lipWeight
        if phaseChanged {
            applyFrameRate()
        }
        sendCurrentFrame()
    }

    /// Drives scene-active state from the view's `scenePhase`. When inactive we
    /// pause the display link and the WebView ticker so nothing renders off-screen.
    func setSceneActive(_ active: Bool) {
        guard active != isSceneActive else { return }
        isSceneActive = active
        displayLink?.isPaused = !active
        evalJS("window.remiLive2DSetPaused && window.remiLive2DSetPaused(\(active ? "false" : "true"));")
        if active {
            applyFrameRate()
            sendCurrentFrame()
        }
    }

    func html() -> String {
        """
        <!doctype html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
          <style>
            html, body {
              margin: 0;
              padding: 0;
              width: 100%;
              height: 100%;
              overflow: hidden;
              background: transparent;
              -webkit-user-select: none;
              user-select: none;
            }
            canvas {
              display: block;
              width: 100% !important;
              height: 100% !important;
              background: transparent;
            }
          </style>
          <script>
            window.process = window.process || { env: { NODE_ENV: "production" } };
            window.process.env = window.process.env || { NODE_ENV: "production" };
            window.process.env.NODE_ENV = window.process.env.NODE_ENV || "production";
            window.global = window.global || window;
          </script>
          <script src="remi-live2d://bundle/live2dcubismcore.min.js"></script>
          <script src="remi-live2d://bundle/pixi.min.js"></script>
          <script src="remi-live2d://bundle/cubism4.min.js"></script>
        </head>
        <body>
          <script>
            (function () {
              const modelUrl = "remi-live2d://bundle/remi_ios_hiyori.model3.json";
              let app = null;
              let model = null;
              let currentFrame = {
                mouthOpen: 0,
                mouthForm: 0,
                eyeOpen: 1,
                angleX: 0,
                angleY: -1.5,
                bodyAngleX: 0,
                breath: 0.5,
                focusX: 0,
                focusY: 0
              };

              function post(type, payload) {
                try {
                  window.webkit.messageHandlers.remiLive2D.postMessage(
                    Object.assign({ type: type }, payload || {})
                  );
                } catch (_) {}
              }

              function ensureRuntime() {
                if (!window.PIXI) throw new Error("PIXI runtime is missing");
                if (!window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) {
                  const pixiKeys = window.PIXI ? Object.keys(window.PIXI).slice(0, 20).join(",") : "none";
                  const live2dKeys = window.PIXI && window.PIXI.live2d
                    ? Object.keys(window.PIXI.live2d).slice(0, 20).join(",")
                    : "none";
                  throw new Error("pixi-live2d-display Cubism4 runtime is missing; PIXI keys=" + pixiKeys + "; live2d keys=" + live2dKeys);
                }
                if (window.Live2DCubismCore &&
                    (!window.Live2DCubismCore.Memory ||
                     !window.Live2DCubismCore.Memory.initializeAmountOfMemory)) {
                  window.Live2DCubismCore.Memory = {
                    initializeAmountOfMemory: function () {}
                  };
                }
              }

              function coreModel() {
                return model &&
                  model.internalModel &&
                  model.internalModel.coreModel;
              }

              function setParam(id, value, weight) {
                const core = coreModel();
                if (!core || !core.setParameterValueById) return;
                core.setParameterValueById(id, value, weight == null ? 1 : weight);
              }

              function fitModel() {
                if (!app || !model) return;
                const width = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0, 1);
                const height = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0, 1);
                app.renderer.resize(width, height);

                const bounds = typeof model.getLocalBounds === "function"
                  ? model.getLocalBounds()
                  : { width: model.width || 1, height: model.height || 1 };
                const scale = Math.min(
                  width / Math.max(bounds.width || 1, 1),
                  height / Math.max(bounds.height || 1, 1)
                ) * 0.88;
                model.scale.set(scale, scale);
                model.x = width * 0.5;
                model.y = height * 0.98;
              }

              function applyFrame() {
                if (!model) return;
                const f = currentFrame;
                setParam("ParamMouthOpenY", f.mouthOpen, 1);
                setParam("ParamMouthForm", f.mouthForm, 0.8);
                setParam("ParamEyeLOpen", f.eyeOpen, 1);
                setParam("ParamEyeROpen", f.eyeOpen, 1);
                setParam("ParamAngleX", f.angleX, 0.65);
                setParam("ParamAngleY", f.angleY, 0.65);
                setParam("ParamBodyAngleX", f.bodyAngleX, 0.55);
                setParam("ParamBreath", f.breath, 0.5);
                if (typeof model.focus === "function") {
                  model.focus(f.focusX || 0, f.focusY || 0, false);
                }
              }

              window.remiLive2DSetFrame = function (frame) {
                currentFrame = Object.assign(currentFrame, frame || {});
                applyFrame();
              };

              // Throttle the actual render loop to match the native push rate so the
              // GPU isn't pinned at 60fps while the avatar is idle.
              window.remiLive2DSetMaxFps = function (fps) {
                if (app && app.ticker && fps > 0) app.ticker.maxFPS = fps;
              };

              // Fully stop/start rendering when the app is backgrounded.
              window.remiLive2DSetPaused = function (paused) {
                if (!app || !app.ticker) return;
                if (paused) app.ticker.stop();
                else app.ticker.start();
              };

              async function boot() {
                ensureRuntime();
                app = new PIXI.Application({
                  backgroundAlpha: 0,
                  antialias: true,
                  autoDensity: true,
                  resolution: Math.max(window.devicePixelRatio || 1, 1),
                  resizeTo: window
                });
                document.body.appendChild(app.view);

                const Live2DModel = PIXI.live2d.Live2DModel;
                model = await Live2DModel.from(modelUrl, {
                  autoHitTest: false,
                  autoFocus: false,
                  ticker: app.ticker
                });
                model.anchor.set(0.5, 1);
                model.interactive = false;
                model.buttonMode = false;
                app.stage.addChild(model);
                app.ticker.maxFPS = 30;
                app.ticker.add(applyFrame);
                window.addEventListener("resize", fitModel);
                fitModel();
                applyFrame();
                post("ready");
              }

              window.addEventListener("error", function (event) {
                post("error", { message: event.message || "Live2D script error" });
              });
              window.addEventListener("unhandledrejection", function (event) {
                const reason = event.reason;
                post("error", { message: reason && reason.message ? reason.message : String(reason) });
              });

              boot().catch(function (error) {
                post("error", { message: error && error.message ? error.message : String(error) });
              });
            })();
          </script>
        </body>
        </html>
        """
    }

    private func sendCurrentFrame() {
        guard let webView else { return }
        let nowMs = currentMs() - startTimeMs
        let frame = parameterDriver.sample(
            nowMs: nowMs,
            emotion: emotion,
            phase: phase,
            lipWeight: lipWeight
        )
        let breath = parameterDriver.sampleBreath(nowMs: nowMs)

        // Viseme-driven mouth: when TTS lip-sync cues are playing, let them drive the
        // mouth shape; otherwise fall back to the phase-based placeholder weight.
        var mouthOpen = frame.mouthOpen
        var mouthForm = frame.mouthForm
        if let lipSyncEngine {
            let lipNowMs = Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
            let lip = lipSyncEngine.sample(nowMs: lipNowMs)
            mouthOpen = lip.mouthOpen
            if lipSyncEngine.isActive {
                mouthForm = lip.mouthForm
            }
        }

        let payload: [String: Any] = [
            "mouthOpen": mouthOpen,
            "mouthForm": mouthForm,
            "eyeOpen": frame.eyeOpen,
            "angleX": frame.angleX,
            "angleY": frame.angleY,
            "bodyAngleX": frame.bodyAngleX,
            "breath": breath,
            "focusX": frame.focusX,
            "focusY": frame.focusY,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        webView.evaluateJavaScript("window.remiLive2DSetFrame && window.remiLive2DSetFrame(\(json));")
    }

    private func startDisplayLinkIfNeeded() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        displayLink = link
        applyFrameRate()
    }

    @objc private func tick() {
        sendCurrentFrame()
    }

    // MARK: - Dynamic frame rate

    /// Target FPS for the current phase, capped by thermal pressure. Idle barely
    /// moves (breath/blink) so it can run much slower than active speech.
    private func preferredFps() -> Float {
        let base: Float
        switch phase {
        case .speaking:             base = 30
        case .listening, .thinking: base = 24
        case .idle:                 base = 14
        }
        return min(base, thermalCapFps())
    }

    private func thermalCapFps() -> Float {
        switch ProcessInfo.processInfo.thermalState {
        case .serious:  return 15
        case .critical: return 10
        default:        return 30
        }
    }

    private func applyFrameRate() {
        let fps = preferredFps()
        displayLink?.preferredFrameRateRange = CAFrameRateRange(
            minimum: max(fps - 6, 8),
            maximum: fps,
            preferred: fps
        )
        evalJS("window.remiLive2DSetMaxFps && window.remiLive2DSetMaxFps(\(Int(fps)));")
    }

    private func observeThermalStateIfNeeded() {
        guard thermalObserver == nil else { return }
        thermalObserver = NotificationCenter.default.addObserver(
            forName: ProcessInfo.thermalStateDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.applyFrameRate()
            }
        }
    }

    private func evalJS(_ script: String) {
        webView?.evaluateJavaScript(script)
    }

    private func currentMs() -> Int64 {
        Int64(Date.timeIntervalSinceReferenceDate * 1000)
    }
}
