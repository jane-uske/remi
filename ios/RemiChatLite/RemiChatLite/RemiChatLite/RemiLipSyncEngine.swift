import Foundation

struct VisemeCue {
    let viseme: String
    let startMs: Double
    let durationMs: Double
    let weight: Float
}

@MainActor
final class RemiLipSyncEngine {
    private(set) var mouthOpen: Float = 0
    private(set) var mouthForm: Float = 0
    /// True while the current cue timeline is still playing (incl. a short tail).
    /// The renderer uses this to decide when visemes should drive the mouth.
    private(set) var isActive = false

    private var cues: [VisemeCue] = []
    private var timelineBaseMs: Double = 0
    private var currentGenerationId: Int?
    private var lastSampleMs: Double = 0

    private static let visemeFormMap: [String: Float] = [
        "aa": 0.08,
        "ee": 0.64,
        "oh": -0.42,
        "oo": -0.68,
        "ss": 0.22,
    ]

    func ingestCues(_ rawCues: [[String: Any]], generationId: Int, mode: String, complete: Bool) {
        if mode == "replace" || generationId != currentGenerationId {
            cues.removeAll()
            timelineBaseMs = nowMs()
            currentGenerationId = generationId
        }

        for raw in rawCues {
            guard let viseme = raw["viseme"] as? String else { continue }
            let startMs = (raw["startMs"] as? Double) ?? (raw["start"] as? Double) ?? 0
            let durationMs = (raw["durationMs"] as? Double) ?? (raw["duration"] as? Double) ?? 80
            let weight = Float((raw["weight"] as? Double) ?? 1.0)
            cues.append(VisemeCue(viseme: viseme, startMs: startMs, durationMs: durationMs, weight: weight))
        }
    }

    func sample(nowMs: Double) -> (mouthOpen: Float, mouthForm: Float) {
        let elapsed = nowMs - timelineBaseMs
        lastSampleMs = nowMs

        let latestEnd = cues.reduce(0.0) { max($0, $1.startMs + $1.durationMs) }
        isActive = !cues.isEmpty && elapsed >= -50 && elapsed <= latestEnd + 250

        var bestOpen: Float = 0
        var bestForm: Float = 0
        var found = false

        for cue in cues {
            let cueEnd = cue.startMs + cue.durationMs
            guard elapsed >= cue.startMs, elapsed < cueEnd else { continue }

            let progress = Float((elapsed - cue.startMs) / cue.durationMs)
            let envelope = sin(Float.pi * progress) * cue.weight

            if envelope > bestOpen {
                bestOpen = envelope
                bestForm = Self.visemeFormMap[cue.viseme] ?? 0
                found = true
            }
        }

        if found {
            mouthOpen = min(bestOpen, 0.86)
            mouthForm = bestForm
        } else {
            mouthOpen = max(mouthOpen - 0.06, 0)
            mouthForm = mouthForm * 0.92
        }

        return (mouthOpen, mouthForm)
    }

    func reset() {
        cues.removeAll()
        mouthOpen = 0
        mouthForm = 0
        currentGenerationId = nil
        isActive = false
    }

    private func nowMs() -> Double {
        Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
    }
}
