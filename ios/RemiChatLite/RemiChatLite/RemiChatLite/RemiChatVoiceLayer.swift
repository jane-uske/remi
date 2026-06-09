import Foundation

// MARK: - Voice Layer (PTT / Duplex / PCM / Audio Drain)
//
// Extracted from RemiChatStore (Phase 7).
// To complete the split in Xcode:
//   1. Remove these methods from RemiChatStore.swift
//   2. Change the following properties from `private` to `internal` in RemiChatStore.swift:
//      - voiceCapture, voicePlayer, audioSession
//      - pendingVoiceStartMode, activeVoiceMode, voiceStartTask, voiceResultTimeoutTask
//      - acceptingCapturedAudioFrames, outboundAudioFrames, audioFrameSendInFlight
//      - pendingDuplexStopAfterDrain, audioDrainTask, audioDrainForceDeadlineNs
//      - duplexTxFrameCount, lastMeaningfulVoicePartial, lastUserTranscriptAtMs
//   3. Static constants (pushToTalkResultTimeoutNs, etc.) must also be internal.
//   4. The free function encodePcmAudioFrame is defined at the bottom of this file.

enum VoiceCaptureMode {
    case duplex
    case pushToTalk
}

extension RemiChatStore {

    // MARK: - Push-to-Talk

    func beginPushToTalk() {
        guard !duplexEnabled, !pushToTalkAwaitingResult else { return }
        guard !voiceRecording, voiceStartTask == nil else { return }
        guard connectionPhase == .open, socket != nil else {
            appendMessage(ChatMessage(role: .sys, text: "Connection is not ready for voice yet. Give it a second and try again."))
            if connectionPhase != .connecting {
                connect()
            }
            return
        }

        voicePlayer.stopAll()
        clearAssistantResponseWait()
        cancelPushToTalkResultTimeout()
        lastMeaningfulVoicePartial = ""
        voiceTranscriptPreview = ""
        voiceStatusCaption = Self.pushToTalkListeningCaption
        pendingVoiceStartMode = .pushToTalk

        voiceStartTask = Task { [weak self] in
            guard let self else { return }
            do {
                let sampleRate = try await self.voiceCapture.start { [weak self] pcm, frameSampleRate in
                    Task { @MainActor [weak self] in
                        self?.sendPcmFrame(pcm, sampleRate: frameSampleRate)
                    }
                }
                if Task.isCancelled {
                    self.pendingVoiceStartMode = nil
                    self.voiceCapture.stop()
                    self.resetVoiceStatus()
                    self.voiceStartTask = nil
                    return
                }
                guard self.pendingVoiceStartMode == .pushToTalk, !self.duplexEnabled else {
                    self.pendingVoiceStartMode = nil
                    self.voiceCapture.stop()
                    self.resetVoiceStatus()
                    self.voiceStartTask = nil
                    return
                }
                self.pendingVoiceStartMode = nil
                self.activeVoiceMode = .pushToTalk
                self.pushToTalkRecording = true
                self.voiceRecording = true
                self.voiceStartTask = nil
                self.voiceStatusCaption = Self.pushToTalkListeningCaption
                self.acceptingCapturedAudioFrames = true
                self.log("voice capture ready mode=push_to_talk sampleRate=\(sampleRate)")
                self.sendJSON([
                    "type": "duplex_start",
                    "mode": "push_to_talk",
                    "sampleRate": sampleRate,
                ])
            } catch {
                self.log("voice capture failed mode=push_to_talk error=\(error.localizedDescription)")
                self.voiceStartTask = nil
                self.pendingVoiceStartMode = nil
                self.activeVoiceMode = nil
                self.pushToTalkRecording = false
                self.voiceRecording = false
                self.resetVoiceStatus()
                self.appendMessage(ChatMessage(role: .error, text: error.localizedDescription))
            }
        }
    }

    func endPushToTalk() {
        guard !duplexEnabled else { return }

        if voiceStartTask != nil, pendingVoiceStartMode == .pushToTalk {
            stopPushToTalk(sendDuplexStop: false, clearStatus: true)
            return
        }

        guard activeVoiceMode == .pushToTalk, pushToTalkRecording else { return }
        stopPushToTalk(sendDuplexStop: true, clearStatus: false)
        voiceStatusCaption = "Transcribing..."
        voiceTranscriptPreview = lastMeaningfulVoicePartial
        armPushToTalkResultTimeout()
    }

