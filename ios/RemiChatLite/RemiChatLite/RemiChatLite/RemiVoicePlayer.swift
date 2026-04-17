import AVFoundation
import Foundation

struct RemiPcmStreamFormat: Equatable {
    let sampleRate: Int
    let channels: Int
    let bitsPerSample: Int
}

struct RemiPlaybackLifecycleEvent: Equatable {
    let generationId: Int?
}

struct RemiPlaybackLifecycleTracker {
    private(set) var activeGenerationId: Int?
    private(set) var playbackActive = false

    mutating func beginIfNeeded(for generationId: Int?) -> Bool {
        if playbackActive, activeGenerationId == generationId {
            return false
        }
        playbackActive = true
        activeGenerationId = generationId
        return true
    }

    mutating func endIfNeeded() -> RemiPlaybackLifecycleEvent? {
        guard playbackActive else { return nil }
        let event = RemiPlaybackLifecycleEvent(generationId: activeGenerationId)
        playbackActive = false
        activeGenerationId = nil
        return event
    }

    mutating func reset() {
        playbackActive = false
        activeGenerationId = nil
    }
}

struct RemiPcmStreamTracker {
    private(set) var activeGenerationId: Int?
    private(set) var activeFormat: RemiPcmStreamFormat?

    func requiresFlush(for generationId: Int?, format: RemiPcmStreamFormat) -> Bool {
        guard activeFormat != nil else { return false }
        return activeGenerationId != generationId || activeFormat != format
    }

    mutating func activate(generationId: Int?, format: RemiPcmStreamFormat) {
        activeGenerationId = generationId
        activeFormat = format
    }

    mutating func clear() {
        activeGenerationId = nil
        activeFormat = nil
    }
}

struct RemiPcm16Gain {
    static let defaultPlaybackGain: Float = 1.8
    static let maxPlaybackGain: Float = 3.0
    static let defaultPlaybackAttackGain: Float = 2.5
    static let defaultPlaybackAttackMs: Int = 420

