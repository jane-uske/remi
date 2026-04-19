import Combine
import Foundation
import SwiftUI

private enum VoiceCaptureMode {
    case duplex
    case pushToTalk
}

@MainActor
final class RemiChatStore: ObservableObject {
    private static let transcriptMergeWindowMs: Int64 = 2200
    private static let duplexIdleCaption = "Full-duplex on. Speak anytime."
    private static let duplexConnectingCaption = "Connecting voice..."
    private static let pushToTalkListeningCaption = "Listening... release to send"
    private static let pushToTalkResultTimeoutNs: UInt64 = 4_500_000_000
    private static let pushToTalkPartialGraceTimeoutNs: UInt64 = 7_000_000_000
    private static let audioDrainPollNs: UInt64 = 60_000_000
    private static let audioDrainForceStopNs: UInt64 = 420_000_000

    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var connectionPhase: ConnectionPhase = .closed
    @Published private(set) var emotion: String = "neutral"
    @Published private(set) var historyHasMore = false
    @Published private(set) var historyLoadingMore = false
    @Published private(set) var isShowingCachedHistory = false
    @Published private(set) var hasSyncedServerHistory = false
    @Published private(set) var duplexEnabled = false
    @Published private(set) var voiceRecording = false
    @Published private(set) var pushToTalkRecording = false
    @Published private(set) var pushToTalkAwaitingResult = false
    @Published private(set) var voiceStatusCaption = ""
    @Published private(set) var voiceTranscriptPreview = ""
    @Published private(set) var isAwaitingAssistantResponse = false
    @Published private(set) var autoScrollToBottomVersion = 0
    @Published var draft: String = ""

    private var socket: URLSessionWebSocketTask?
    private var shouldReconnect = false
    private var connectTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var keepAliveTask: Task<Void, Never>?
    private var voiceStartTask: Task<Void, Never>?
    private var voiceResultTimeoutTask: Task<Void, Never>?
    private var currentGenerationId: Int?
    private var streamingMessageIdByGeneration: [Int: String] = [:]
    private var historyCursor: HistoryCursor?
    private var historySource: HistorySource = .cache
    private var pendingChatPayloads: [[String: Any]] = []
    private var didSendClientContextForCurrentSocket = false
    private let audioSession = RemiAudioSessionCoordinator()
    private let voiceCapture: RemiVoiceCapture
    private let voicePlayer: RemiVoicePlayer
    private var pendingVoiceStartMode: VoiceCaptureMode?
    private var activeVoiceMode: VoiceCaptureMode?
    private var lastUserTranscriptAtMs: Int64 = 0
    private var lastMeaningfulVoicePartial = ""
    private var acceptingCapturedAudioFrames = false
    private var outboundAudioFrames: [Data] = []
    private var audioFrameSendInFlight = false
    private var pendingDuplexStopAfterDrain = false
    private var audioDrainTask: Task<Void, Never>?
    private var audioDrainForceDeadlineNs: UInt64?
    private var duplexTxFrameCount = 0
    private let authSource: RemiChatAuthSource
    private var cachedMessageBucketKey = RemiChatIdentity.defaultCacheKey

    init(authSource: RemiChatAuthSource) {
        self.authSource = authSource
        voiceCapture = RemiVoiceCapture(audioSession: audioSession)
        voicePlayer = RemiVoicePlayer(audioSession: audioSession)
        voicePlayer.onPlaybackStart = { [weak self] generationId in
            self?.sendPlaybackStart(generationId: generationId)
        }
        voicePlayer.onPlaybackEnd = { [weak self] generationId in
            self?.sendPlaybackEnd(generationId: generationId)
        }
    }

    func start() {
        shouldReconnect = true
        reloadCachedMessagesForCurrentIdentity()
        connect()
    }

    func stop() {
        shouldReconnect = false
        connectTask?.cancel()
        connectTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        keepAliveTask?.cancel()
        keepAliveTask = nil
        cancelPushToTalkResultTimeout()
        stopPushToTalk(sendDuplexStop: false, clearStatus: true)
        stopDuplex(sendDuplexStop: false, keepDesiredState: false)
        resetVoiceStatus()
        clearAssistantResponseWait()
        voicePlayer.stopAll()
        resetOutboundAudioState(dropQueuedFrames: true)
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        connectionPhase = .closed
    }

