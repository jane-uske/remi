import Foundation
import AVFoundation
import os

/// Sequential TTS playback for the watch.
///
/// The gateway streams Remi's speech as a series of self-contained MP3 segments
/// (`voice` frames, one per sentence/word-boundary). `AVAudioPlayer` plays one
/// `Data` at a time, so segments are queued and the next starts when the current
/// finishes. Playback can be muted; muting also drops the queue and stops audio.
@MainActor
final class WatchVoicePlayer: NSObject {
    private static let log = Logger(subsystem: "run.remi.watch", category: "tts")

    var enabled = true {
        didSet { if !enabled { stopAll() } }
    }

    private(set) var isPlaying = false {
        didSet {
            guard oldValue != isPlaying else { return }
            onPlayingChanged?(isPlaying)
        }
    }

    var onPlayingChanged: ((Bool) -> Void)?

    private var queue: [Data] = []
    private var player: AVAudioPlayer?
    private var sessionActivated = false

    func enqueue(_ data: Data) {
        guard enabled, !data.isEmpty else { return }
        queue.append(data)
        Self.log.notice("tts enqueue \(data.count, privacy: .public) bytes (queue=\(self.queue.count, privacy: .public))")
        if player == nil { playNext() }
    }

    func stopAll() {
        player?.stop()
        player = nil
        queue.removeAll()
        isPlaying = false
    }

    private func activateSessionIfNeeded() {
        guard !sessionActivated else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [])
        try? session.setActive(true)
        sessionActivated = true
    }

    private func playNext() {
        guard enabled, !queue.isEmpty else {
            player = nil
            isPlaying = false
            return
        }
        let data = queue.removeFirst()
        activateSessionIfNeeded()
        do {
            let next = try AVAudioPlayer(data: data)
            next.delegate = self
            player = next
            next.prepareToPlay()
            next.play()
            isPlaying = true
            Self.log.notice("tts play segment (\(data.count, privacy: .public) bytes), remaining=\(self.queue.count, privacy: .public)")
        } catch {
            Self.log.error("tts decode failed, skipping segment: \(error.localizedDescription, privacy: .public)")
            playNext()
        }
    }
}

extension WatchVoicePlayer: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.playNext() }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in self.playNext() }
    }
}