    static func resolvedPlaybackGain(
        from environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Float {
        guard let raw = environment["REMI_IOS_TTS_PLAYBACK_GAIN"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              let gain = Float(raw),
              gain.isFinite else {
            return defaultPlaybackGain
        }
        return min(max(gain, 1.0), maxPlaybackGain)
    }

    static func resolvedPlaybackAttackGain(
        from environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Float {
        guard let raw = environment["REMI_IOS_TTS_PLAYBACK_ATTACK_GAIN"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              let gain = Float(raw),
              gain.isFinite else {
            return defaultPlaybackAttackGain
        }
        return min(max(gain, 1.0), maxPlaybackGain)
    }

    static func resolvedPlaybackAttackMs(
        from environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Int {
        guard let raw = environment["REMI_IOS_TTS_PLAYBACK_ATTACK_MS"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              let durationMs = Int(raw) else {
            return defaultPlaybackAttackMs
        }
        return min(max(durationMs, 0), 1200)
    }

    static func apply(to audioData: Data, gain: Float) -> Data {
        guard gain > 1.001, !audioData.isEmpty else { return audioData }

        var amplified = audioData
        amplified.withUnsafeMutableBytes { rawBytes in
            let samples = rawBytes.bindMemory(to: Int16.self)
            guard let baseAddress = samples.baseAddress else { return }

            for index in 0..<samples.count {
                baseAddress[index] = amplify(baseAddress[index], gain: gain)
            }
        }
        return amplified
    }

    static func applyAttackEnvelope(
        to audioData: Data,
        baseGain: Float,
        attackGain: Float,
        attackSamplesRemaining: inout Int
    ) -> Data {
        guard !audioData.isEmpty else { return audioData }
        guard attackSamplesRemaining > 0, attackGain > baseGain + 0.001 else {
            return apply(to: audioData, gain: baseGain)
        }

        var amplified = audioData
        amplified.withUnsafeMutableBytes { rawBytes in
            let samples = rawBytes.bindMemory(to: Int16.self)
            guard let baseAddress = samples.baseAddress else { return }

            for index in 0..<samples.count {
                let gain = attackSamplesRemaining > 0 ? attackGain : baseGain
                baseAddress[index] = amplify(baseAddress[index], gain: gain)
                if attackSamplesRemaining > 0 {
                    attackSamplesRemaining -= 1
                }
            }
        }
        return amplified
    }

    private static func amplify(_ sample: Int16, gain: Float) -> Int16 {
        let scaled = (Float(sample) * gain).rounded()
        let clamped = min(Float(Int16.max), max(Float(Int16.min), scaled))
        return Int16(clamped)
    }
}

@MainActor
final class RemiVoicePlayer: NSObject, @preconcurrency AVAudioPlayerDelegate {
    struct Clip {
        let audioData: Data
        let generationId: Int?
    }

    static let streamDrainDelayNs: UInt64 = 160_000_000
    static let streamPlaybackGain = RemiPcm16Gain.resolvedPlaybackGain()
    static let streamPlaybackAttackGain = RemiPcm16Gain.resolvedPlaybackAttackGain()
    static let streamPlaybackAttackMs = RemiPcm16Gain.resolvedPlaybackAttackMs()

    var onPlaybackStart: ((Int?) -> Void)?
    var onPlaybackEnd: ((Int?) -> Void)?

    private let audioSession: RemiAudioSessionCoordinator
    private var queue: [Clip] = []
    private var currentPlayer: AVAudioPlayer?
    private var currentClipStartedAt: TimeInterval?
    private var lastClipEndedAt: TimeInterval?

    private var streamEngine: AVAudioEngine?
    private var streamPlayerNode: AVAudioPlayerNode?
    private var streamFormat: RemiPcmStreamFormat?
    private var streamActiveGenerationId: Int?
    private var streamOutstandingBuffers = 0
    private var streamDrainTask: Task<Void, Never>?
    private var playbackLifecycleTracker = RemiPlaybackLifecycleTracker()
    private var streamTracker = RemiPcmStreamTracker()
    private var streamAttackSamplesRemaining = 0

    init(audioSession: RemiAudioSessionCoordinator) {
        self.audioSession = audioSession
        super.init()
    }

    var isPlaying: Bool {
        currentPlayer?.isPlaying == true || streamPlayerNode?.isPlaying == true
    }

    func enqueue(base64Audio: String, generationId: Int?) {
        guard let data = Data(base64Encoded: base64Audio), !data.isEmpty else { return }
        if playbackLifecycleTracker.playbackActive,
           playbackLifecycleTracker.activeGenerationId != generationId {
            stopBufferedPlayback(releaseAudioSession: false)
        }
        stopStreamingPlayback(
            releaseAudioSession: false,
            notifyLifecycleEnd: streamActiveGenerationId != generationId
        )
        queue.append(Clip(audioData: data, generationId: generationId))
        playNextIfNeeded()
    }

    func enqueuePcmChunk(
        base64Audio: String,
        sampleRate: Int,
        channels: Int,
        bitsPerSample: Int,
        generationId: Int?
    ) {
        guard channels == 1, bitsPerSample == 16, sampleRate > 0 else {
            Self.log("drop pcm chunk: unsupported format sr=\(sampleRate) ch=\(channels) bits=\(bitsPerSample)")
            return
        }
        guard let audioData = Data(base64Encoded: base64Audio), !audioData.isEmpty else {
            return
        }

        stopBufferedPlayback(
            releaseAudioSession: false,
            notifyLifecycleEnd: playbackLifecycleTracker.activeGenerationId != generationId
        )

        let nextFormat = RemiPcmStreamFormat(
            sampleRate: sampleRate,
            channels: channels,
            bitsPerSample: bitsPerSample
        )

        if streamPlayerNode != nil && streamTracker.requiresFlush(for: generationId, format: nextFormat) {
            if streamActiveGenerationId != generationId {
                Self.log("stream rollover oldGen=\(streamGenerationLabel(streamActiveGenerationId)) newGen=\(streamGenerationLabel(generationId))")
            } else if let activeFormat = streamFormat {
                Self.log("stream format change old=\(activeFormat.sampleRate)/\(activeFormat.channels)/\(activeFormat.bitsPerSample) new=\(sampleRate)/\(channels)/\(bitsPerSample)")
            }
            stopStreamingPlayback(
                releaseAudioSession: false,
                notifyLifecycleEnd: streamActiveGenerationId != generationId
            )
        }

        do {
            let format = try ensureStreamingGraph(for: nextFormat, generationId: generationId)
            let amplifiedAudioData = RemiPcm16Gain.applyAttackEnvelope(
                to: audioData,
                baseGain: Self.streamPlaybackGain,
                attackGain: max(Self.streamPlaybackGain, Self.streamPlaybackAttackGain),
                attackSamplesRemaining: &streamAttackSamplesRemaining
            )
            guard let buffer = Self.makeStreamBuffer(audioData: amplifiedAudioData, format: format) else {
                return
            }

            streamDrainTask?.cancel()
            streamDrainTask = nil
            streamOutstandingBuffers += 1
            streamActiveGenerationId = generationId

            streamPlayerNode?.scheduleBuffer(
                buffer,
                completionCallbackType: .dataPlayedBack
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.handleStreamBufferPlayedBack()
                }
            }

            if streamPlayerNode?.isPlaying != true {
                streamPlayerNode?.play()
            }
            reportPlaybackStartIfNeeded(for: generationId)
        } catch {
            Self.log("stream start failed: \(error.localizedDescription)")
            stopStreamingPlayback(releaseAudioSession: currentPlayer == nil && queue.isEmpty)
        }
    }

    func stopAll() {
        stopBufferedPlayback(releaseAudioSession: false)
        stopStreamingPlayback(releaseAudioSession: false)
        playbackLifecycleTracker.reset()
        audioSession.endPlayback()
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        guard currentPlayer === player else { return }
        currentPlayer = nil
        let endedAt = ProcessInfo.processInfo.systemUptime
        if let currentClipStartedAt {
            let playedMs = max(0, Int((endedAt - currentClipStartedAt) * 1000))
            Self.log("clip end playedMs=\(playedMs) remaining=\(queue.count)")
        }
        self.currentClipStartedAt = nil
        lastClipEndedAt = endedAt
        if queue.isEmpty, streamPlayerNode == nil {
            reportPlaybackEndIfNeeded()
            audioSession.endPlayback()
        }
        playNextIfNeeded()
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        guard currentPlayer === player else { return }
        currentPlayer = nil
        currentClipStartedAt = nil
        lastClipEndedAt = nil
        Self.log("clip decode error: \(error?.localizedDescription ?? "unknown")")
        if queue.isEmpty, streamPlayerNode == nil {
            reportPlaybackEndIfNeeded()
            audioSession.endPlayback()
        }
        playNextIfNeeded()
    }

    private func playNextIfNeeded() {
        guard currentPlayer == nil else { return }
        guard streamPlayerNode == nil else { return }
        guard !queue.isEmpty else {
            reportPlaybackEndIfNeeded()
            audioSession.endPlayback()
            return
        }
        let clip = queue.removeFirst()
        let now = ProcessInfo.processInfo.systemUptime
        let generationLabel = clip.generationId.map { String($0) } ?? "nil"

        do {
            try audioSession.beginPlayback()
            let player = try AVAudioPlayer(data: clip.audioData)
            player.delegate = self
            player.prepareToPlay()
            currentPlayer = player
            currentClipStartedAt = now
            if let lastClipEndedAt {
                let gapMs = max(0, Int((now - lastClipEndedAt) * 1000))
                Self.log("clip start gen=\(generationLabel) gapMs=\(gapMs) queued=\(queue.count)")
            } else {
                Self.log("clip start gen=\(generationLabel) gapMs=first queued=\(queue.count)")
            }
            reportPlaybackStartIfNeeded(for: clip.generationId)
            player.play()
        } catch {
            currentPlayer = nil
            currentClipStartedAt = nil
            if queue.isEmpty, streamPlayerNode == nil {
                audioSession.endPlayback()
            }
            playNextIfNeeded()
        }
    }

    private func ensureStreamingGraph(
        for format: RemiPcmStreamFormat,
        generationId: Int?
    ) throws -> AVAudioFormat {
        if let activeFormat = streamFormat,
           activeFormat == format,
           let streamPlayerNode,
           let streamEngine {
            if !streamEngine.isRunning {
                try streamEngine.start()
            }
            streamActiveGenerationId = generationId
            streamTracker.activate(generationId: generationId, format: format)
            return streamPlayerNode.outputFormat(forBus: 0)
        }

        stopStreamingPlayback(releaseAudioSession: false)
        try audioSession.beginPlayback()

        let audioFormat = Self.makeAudioFormat(sampleRate: format.sampleRate, channels: format.channels)
        let engine = AVAudioEngine()
        let playerNode = AVAudioPlayerNode()
        engine.attach(playerNode)
        engine.connect(playerNode, to: engine.mainMixerNode, format: audioFormat)
        engine.prepare()
        try engine.start()
        Self.log(
            "stream graph start gen=\(streamGenerationLabel(generationId)) sr=\(format.sampleRate) gain=\(Self.streamPlaybackGain)"
        )

        streamEngine = engine
        streamPlayerNode = playerNode
        streamFormat = format
        streamActiveGenerationId = generationId
        streamTracker.activate(generationId: generationId, format: format)
        streamOutstandingBuffers = 0
        streamAttackSamplesRemaining = Int(
            (Double(format.sampleRate) * Double(Self.streamPlaybackAttackMs)) / 1000.0
        )
        return audioFormat
    }

    private func handleStreamBufferPlayedBack() {
        streamOutstandingBuffers = max(0, streamOutstandingBuffers - 1)
        guard streamOutstandingBuffers == 0 else { return }

        streamDrainTask?.cancel()
        streamDrainTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.streamDrainDelayNs)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self else { return }
                guard self.streamOutstandingBuffers == 0 else { return }
                Self.log("stream drain complete gen=\(self.streamGenerationLabel(self.streamActiveGenerationId))")
                self.stopStreamingPlayback(
                    releaseAudioSession: self.currentPlayer == nil && self.queue.isEmpty
                )
                self.playNextIfNeeded()
            }
        }
    }

    private func stopBufferedPlayback(
        releaseAudioSession: Bool,
        notifyLifecycleEnd: Bool = true
    ) {
        let hadBufferedPlayback = currentPlayer != nil || !queue.isEmpty
        currentPlayer?.stop()
        currentPlayer = nil
        queue.removeAll()
        currentClipStartedAt = nil
        lastClipEndedAt = nil
        if notifyLifecycleEnd && hadBufferedPlayback {
            reportPlaybackEndIfNeeded()
        }
        if releaseAudioSession && streamPlayerNode == nil {
            audioSession.endPlayback()
        }
    }

    private func stopStreamingPlayback(
        releaseAudioSession: Bool,
        notifyLifecycleEnd: Bool = true
    ) {
        let hadStreamingPlayback =
            streamPlayerNode != nil || streamOutstandingBuffers > 0 || streamActiveGenerationId != nil
        streamDrainTask?.cancel()
        streamDrainTask = nil
        streamPlayerNode?.stop()
        streamEngine?.stop()
        streamEngine?.reset()
        streamPlayerNode = nil
        streamEngine = nil
        streamFormat = nil
        streamActiveGenerationId = nil
        streamTracker.clear()
        streamOutstandingBuffers = 0
        streamAttackSamplesRemaining = 0
        if notifyLifecycleEnd && hadStreamingPlayback {
            reportPlaybackEndIfNeeded()
        }
        if releaseAudioSession && currentPlayer == nil && queue.isEmpty {
            audioSession.endPlayback()
        }
    }

    private func reportPlaybackStartIfNeeded(for generationId: Int?) {
        if !playbackLifecycleTracker.beginIfNeeded(for: generationId) {
            return
        }
        onPlaybackStart?(generationId)
    }

    private func reportPlaybackEndIfNeeded() {
        guard let event = playbackLifecycleTracker.endIfNeeded() else {
            return
        }
        onPlaybackEnd?(event.generationId)
    }

    private static func makeAudioFormat(sampleRate: Int, channels: Int) -> AVAudioFormat {
        AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: Double(sampleRate),
            channels: AVAudioChannelCount(channels),
            interleaved: false
        )!
    }

    private static func makeStreamBuffer(audioData: Data, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let bytesPerFrame = MemoryLayout<Int16>.size * Int(format.channelCount)
        guard bytesPerFrame > 0, audioData.count >= bytesPerFrame else { return nil }

        let frameCount = audioData.count / bytesPerFrame
        guard frameCount > 0,
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(frameCount)
              ),
              let channelData = buffer.int16ChannelData else {
            return nil
        }

        buffer.frameLength = AVAudioFrameCount(frameCount)
        audioData.withUnsafeBytes { rawBytes in
            guard let source = rawBytes.bindMemory(to: Int16.self).baseAddress else { return }
            channelData[0].update(from: source, count: frameCount)
        }
        return buffer
    }

    private func streamGenerationLabel(_ generationId: Int?) -> String {
        generationId.map { String($0) } ?? "nil"
    }

    private static func log(_ message: String) {
        print("[RemiVoicePlayer] \(message)")
    }
}
