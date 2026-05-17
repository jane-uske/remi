import Foundation

struct ScheduledEmotionBeat {
    let delayMs: Double
    let emotion: String
    let holdMs: Double
}

@MainActor
final class RemiAvatarIntentScheduler {
    private var pendingTasks: [Task<Void, Never>] = []
    var onEmotionChange: ((String) -> Void)?

    func schedule(emotion: String, gesture: String, gestureIntensity: Int, energy: Int, holdMs: Int, beats: [[String: Any]]) {
        cancelPending()

        onEmotionChange?(emotion)

        for beat in beats {
            guard let beatEmotion = beat["emotion"] as? String else { continue }
            let delayMs = (beat["delayMs"] as? Double)
                ?? (beat["delay"] as? Double)
                ?? Double(beat["delayMs"] as? Int ?? 0)
            guard delayMs > 0 else {
                onEmotionChange?(beatEmotion)
                continue
            }

            let task = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(delayMs * 1_000_000))
                guard !Task.isCancelled else { return }
                self?.onEmotionChange?(beatEmotion)
            }
            pendingTasks.append(task)
        }
    }

    func cancelPending() {
        for task in pendingTasks {
            task.cancel()
        }
        pendingTasks.removeAll()
    }
}