    // MARK: - Duplex

    func enterDuplexMode() {
        guard !duplexEnabled else { return }
        guard !pushToTalkRecording, !pushToTalkAwaitingResult, pendingVoiceStartMode != .pushToTalk else { return }
        duplexEnabled = true
        beginDuplexIfPossible()
    }

    func exitDuplexMode() {
        guard duplexEnabled || pendingVoiceStartMode == .duplex || activeVoiceMode == .duplex else { return }
        voicePlayer.stopAll()
        stopDuplex(sendDuplexStop: true, keepDesiredState: false)
    }

    func toggleDuplex() {
        if duplexEnabled {
            exitDuplexMode()
        } else {
            enterDuplexMode()
        }
    }

    func beginDuplexIfPossible() {
        guard duplexEnabled, !voiceRecording, voiceStartTask == nil, !pushToTalkAwaitingResult else { return }
        guard connectionPhase == .open, socket != nil else {
            voiceStatusCaption = Self.duplexConnectingCaption
            voiceTranscriptPreview = ""
            if connectionPhase != .connecting {
                connect()
            }
            return
        }

        voicePlayer.stopAll()
        clearAssistantResponseWait()
        lastMeaningfulVoicePartial = ""
        voiceTranscriptPreview = ""
        voiceStatusCaption = Self.duplexConnectingCaption
        pendingVoiceStartMode = .duplex

        voiceStartTask = Task { [weak self] in
            guard let self else { return }
            do {
                let sampleRate = try await self.voiceCapture.start { [weak self] pcm, frameSampleRate in
                    Task { @MainActor [weak self] in
                        self?.sendPcmFrame(pcm, sampleRate: frameSampleRate)
                    }
                }
                if Task.isCancelled {
                    self.pendingVoiceStartMode = nil
                    self.voiceCapture.stop()
                    self.resetVoiceStatus()
                    self.voiceStartTask = nil
                    return
                }
                guard self.pendingVoiceStartMode == .duplex, self.duplexEnabled else {
                    self.pendingVoiceStartMode = nil
                    self.voiceCapture.stop()
                    self.resetVoiceStatus()
                    self.voiceStartTask = nil
                    return
                }
                self.pendingVoiceStartMode = nil
                self.activeVoiceMode = .duplex
                self.voiceRecording = true
                self.voiceStartTask = nil
                self.voiceStatusCaption = Self.duplexIdleCaption
                self.acceptingCapturedAudioFrames = true
                self.log("voice capture ready mode=duplex sampleRate=\(sampleRate)")
                self.sendJSON([
                    "type": "duplex_start",
                    "mode": "duplex",
                    "sampleRate": sampleRate,
                ])
            } catch {
                self.log("voice capture failed mode=duplex error=\(error.localizedDescription)")
                self.voiceStartTask = nil
                self.pendingVoiceStartMode = nil
                self.activeVoiceMode = nil
                self.voiceRecording = false
                self.duplexEnabled = false
                self.resetVoiceStatus()
                self.appendMessage(ChatMessage(role: .error, text: error.localizedDescription))
            }
        }
    }

    // MARK: - Stop Helpers

    func stopPushToTalk(sendDuplexStop: Bool, clearStatus: Bool) {
        if voiceStartTask != nil, pendingVoiceStartMode == .pushToTalk {
            voiceStartTask?.cancel()
            voiceStartTask = nil
            pendingVoiceStartMode = nil
            activeVoiceMode = nil
            pushToTalkRecording = false
            voiceRecording = false
            if clearStatus {
                resetVoiceStatus()
            }
            return
        }

        guard activeVoiceMode == .pushToTalk || pushToTalkRecording else {
            if clearStatus, !duplexEnabled {
                resetVoiceStatus()
            }
            return
        }

        voiceCapture.stop()
        activeVoiceMode = nil
        pushToTalkRecording = false
        voiceRecording = false
        if sendDuplexStop {
            requestDuplexStopAfterAudioDrain()
        } else {
            resetOutboundAudioState(dropQueuedFrames: true)
        }
        if clearStatus {
            resetVoiceStatus()
        }
    }

