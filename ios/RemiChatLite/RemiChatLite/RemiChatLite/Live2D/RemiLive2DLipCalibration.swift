import Foundation

struct LipCalibrationState {
    var mouthOpen: Float = 0
    var mouthForm: Float = 0
    var lastUpdatedAtMs: Double = 0
}

struct LipCalibrationProfile {
    var attackMs: Float = 44
    var releaseMs: Float = 126
    var maxOpen: Float = 0.86
    var minOpen: Float = 0
    var formAttackMs: Float = 60
    var formReleaseMs: Float = 180
    var formBlend: Float = 0.72

    static let hiyoriPro = LipCalibrationProfile()
}

struct LipCalibrationInput {
    var nowMs: Double
    var baseMouthOpen: Float = 0
    var baseMouthForm: Float = 0
    var visemeMouthOpen: Float = 0
    var visemeMouthForm: Float = 0
    var envelope: Float = 0
    var voiceActive: Bool = false
}

struct LipCalibrationOutput {
    var mouthOpen: Float
    var mouthForm: Float
    var state: LipCalibrationState
}

enum RemiLive2DLipCalibration {

    static func sample(
        input: LipCalibrationInput,
        previous: LipCalibrationState?,
        profile: LipCalibrationProfile = .hiyoriPro
    ) -> LipCalibrationOutput {
        let prev = previous ?? LipCalibrationState(
            mouthOpen: 0,
            mouthForm: 0,
            lastUpdatedAtMs: input.nowMs - 16
        )
        let dtMs = Float(clamp(input.nowMs - prev.lastUpdatedAtMs, min: 8, max: 120))

        let voiceFloor: Float = input.voiceActive ? 0.04 : 0
        var targetOpen = max(
            input.baseMouthOpen,
            input.visemeMouthOpen,
            input.envelope * 0.82,
            voiceFloor
        )
        targetOpen = clamp(targetOpen, min: profile.minOpen, max: profile.maxOpen)

        let targetForm = clamp(
            input.baseMouthForm + input.visemeMouthForm * profile.formBlend,
            min: -1,
            max: 1
        )

        let mouthOpen = round2(clamp(
            smoothValue(
                current: prev.mouthOpen,
                target: targetOpen,
                dtMs: dtMs,
                attackMs: profile.attackMs,
                releaseMs: profile.releaseMs
            ),
            min: 0, max: 1
        ))

        let mouthForm = round2(clamp(
            smoothValue(
                current: prev.mouthForm,
                target: targetForm,
                dtMs: dtMs,
                attackMs: profile.formAttackMs,
                releaseMs: profile.formReleaseMs
            ),
            min: -1, max: 1
        ))

        return LipCalibrationOutput(
            mouthOpen: mouthOpen,
            mouthForm: mouthForm,
            state: LipCalibrationState(
                mouthOpen: mouthOpen,
                mouthForm: mouthForm,
                lastUpdatedAtMs: input.nowMs
            )
        )
    }

    private static func smoothValue(
        current: Float,
        target: Float,
        dtMs: Float,
        attackMs: Float,
        releaseMs: Float
    ) -> Float {
        let duration = target >= current ? attackMs : releaseMs
        let alpha = clamp(dtMs / max(duration, 1), min: 0, max: 1)
        return current + (target - current) * alpha
    }

    private static func clamp(_ value: Float, min lo: Float, max hi: Float) -> Float {
        Swift.min(hi, Swift.max(lo, value))
    }

    private static func clamp(_ value: Double, min lo: Double, max hi: Double) -> Double {
        Swift.min(hi, Swift.max(lo, value))
    }

    private static func round2(_ value: Float) -> Float {
        (value * 100).rounded() / 100
    }
}
