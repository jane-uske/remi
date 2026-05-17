import Foundation

// MARK: - Live2D Motion Frame (port of web live2dMotion.ts)

struct Live2DMotionFrame {
    var focusX: Float = 0
    var focusY: Float = 0
    var mouthOpen: Float = 0
    var mouthForm: Float = 0
    var angleX: Float = 0
    var angleY: Float = 0
    var bodyAngleX: Float = 0
    var eyeOpen: Float = 1
}

enum RemiAvatarPhase: String {
    case idle, listening, thinking, speaking
}

// MARK: - Parameter Driver

@MainActor
final class RemiLive2DParameterDriver {

    private var lastBlinkMs: Int64 = 0
    private var breathPhase: Float = 0

    func sample(
        nowMs: Int64,
        emotion: String,
        phase: RemiAvatarPhase,
        lipWeight: Float
    ) -> Live2DMotionFrame {
        var frame = Live2DMotionFrame()

        // Focus / gaze direction based on phase
        let focus = focusForPhase(phase)
        frame.focusX = focus.x
        frame.focusY = focus.y

        // Blink cycle
        frame.eyeOpen = sampleBlink(nowMs: nowMs, phase: phase)

        // Head angle based on phase
        switch phase {
        case .listening:
            frame.angleX = 5
            frame.angleY = -1.5
        case .thinking:
            frame.angleX = -6
            frame.angleY = 7
        case .speaking:
            frame.angleX = 0
            frame.angleY = -1.5
        case .idle:
            frame.angleX = 0
            frame.angleY = -1.5
        }

        frame.bodyAngleX = round2(frame.angleX * 0.45)

        // Mouth
        frame.mouthOpen = clamp(lipWeight, 0, 1)
        frame.mouthForm = expressionMouthForm(emotion: emotion)

        return frame
    }

    func sampleBreath(nowMs: Int64) -> Float {
        let cycle: Float = 3400
        let phase = Float(nowMs % Int64(cycle)) / cycle
        return (sin(phase * .pi * 2) + 1) * 0.5
    }

    // MARK: - Private helpers

    private func focusForPhase(_ phase: RemiAvatarPhase) -> (x: Float, y: Float) {
        switch phase {
        case .listening:  return (0.06, 0.04)
        case .thinking:   return (-0.05, -0.18)
        case .speaking:   return (0.03, 0.02)
        case .idle:       return (0, 0)
        }
    }

    private func sampleBlink(nowMs: Int64, phase: RemiAvatarPhase) -> Float {
        let cycleMs: Int64 = switch phase {
        case .thinking:  5800
        case .listening: 4900
        default:         4300
        }
        let phaseInCycle = nowMs % cycleMs
        let closeStart = cycleMs - 140
        if phaseInCycle > closeStart {
            let closing = Float(phaseInCycle - closeStart) / 140.0
            return 1 - sin(closing * .pi)
        }
        return 1
    }

    private func expressionMouthForm(emotion: String, smile: Float = 0) -> Float {
        let base: Float = switch emotion {
        case "happy":   0.48
        case "sad":     -0.32
        case "curious": 0.12
        case "angry":   -0.16
        default:        0.0
        }
        return clamp(base + smile * 0.9, -1, 1)
    }

    private func clamp(_ value: Float, _ lo: Float, _ hi: Float) -> Float {
        min(hi, max(lo, value))
    }

    private func round2(_ value: Float) -> Float {
        (value * 100).rounded() / 100
    }
}