    func stopDuplex(sendDuplexStop: Bool, keepDesiredState: Bool) {
        if !keepDesiredState {
            duplexEnabled = false
        }

        if voiceStartTask != nil, pendingVoiceStartMode == .duplex {
            voiceStartTask?.cancel()
            voiceStartTask = nil
            pendingVoiceStartMode = nil
            activeVoiceMode = nil
            voiceRecording = false
            if keepDesiredState {
                voiceStatusCaption = Self.duplexConnectingCaption
                voiceTranscriptPreview = ""
                lastMeaningfulVoicePartial = ""
            } else {
                resetVoiceStatus()
            }
            return
        }

        guard activeVoiceMode == .duplex else {
            if keepDesiredState {
                voiceStatusCaption = Self.duplexConnectingCaption
                voiceTranscriptPreview = ""
                lastMeaningfulVoicePartial = ""
            } else {
                resetVoiceStatus()
            }
            return
        }

        voiceCapture.stop()
        activeVoiceMode = nil
        voiceRecording = false
        if sendDuplexStop {
            requestDuplexStopAfterAudioDrain()
        } else {
            resetOutboundAudioState(dropQueuedFrames: true)
        }

        if keepDesiredState {
            voiceStatusCaption = Self.duplexConnectingCaption
            voiceTranscriptPreview = ""
            lastMeaningfulVoicePartial = ""
        } else {
            resetVoiceStatus()
        }
    }

    // MARK: - PCM Frame Transmission

    func sendPcmFrame(_ pcm16: Data, sampleRate: Int) {
        guard acceptingCapturedAudioFrames, socket != nil else { return }
        let frame = encodePcmAudioFrame(pcm16: pcm16, sampleRate: sampleRate)
        outboundAudioFrames.append(frame)
        duplexTxFrameCount += 1
        if duplexTxFrameCount == 1 {
            log("duplex tx first_frame pcmBytes=\(pcm16.count) sampleRate=\(sampleRate)")
        } else if duplexTxFrameCount % 50 == 0 {
            log("duplex tx frames=\(duplexTxFrameCount) queued=\(outboundAudioFrames.count) sampleRate=\(sampleRate)")
        }
        drainOutboundAudioFramesIfNeeded()
    }

    func sendPlaybackStart(generationId: Int?) {
        guard connectionPhase == .open, socket != nil else { return }
        var payload: [String: Any] = ["type": "playback_start"]
        if let generationId {
            payload["generationId"] = generationId
        }
        sendVolatileJSON(payload)
    }

    func sendPlaybackEnd(generationId: Int?) {
        guard connectionPhase == .open, socket != nil else { return }
        var payload: [String: Any] = ["type": "playback_end"]
        if let generationId {
            payload["generationId"] = generationId
        }
        sendVolatileJSON(payload)
    }

    // MARK: - Audio Drain Pipeline

