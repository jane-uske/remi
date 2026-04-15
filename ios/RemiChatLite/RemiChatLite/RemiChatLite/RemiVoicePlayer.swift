import AVFoundation
import Foundation

@MainActor
final class RemiVoicePlayer: NSObject, AVAudioPlayerDelegate {
    struct Clip {
        let audioData: Data
        let generationId: Int?
    }

    var onPlaybackStart: ((Int?) -> Void)?

    private let audioSession: RemiAudioSessionCoordinator
    private var queue: [Clip] = []
    private var currentPlayer: AVAudioPlayer?

    init(audioSession: RemiAudioSessionCoordinator) {
        self.audioSession = audioSession
        super.init()
    }

    var isPlaying: Bool {
        currentPlayer?.isPlaying == true
    }

    func enqueue(base64Audio: String, generationId: Int?) {
        guard let data = Data(base64Encoded: base64Audio) else { return }
        queue.append(Clip(audioData: data, generationId: generationId))
        playNextIfNeeded()
    }

    func stopAll() {
        currentPlayer?.stop()
        currentPlayer = nil
        queue.removeAll()
        audioSession.endPlayback()
    }

    private func playNextIfNeeded() {
        guard currentPlayer == nil else { return }
        guard !queue.isEmpty else {
            audioSession.endPlayback()
            return
        }
        let clip = queue.removeFirst()

        do {
            try audioSession.beginPlayback()
            let player = try AVAudioPlayer(data: clip.audioData)
            player.delegate = self
            player.prepareToPlay()
            currentPlayer = player
            onPlaybackStart?(clip.generationId)
            player.play()
        } catch {
            currentPlayer = nil
            if queue.isEmpty {
                audioSession.endPlayback()
            }
            playNextIfNeeded()
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        currentPlayer = nil
        if queue.isEmpty {
            audioSession.endPlayback()
        }
        playNextIfNeeded()
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        currentPlayer = nil
        if queue.isEmpty {
            audioSession.endPlayback()
        }
        playNextIfNeeded()
    }
}
