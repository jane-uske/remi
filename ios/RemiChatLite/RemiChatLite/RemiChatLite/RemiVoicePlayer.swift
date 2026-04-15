import AVFoundation
import Foundation

@MainActor
final class RemiVoicePlayer: NSObject, AVAudioPlayerDelegate {
    struct Clip {
        let audioData: Data
        let generationId: Int?
    }

    var onPlaybackStart: ((Int?) -> Void)?

    private var queue: [Clip] = []
    private var currentPlayer: AVAudioPlayer?

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
    }

    private func playNextIfNeeded() {
        guard currentPlayer == nil, !queue.isEmpty else { return }
        let clip = queue.removeFirst()
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio)
        try? session.setActive(true, options: [])

        do {
            let player = try AVAudioPlayer(data: clip.audioData)
            player.delegate = self
            player.prepareToPlay()
            currentPlayer = player
            onPlaybackStart?(clip.generationId)
            player.play()
        } catch {
            currentPlayer = nil
            playNextIfNeeded()
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        currentPlayer = nil
        playNextIfNeeded()
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        currentPlayer = nil
        playNextIfNeeded()
    }
}
