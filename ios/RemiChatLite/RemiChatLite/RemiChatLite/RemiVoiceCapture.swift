import AVFoundation
import Foundation

@MainActor
final class RemiAudioSessionCoordinator {
    private let session = AVAudioSession.sharedInstance()
    private var captureActive = false
    private var playbackActive = false

    func beginCapture() throws {
        let previousCaptureState = captureActive
        captureActive = true
        do {
            try applyCurrentRoute()
        } catch {
            captureActive = previousCaptureState
            throw error
        }
    }

    func endCapture() {
        captureActive = false
        applyCurrentRouteSafely()
    }

    func beginPlayback() throws {
        let previousPlaybackState = playbackActive
        playbackActive = true
        do {
            try applyCurrentRoute()
        } catch {
            playbackActive = previousPlaybackState
            throw error
        }
    }

    func endPlayback() {
        playbackActive = false
        applyCurrentRouteSafely()
    }

    private func applyCurrentRoute() throws {
        if captureActive {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setPreferredSampleRate(16_000)
            try session.setPreferredIOBufferDuration(0.02)
            try session.setActive(true, options: [])
            return
        }

        if playbackActive {
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true, options: [])
            return
        }

        try session.setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private func applyCurrentRouteSafely() {
        try? applyCurrentRoute()
    }
}

@MainActor
final class RemiVoiceCapture {
    enum CaptureError: LocalizedError {
        case permissionDenied
        case audioSessionUnavailable(String)
        case engineStartFailed(String)

        var errorDescription: String? {
            switch self {
            case .permissionDenied:
                return "麦克风权限未开启"
            case .audioSessionUnavailable(let message):
                return "音频会话初始化失败：\(message)"
            case .engineStartFailed(let message):
                return "录音启动失败：\(message)"
            }
        }
    }

    private let engine = AVAudioEngine()
    private let audioSession: RemiAudioSessionCoordinator
    private var onFrame: ((Data, Int) -> Void)?
    private(set) var isRecording = false

    init(audioSession: RemiAudioSessionCoordinator) {
        self.audioSession = audioSession
    }

    func start(onFrame: @escaping (Data, Int) -> Void) async throws -> Int {
        let granted = await requestPermission()
        guard granted else {
            throw CaptureError.permissionDenied
        }

        do {
            try audioSession.beginCapture()
        } catch {
            throw CaptureError.audioSessionUnavailable(error.localizedDescription)
        }

        let inputNode = engine.inputNode
        let format = inputNode.inputFormat(forBus: 0)
        let sampleRate = Int(format.sampleRate.rounded())
        self.onFrame = onFrame

        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self,
                  let data = Self.makeMonoPCM16(from: buffer) else { return }
            self.onFrame?(data, sampleRate)
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            self.onFrame = nil
            audioSession.endCapture()
            throw CaptureError.engineStartFailed(error.localizedDescription)
        }

        isRecording = true
        return sampleRate
    }

    func stop() {
        guard isRecording else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        onFrame = nil
        isRecording = false
        audioSession.endCapture()
    }

    private func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private static func makeMonoPCM16(from buffer: AVAudioPCMBuffer) -> Data? {
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return nil }
        let channels = Int(buffer.format.channelCount)
        guard channels > 0 else { return nil }

        var pcm = Data(count: frameCount * 2)
        pcm.withUnsafeMutableBytes { rawBytes in
            guard let out = rawBytes.bindMemory(to: Int16.self).baseAddress else { return }
            switch buffer.format.commonFormat {
            case .pcmFormatFloat32:
                guard let channelData = buffer.floatChannelData else { return }
                for frame in 0..<frameCount {
                    var sum: Float = 0
                    for channel in 0..<channels {
                        sum += channelData[channel][frame]
                    }
                    let mono = max(-1.0, min(1.0, sum / Float(channels)))
                    let sample = mono < 0 ? mono * 32768.0 : mono * 32767.0
                    out[frame] = Int16(sample.rounded())
                }
            case .pcmFormatInt16:
                guard let channelData = buffer.int16ChannelData else { return }
                for frame in 0..<frameCount {
                    var sum = 0
                    for channel in 0..<channels {
                        sum += Int(channelData[channel][frame])
                    }
                    out[frame] = Int16(sum / channels)
                }
            case .pcmFormatInt32:
                guard let channelData = buffer.int32ChannelData else { return }
                for frame in 0..<frameCount {
                    var sum: Int64 = 0
                    for channel in 0..<channels {
                        sum += Int64(channelData[channel][frame])
                    }
                    let normalized = Double(sum) / Double(channels) / Double(Int32.max)
                    let sample = normalized < 0 ? normalized * 32768.0 : normalized * 32767.0
                    out[frame] = Int16(sample.rounded())
                }
            default:
                return
            }
        }
        return pcm
    }
}