    func drainOutboundAudioFramesIfNeeded() {
        guard !audioFrameSendInFlight else { return }
        guard let socket else {
            resetOutboundAudioState(dropQueuedFrames: true)
            return
        }
        guard !outboundAudioFrames.isEmpty else { return }

        audioFrameSendInFlight = true
        let frame = outboundAudioFrames.removeFirst()
        socket.send(.data(frame)) { [weak self] error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.audioFrameSendInFlight = false
                if let error {
                    self.resetOutboundAudioState(dropQueuedFrames: true)
                    self.handleSocketFailure(error)
                    return
                }
                self.drainOutboundAudioFramesIfNeeded()
            }
        }
    }

    func requestDuplexStopAfterAudioDrain() {
        pendingDuplexStopAfterDrain = true
        audioDrainForceDeadlineNs = DispatchTime.now().uptimeNanoseconds + Self.audioDrainForceStopNs
        scheduleDuplexStopDrainPoll()
    }

    func scheduleDuplexStopDrainPoll() {
        audioDrainTask?.cancel()
        audioDrainTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.audioDrainPollNs)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.pollPendingDuplexStopAfterDrain()
            }
        }
    }

    func pollPendingDuplexStopAfterDrain() {
        guard pendingDuplexStopAfterDrain else { return }
        if outboundAudioFrames.isEmpty && !audioFrameSendInFlight {
            finalizePendingDuplexStopAfterDrain(force: false)
            return
        }

        let nowNs = DispatchTime.now().uptimeNanoseconds
        if let deadlineNs = audioDrainForceDeadlineNs, nowNs < deadlineNs {
            scheduleDuplexStopDrainPoll()
            return
        }

        finalizePendingDuplexStopAfterDrain(force: true)
    }

    func finalizePendingDuplexStopAfterDrain(force: Bool) {
        guard pendingDuplexStopAfterDrain else { return }
        pendingDuplexStopAfterDrain = false
        audioDrainTask?.cancel()
        audioDrainTask = nil
        audioDrainForceDeadlineNs = nil
        acceptingCapturedAudioFrames = false

        if force && (!outboundAudioFrames.isEmpty || audioFrameSendInFlight) {
            log("forcing duplex_stop with \(outboundAudioFrames.count) queued audio frame(s)")
            outboundAudioFrames.removeAll()
            audioFrameSendInFlight = false
        }

        if socket != nil {
            sendJSON(["type": "duplex_stop"])
        }
    }

    func resetOutboundAudioState(dropQueuedFrames: Bool) {
        audioDrainTask?.cancel()
        audioDrainTask = nil
        audioDrainForceDeadlineNs = nil
        pendingDuplexStopAfterDrain = false
        acceptingCapturedAudioFrames = false
        duplexTxFrameCount = 0
        if dropQueuedFrames {
            outboundAudioFrames.removeAll()
        }
        audioFrameSendInFlight = false
    }

    // MARK: - Voice Status / Timeout

    func resetVoiceStatus() {
        cancelPushToTalkResultTimeout()
        voiceStatusCaption = ""
        voiceTranscriptPreview = ""
        lastMeaningfulVoicePartial = ""
    }

    func armPushToTalkResultTimeout() {
        armPushToTalkResultTimeout(nanoseconds: Self.pushToTalkResultTimeoutNs)
    }

    func armPushToTalkResultTimeout(nanoseconds: UInt64) {
        cancelPushToTalkResultTimeout()
        pushToTalkAwaitingResult = true
        voiceResultTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.handlePushToTalkResultTimeout()
            }
        }
    }

    func cancelPushToTalkResultTimeout() {
        voiceResultTimeoutTask?.cancel()
        voiceResultTimeoutTask = nil
        pushToTalkAwaitingResult = false
    }

    func handlePushToTalkResultTimeout() {
        guard pushToTalkAwaitingResult else { return }
        pushToTalkAwaitingResult = false
        voiceResultTimeoutTask = nil
        if voiceTranscriptPreview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            voiceTranscriptPreview = lastMeaningfulVoicePartial
        }
        voiceStatusCaption = "No transcript came back. Hold to try again."
        appendMessage(ChatMessage(role: .error, text: "Voice input timed out before a transcript arrived. Hold to try again."))
    }

    func updateVoiceListeningCaption(elapsed: String? = nil) {
        if let elapsed, !elapsed.isEmpty {
            voiceStatusCaption = "Listening... \(elapsed)"
        } else {
            voiceStatusCaption = Self.pushToTalkListeningCaption
        }
    }

    func parseRecordingElapsed(_ partial: String) -> String? {
        guard partial.hasPrefix("录音中") else { return nil }
        guard let range = partial.range(of: #"(\d+(?:\.\d+)?)s"#, options: .regularExpression) else {
            return nil
        }
        return String(partial[range])
    }

    func normalizeVoicePreview(_ partial: String) -> String {
        partial
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - PCM Audio Frame Encoding

func encodePcmAudioFrame(pcm16: Data, sampleRate: Int) -> Data {
    var frame = Data([0x52, 0x41, 0x55, 0x44, 1, 1, 0, 0])
    var rate = UInt32(max(sampleRate, 1)).littleEndian
    var length = UInt32(pcm16.count).littleEndian
    withUnsafeBytes(of: &rate) { bytes in
        frame.append(contentsOf: bytes)
    }
    withUnsafeBytes(of: &length) { bytes in
        frame.append(contentsOf: bytes)
    }
    frame.append(pcm16)
    return frame
}