    func sendDraft() {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        draft = ""
        appendMessage(ChatMessage(role: .user, text: content))
        markAwaitingAssistantResponse()

        let payload: [String: Any] = [
            "type": "chat",
            "content": content,
        ]
        sendChatPayload(payload)
    }

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
            return
        }

        enterDuplexMode()
    }

    private func beginDuplexIfPossible() {
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

    private func stopPushToTalk(sendDuplexStop: Bool, clearStatus: Bool) {
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

    private func stopDuplex(sendDuplexStop: Bool, keepDesiredState: Bool) {
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

    func loadMoreHistory() {
        guard !historyLoadingMore else { return }
        guard historySource == .server else {
            historyHasMore = false
            return
        }
        guard historyHasMore, let historyCursor, historyCursor.isValid else { return }
        historyLoadingMore = true
        sendJSON([
            "type": "history_more",
            "cursor": [
                "id": historyCursor.id,
                "createdAt": historyCursor.createdAt,
            ],
        ])
    }

    func appendSystemError(_ text: String) {
        appendMessage(ChatMessage(role: .error, text: text))
    }

    func restartForIdentityChangeIfNeeded() {
        let nextBucketKey = RemiChatIdentity.activeCacheKey(
            currentUserId: authSource.currentUserId,
            jwtToken: authSource.legacyJwtToken
        )
        guard nextBucketKey != cachedMessageBucketKey else { return }

        let shouldResumeDuplex = duplexEnabled
        stop()
        if shouldResumeDuplex {
            duplexEnabled = true
            voiceStatusCaption = Self.duplexConnectingCaption
        }
        start()
    }

    private func connect() {
        if let connectTask, !connectTask.isCancelled {
            return
        }
        connectTask = Task { [weak self] in
            guard let self else { return }
            await self.performConnect()
            self.connectTask = nil
        }
    }

    private func performConnect() async {
        guard let url = RemiChatConfig.resolvedWebSocketURL() else {
            appendMessage(ChatMessage(role: .error, text: "Invalid WebSocket URL"))
            connectionPhase = .closed
            return
        }
        if let issue = RemiChatConfig.preflightConnectionIssue(for: url) {
            appendMessage(ChatMessage(role: .error, text: issue))
            connectionPhase = .closed
            return
        }

        reconnectTask?.cancel()
        reconnectTask = nil

        var request = URLRequest(url: url)
        let authMode: String
        do {
            if let bearerToken = try await authSource.bearerToken() {
                request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
                authMode = authSource.authRuntimePolicy.clerkEnabled ? "clerk" : "jwt"
            } else if let mobileKey = authSource.mobileDevKey {
                request.setValue(mobileKey, forHTTPHeaderField: "X-Remi-Mobile-Key")
                authMode = "mobile_dev_key"
            } else {
                authMode = "none"
            }
        } catch {
            appendMessage(ChatMessage(role: .error, text: "Unable to fetch auth token: \(error.localizedDescription)"))
            connectionPhase = .closed
            return
        }
        log("ws connect url=\(redactedWebSocketURL(url)) auth=\(authMode)")

        connectionPhase = .connecting
        didSendClientContextForCurrentSocket = false
        let task = URLSession.shared.webSocketTask(with: request)
        socket = task
        task.resume()
        startKeepAlive(for: task)
        receiveLoop()
    }

    private func receiveLoop() {
        guard let socket else { return }
        socket.receive { [weak self] result in
            guard let self else { return }
            Task { @MainActor in
                switch result {
                case .failure(let error):
                    self.handleSocketFailure(error)
                case .success(let message):
                    self.consume(message)
                    self.receiveLoop()
                }
            }
        }
    }

    private func consume(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            consumeServerText(text)
        case .data(let data):
            guard let text = String(data: data, encoding: .utf8) else { return }
            consumeServerText(text)
        @unknown default:
            break
        }
    }

    private func consumeServerText(_ text: String) {
        if connectionPhase != .open {
            connectionPhase = .open
            log("ws open")
            sendClientContextIfNeeded()
            flushPendingChatPayloads()
            beginDuplexIfPossible()
        }
        guard let message = RemiServerWireMessageParser.parse(text) else {
            log("server raw text (unparsed) \(text.prefix(160))")
            return
        }

        consumeServerMessage(message)
    }

    private func consumeServerMessage(_ message: RemiServerWireMessage) {
        switch message {
        case .chatChunk(let chunk, let generationId):
            guard !chunk.isEmpty else { return }
            log("server chat_chunk gen=\(generationId.map(String.init) ?? "nil") chars=\(chunk.count)")
            clearAssistantResponseWait()
            appendAssistantChunk(chunk, generationId: generationId)

        case .chatEnd(let fullContent, let generationId):
            log("server chat_end gen=\(generationId.map(String.init) ?? "nil") chars=\(fullContent?.count ?? 0)")
            clearAssistantResponseWait()
            finalizeAssistantMessage(generationId: generationId, fullContent: fullContent)

        case .emotion(let nextEmotion):
            emotion = nextEmotion

        case .voice(let audio, let generationId):
            log("server voice gen=\(generationId.map(String.init) ?? "nil") bytes=\(audio.count)")
            clearAssistantResponseWait()
            voicePlayer.enqueue(base64Audio: audio, generationId: generationId)

        case .voicePcmChunk(let audio, let sampleRate, let channels, let bitsPerSample, let generationId):
            log("server voice_pcm_chunk gen=\(generationId.map(String.init) ?? "nil") sr=\(sampleRate) ch=\(channels) bits=\(bitsPerSample) bytes=\(audio.count)")
            clearAssistantResponseWait()
            voicePlayer.enqueuePcmChunk(
                base64Audio: audio,
                sampleRate: sampleRate,
                channels: channels,
                bitsPerSample: bitsPerSample,
                generationId: generationId
            )

        case .vadStart:
            log("server vad_start")
            if duplexEnabled {
                voiceStatusCaption = "Listening..."
            }

        case .vadEnd:
            log("server vad_end")
            if duplexEnabled {
                voiceStatusCaption = "Heard you..."
            }

        case .sttPartial(let partial):
            let partial = partial.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !partial.isEmpty else { return }
            log("server stt_partial \(partial)")
            if let elapsed = parseRecordingElapsed(partial) {
                if pushToTalkRecording {
                    updateVoiceListeningCaption(elapsed: elapsed)
                }
            } else {
                let normalized = normalizeVoicePreview(partial)
                lastMeaningfulVoicePartial = normalized
                voiceTranscriptPreview = normalized
                if duplexEnabled {
                    voiceStatusCaption = "Listening..."
                } else if pushToTalkRecording {
                    voiceStatusCaption = Self.pushToTalkListeningCaption
                } else if pushToTalkAwaitingResult {
                    voiceStatusCaption = "Transcribing..."
                    armPushToTalkResultTimeout(nanoseconds: Self.pushToTalkPartialGraceTimeoutNs)
                }
            }

        case .sttFinal(let transcript):
            let transcript = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            log("server stt_final \(transcript)")
            cancelPushToTalkResultTimeout()
            if duplexEnabled {
                lastMeaningfulVoicePartial = ""
                voiceTranscriptPreview = ""
                voiceStatusCaption = Self.duplexIdleCaption
            } else {
                resetVoiceStatus()
            }
            appendUserTranscript(transcript)
            if !transcript.isEmpty {
                markAwaitingAssistantResponse()
            }

        case .interrupt:
            log("server interrupt")
            voicePlayer.stopAll()
            if duplexEnabled {
                voiceStatusCaption = Self.duplexIdleCaption
            }

        case .historyPage(let page):
            consumeHistoryPage(page)

        case .error(let content):
            log("server error \(content)")
            historyLoadingMore = false
            cancelPushToTalkResultTimeout()
            if duplexEnabled {
                voiceTranscriptPreview = ""
                lastMeaningfulVoicePartial = ""
                voiceStatusCaption = connectionPhase == .open
                    ? Self.duplexIdleCaption
                    : Self.duplexConnectingCaption
            } else {
                resetVoiceStatus()
            }
            clearAssistantResponseWait()
            appendMessage(ChatMessage(role: .error, text: content))

        default:
            break
        }
    }

    private func sendChatPayload(_ payload: [String: Any]) {
        if connectionPhase == .open, socket != nil {
            sendJSON(payload, queueOnFailure: true)
            return
        }
        pendingChatPayloads.append(payload)
        if connectionPhase != .connecting {
            connect()
        }
    }

    private func flushPendingChatPayloads() {
        guard connectionPhase == .open, socket != nil, !pendingChatPayloads.isEmpty else { return }
        let queued = pendingChatPayloads
        pendingChatPayloads.removeAll()
        for payload in queued {
            sendJSON(payload, queueOnFailure: true)
        }
    }

    private func startKeepAlive(for task: URLSessionWebSocketTask) {
        keepAliveTask?.cancel()
        keepAliveTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(15 * 1_000_000_000))
                guard let self else { return }
                guard self.shouldReconnect else { return }
                guard self.socket === task else { return }
                task.sendPing { [weak self] error in
                    guard let self else { return }
                    if let error {
                        Task { @MainActor in
                            self.handleSocketFailure(error)
                        }
                    } else {
                        Task { @MainActor in
                            if self.connectionPhase != .open {
                                self.connectionPhase = .open
                                self.log("ws open via ping")
                                self.flushPendingChatPayloads()
                                self.beginDuplexIfPossible()
                            }
                        }
                    }
                }
            }
        }
    }

    private func sendPcmFrame(_ pcm16: Data, sampleRate: Int) {
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

    private func sendPlaybackStart(generationId: Int?) {
        guard connectionPhase == .open, socket != nil else { return }
        var payload: [String: Any] = ["type": "playback_start"]
        if let generationId {
            payload["generationId"] = generationId
        }
        sendVolatileJSON(payload)
    }

    private func sendPlaybackEnd(generationId: Int?) {
        guard connectionPhase == .open, socket != nil else { return }
        var payload: [String: Any] = ["type": "playback_end"]
        if let generationId {
            payload["generationId"] = generationId
        }
        sendVolatileJSON(payload)
    }

    private func consumeHistoryPage(_ page: RemiServerHistoryPage) {
        let pageMessages = page.messages.map(\.chatMessage)
        let shouldAdoptServerHistory = page.mode == .prepend || !pageMessages.isEmpty || messages.isEmpty

        if shouldAdoptServerHistory {
            historySource = .server
            historyCursor = page.nextCursor?.isValid == true ? page.nextCursor : nil
            historyHasMore = page.hasMore
            hasSyncedServerHistory = true
            isShowingCachedHistory = false
        }
        historyLoadingMore = false

        switch page.mode {
        case .replace:
            guard shouldAdoptServerHistory else { return }
            messages = deduplicatedMessages(from: pageMessages)
            trimMessages()
            persistMessages()
            requestAutoScrollToBottom()
        case .prepend:
            guard !pageMessages.isEmpty else { return }
            messages = prependOlderMessages(pageMessages, into: messages)
            trimMessages()
            persistMessages()
        }
    }

    private func appendAssistantChunk(_ chunk: String, generationId: Int?) {
        if let generationId {
            if let current = currentGenerationId, current != generationId {
                streamingMessageIdByGeneration.removeAll()
            }
            currentGenerationId = generationId
            if let messageId = streamingMessageIdByGeneration[generationId],
               let index = messages.firstIndex(where: { $0.id == messageId }) {
                messages[index].text += chunk
                persistMessages()
                return
            }

            let message = ChatMessage(role: .remi, text: chunk)
            messages.append(message)
            trimMessages()
            streamingMessageIdByGeneration[generationId] = message.id
            persistMessages()
            requestAutoScrollToBottom()
            return
        }

        if let index = messages.lastIndex(where: { $0.role == .remi }) {
            messages[index].text += chunk
        } else {
            let message = ChatMessage(role: .remi, text: chunk)
            messages.append(message)
            trimMessages()
            requestAutoScrollToBottom()
        }
        persistMessages()
    }

    private func finalizeAssistantMessage(generationId: Int?, fullContent: String?) {
        if let generationId {
            if let messageId = streamingMessageIdByGeneration[generationId],
               let index = messages.firstIndex(where: { $0.id == messageId }) {
                if let fullContent, !fullContent.isEmpty {
                    messages[index].text = fullContent
                }
                streamingMessageIdByGeneration.removeValue(forKey: generationId)
                currentGenerationId = nil
                persistMessages()
                return
            }

            if let fullContent, !fullContent.isEmpty {
                appendMessage(ChatMessage(role: .remi, text: fullContent))
            }
            currentGenerationId = nil
            streamingMessageIdByGeneration.removeValue(forKey: generationId)
            return
        }

        if let fullContent, !fullContent.isEmpty {
            if let index = messages.lastIndex(where: { $0.role == .remi }) {
                messages[index].text = fullContent
                persistMessages()
            } else {
                appendMessage(ChatMessage(role: .remi, text: fullContent))
            }
        }
    }

    private func sendJSON(_ payload: [String: Any], queueOnFailure: Bool = false) {
        guard let socket else {
            if queueOnFailure {
                pendingChatPayloads.append(payload)
                if connectionPhase != .connecting {
                    connect()
                }
            } else {
                appendMessage(ChatMessage(role: .error, text: "Not connected"))
            }
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else {
            appendMessage(ChatMessage(role: .error, text: "Encode failed"))
            return
        }
        logPayload("send", payload)

        socket.send(.string(text)) { [weak self] error in
            guard let self else { return }
            if let error {
                Task { @MainActor in
                    if queueOnFailure {
                        self.pendingChatPayloads.append(payload)
                        self.handleSocketFailure(error)
                    } else {
                        self.appendMessage(ChatMessage(role: .error, text: "Send failed: \(error.localizedDescription)"))
                    }
                }
            }
        }
    }

    private func sendVolatileJSON(_ payload: [String: Any]) {
        guard let socket else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else {
            return
        }
        logPayload("send", payload)

        socket.send(.string(text)) { [weak self] error in
            guard let self, let error else { return }
            Task { @MainActor in
                self.handleSocketFailure(error)
            }
        }
    }

    private func sendClientContextIfNeeded() {
        guard !didSendClientContextForCurrentSocket else { return }
        didSendClientContextForCurrentSocket = true

        sendJSON(RemiChatConfig.buildClientContextPayload(), queueOnFailure: true)
    }

    private func handleSocketFailure(_ error: Error) {
        if socket == nil && connectionPhase == .closed {
            return
        }
        connectionPhase = .closed
        didSendClientContextForCurrentSocket = false
        resetOutboundAudioState(dropQueuedFrames: true)
        cancelPushToTalkResultTimeout()
        stopPushToTalk(sendDuplexStop: false, clearStatus: !duplexEnabled)
        stopDuplex(sendDuplexStop: false, keepDesiredState: duplexEnabled)
        if duplexEnabled {
            voiceStatusCaption = Self.duplexConnectingCaption
        } else {
            resetVoiceStatus()
        }
        clearAssistantResponseWait()
        voicePlayer.stopAll()
        appendMessage(ChatMessage(role: .sys, text: connectionFailureMessage(for: error)))
        keepAliveTask?.cancel()
        keepAliveTask = nil
        socket = nil

        guard shouldReconnect else { return }
        reconnectTask?.cancel()
        reconnectTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(RemiChatConfig.reconnectDelaySeconds * 1_000_000_000))
            guard let self else { return }
            guard self.shouldReconnect else { return }
            self.connect()
        }
        log("ws failure: \(error.localizedDescription)")
    }

    private func logPayload(_ direction: String, _ payload: [String: Any]) {
        guard let type = payload["type"] as? String else { return }
        switch type {
        case "client_context":
            log("\(direction) client_context")
        case "duplex_start":
            log("\(direction) duplex_start mode=\(payload["mode"] ?? "nil") sampleRate=\(payload["sampleRate"] ?? "nil")")
        case "duplex_stop":
            log("\(direction) duplex_stop frames=\(duplexTxFrameCount)")
        case "playback_start":
            log("\(direction) playback_start gen=\(payload["generationId"] ?? "nil")")
        case "playback_end":
            log("\(direction) playback_end gen=\(payload["generationId"] ?? "nil")")
        default:
            break
        }
    }

    private func connectionFailureMessage(for error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorTimedOut {
            if let host = URL(string: RemiChatConfig.wsURLString)?.host, !host.isEmpty {
                return "Connection to \(host) timed out. Check that your iPhone and Mac are on the same Wi-Fi, macOS firewall allows port 3000, and the router is not blocking device-to-device traffic. Retrying..."
            }
            return "Connection timed out. Check same Wi-Fi, macOS firewall, and LAN reachability to port 3000. Retrying..."
        }
        return "Connection lost, retrying..."
    }

    private func appendMessage(_ message: ChatMessage) {
        messages.append(message)
        trimMessages()
        persistMessages()
        requestAutoScrollToBottom()
    }

    private func markAwaitingAssistantResponse() {
        isAwaitingAssistantResponse = true
    }

    private func clearAssistantResponseWait() {
        isAwaitingAssistantResponse = false
    }

    private func resetVoiceStatus() {
        cancelPushToTalkResultTimeout()
        voiceStatusCaption = ""
        voiceTranscriptPreview = ""
        lastMeaningfulVoicePartial = ""
    }

    private func armPushToTalkResultTimeout() {
        armPushToTalkResultTimeout(nanoseconds: RemiChatStore.pushToTalkResultTimeoutNs)
    }

    private func armPushToTalkResultTimeout(nanoseconds: UInt64) {
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

    private func cancelPushToTalkResultTimeout() {
        voiceResultTimeoutTask?.cancel()
        voiceResultTimeoutTask = nil
        pushToTalkAwaitingResult = false
    }

    private func handlePushToTalkResultTimeout() {
        guard pushToTalkAwaitingResult else { return }
        pushToTalkAwaitingResult = false
        voiceResultTimeoutTask = nil
        if voiceTranscriptPreview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            voiceTranscriptPreview = lastMeaningfulVoicePartial
        }
        voiceStatusCaption = "No transcript came back. Hold to try again."
        appendMessage(ChatMessage(role: .error, text: "Voice input timed out before a transcript arrived. Hold to try again."))
    }

    private func updateVoiceListeningCaption(elapsed: String? = nil) {
        if let elapsed, !elapsed.isEmpty {
            voiceStatusCaption = "Listening... \(elapsed)"
        } else {
            voiceStatusCaption = Self.pushToTalkListeningCaption
        }
    }

    private func parseRecordingElapsed(_ partial: String) -> String? {
        guard partial.hasPrefix("录音中") else { return nil }
        guard let range = partial.range(of: #"(\d+(?:\.\d+)?)s"#, options: .regularExpression) else {
            return nil
        }
        return String(partial[range])
    }

    private func normalizeVoicePreview(_ partial: String) -> String {
        partial
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func appendUserTranscript(_ content: String) {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000)

        if let index = messages.indices.last,
           messages[index].role == .user,
           now - lastUserTranscriptAtMs <= Self.transcriptMergeWindowMs,
           let merged = mergeTranscript(messages[index].text, trimmed) {
            messages[index].text = merged
        } else {
            messages.append(ChatMessage(role: .user, text: trimmed, createdAtMs: now))
            requestAutoScrollToBottom()
        }

        lastUserTranscriptAtMs = now
        trimMessages()
        persistMessages()
    }

    private func mergeTranscript(_ previous: String, _ next: String) -> String? {
        let a = previous.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = next.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !a.isEmpty, !b.isEmpty else { return nil }
        if a == b { return a }

        let normalizedA = normalizeTranscript(a)
        let normalizedB = normalizeTranscript(b)
        guard !normalizedA.isEmpty, !normalizedB.isEmpty else { return nil }

        if normalizedA == normalizedB { return b.count >= a.count ? b : a }
        if normalizedB.hasPrefix(normalizedA) { return b }
        if normalizedA.hasPrefix(normalizedB) { return a }
        return nil
    }

    private func normalizeTranscript(_ text: String) -> String {
        text
            .replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
            .replacingOccurrences(of: "[，。！？,.!?、；;:“”\"'`~·\\-]", with: "", options: .regularExpression)
    }

    private func trimMessages() {
        if messages.count > RemiChatConfig.messageCacheLimit {
            messages = Array(messages.suffix(RemiChatConfig.messageCacheLimit))
        }
    }

    private func persistMessages() {
        guard let data = try? JSONEncoder().encode(messages) else { return }
        UserDefaults.standard.set(data, forKey: cachedMessageBucketKey)
    }

    private func loadCachedMessages() {
        guard let data = UserDefaults.standard.data(forKey: cachedMessageBucketKey),
              let cached = try? JSONDecoder().decode([ChatMessage].self, from: data) else {
            return
        }
        messages = Array(cached.suffix(RemiChatConfig.messageCacheLimit))
        historyHasMore = false
        historySource = .cache
        isShowingCachedHistory = !messages.isEmpty
    }

    private func reloadCachedMessagesForCurrentIdentity() {
        cachedMessageBucketKey = RemiChatIdentity.activeCacheKey(
            currentUserId: authSource.currentUserId,
            jwtToken: authSource.legacyJwtToken
        )

        messages = []
        historyCursor = nil
        historyHasMore = false
        historyLoadingMore = false
        historySource = .cache
        isShowingCachedHistory = false

        loadCachedMessages()
    }

    private func deduplicatedMessages(from messages: [ChatMessage]) -> [ChatMessage] {
        var seenIds = Set<String>()
        return messages.filter { message in
            seenIds.insert(message.id).inserted
        }
    }

    private func prependOlderMessages(_ olderMessages: [ChatMessage], into currentMessages: [ChatMessage]) -> [ChatMessage] {
        let seenIds = Set(currentMessages.map(\.id))
        let uniqueOlderMessages = olderMessages.filter { !seenIds.contains($0.id) }
        guard !uniqueOlderMessages.isEmpty else { return currentMessages }
        return uniqueOlderMessages + currentMessages
    }

    private func requestAutoScrollToBottom() {
        autoScrollToBottomVersion &+= 1
    }

    private func log(_ message: String) {
        #if DEBUG
        print("[RemiChatLite] \(message)")
        #endif
    }

    private func redactedWebSocketURL(_ url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        components.queryItems = components.queryItems?.map { item in
            guard item.name == "token" else { return item }
            return URLQueryItem(name: item.name, value: "<redacted>")
        }
        return components.string ?? url.absoluteString
    }

    private func drainOutboundAudioFramesIfNeeded() {
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

    private func requestDuplexStopAfterAudioDrain() {
        pendingDuplexStopAfterDrain = true
        audioDrainForceDeadlineNs = DispatchTime.now().uptimeNanoseconds + Self.audioDrainForceStopNs
        scheduleDuplexStopDrainPoll()
    }

    private func scheduleDuplexStopDrainPoll() {
        audioDrainTask?.cancel()
        audioDrainTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.audioDrainPollNs)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.pollPendingDuplexStopAfterDrain()
            }
        }
    }

    private func pollPendingDuplexStopAfterDrain() {
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

    private func finalizePendingDuplexStopAfterDrain(force: Bool) {
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

    private func resetOutboundAudioState(dropQueuedFrames: Bool) {
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
}

private enum HistorySource {
    case cache
    case server
}

private func encodePcmAudioFrame(pcm16: Data, sampleRate: Int) -> Data {
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
