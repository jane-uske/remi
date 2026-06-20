import Combine
import Foundation
import SwiftUI

@MainActor
final class RemiChatStore: ObservableObject {
    private static let transcriptMergeWindowMs: Int64 = 2200
    static let duplexIdleCaption = "Full-duplex on. Speak anytime."
    static let duplexConnectingCaption = "Connecting voice..."
    static let pushToTalkListeningCaption = "Listening... release to send"
    static let pushToTalkResultTimeoutNs: UInt64 = 4_500_000_000
    static let pushToTalkPartialGraceTimeoutNs: UInt64 = 7_000_000_000
    static let audioDrainPollNs: UInt64 = 60_000_000
    static let audioDrainForceStopNs: UInt64 = 420_000_000

    @Published var messages: [ChatMessage] = []
    @Published var connectionPhase: ConnectionPhase = .closed
    @Published var emotion: String = "neutral"
    @Published var historyHasMore = false
    @Published var historyLoadingMore = false
    @Published var isShowingCachedHistory = false
    @Published var hasSyncedServerHistory = false
    @Published var duplexEnabled = false
    @Published var voiceRecording = false
    @Published var pushToTalkRecording = false
    @Published var pushToTalkAwaitingResult = false
    @Published var voiceStatusCaption = ""
    @Published var voiceTranscriptPreview = ""
    @Published var isAwaitingAssistantResponse = false
    @Published var autoScrollToBottomVersion = 0
    @Published var turnState: RemiTurnState = .listeningActive
    @Published var turnStateReason: String = ""
    @Published var sttPredictionPreview: String = ""
    @Published var activeGenerationId: Int?
    @Published var draft: String = ""
    @Published var nsfwEnabled: Bool = false

    var socket: URLSessionWebSocketTask?
    var shouldReconnect = false
    var connectTask: Task<Void, Never>?
    var reconnectTask: Task<Void, Never>?
    var keepAliveTask: Task<Void, Never>?
    var voiceStartTask: Task<Void, Never>?
    var voiceResultTimeoutTask: Task<Void, Never>?
    private var currentGenerationId: Int?
    private var streamingMessageIdByGeneration: [Int: String] = [:]
    /// Raw assistant text (still carrying inline `<emotion>` markup) keyed by the
    /// streaming message id. Display text is derived from this each chunk so a tag
    /// split across chunk boundaries is never lost or flashed. See [RemiEmotionTag].
    private var rawAssistantTextByMessageId: [String: String] = [:]
    private var historyCursor: HistoryCursor?
    private var historySource: HistorySource = .cache
    var pendingChatPayloads: [[String: Any]] = []
    var didSendClientContextForCurrentSocket = false
    let audioSession = RemiAudioSessionCoordinator()
    let voiceCapture: RemiVoiceCapture
    let voicePlayer: RemiVoicePlayer
    var pendingVoiceStartMode: VoiceCaptureMode?
    var activeVoiceMode: VoiceCaptureMode?
    var lastUserTranscriptAtMs: Int64 = 0
    var lastMeaningfulVoicePartial = ""
    var acceptingCapturedAudioFrames = false
    var outboundAudioFrames: [Data] = []
    var audioFrameSendInFlight = false
    var pendingDuplexStopAfterDrain = false
    var audioDrainTask: Task<Void, Never>?
    var audioDrainForceDeadlineNs: UInt64?
    var duplexTxFrameCount = 0
    let authSource: RemiChatAuthSource
    private var cachedMessageBucketKey = RemiChatIdentity.defaultCacheKey

    /// Viseme-driven mouth animation. Fed by `.ttsLipSync`; sampled per-frame by the renderer.
    let lipSyncEngine = RemiLipSyncEngine()
    /// Schedules avatar emotion beats from `.avatarIntent` onto a timeline.
    private let intentScheduler = RemiAvatarIntentScheduler()

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
        intentScheduler.onEmotionChange = { [weak self] nextEmotion in
            self?.emotion = nextEmotion
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

    func consumeServerMessage(_ message: RemiServerWireMessage) {
        switch message {
        case .chatChunk(let chunk, let generationId):
            guard !chunk.isEmpty else { return }
            log("server chat_chunk gen=\(generationId.map(String.init) ?? "nil") chars=\(chunk.count)")
            clearAssistantResponseWait()
            appendAssistantChunk(chunk, generationId: generationId)

        case .chatEnd(let fullContent, let generationId, let endEmotion):
            log("server chat_end gen=\(generationId.map(String.init) ?? "nil") chars=\(fullContent?.count ?? 0)")
            clearAssistantResponseWait()
            finalizeAssistantMessage(generationId: generationId, fullContent: fullContent)
            if let endEmotion, !endEmotion.isEmpty {
                emotion = endEmotion
            }

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
            sttPredictionPreview = ""
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
            lipSyncEngine.reset()
            intentScheduler.cancelPending()
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

        case .turnState(let state, let reason, let generationId, _, let interruptionType):
            if let parsed = RemiTurnState(rawValue: state) {
                turnState = parsed
                turnStateReason = reason
                if let generationId { activeGenerationId = generationId }
                log("server turn_state \(state) reason=\(reason) gen=\(generationId.map(String.init) ?? "nil") interrupt=\(interruptionType ?? "")")
            }

        case .sttPrediction(_, let preview):
            sttPredictionPreview = preview

        case .avatarFrame(let frameEmotion, _, _):
            if let frameEmotion, !frameEmotion.isEmpty {
                emotion = frameEmotion
            }

        case .avatarIntent(let intentEmotion, let gesture, let gestureIntensity, let energy, let holdMs, let beats):
            intentScheduler.schedule(
                emotion: intentEmotion.isEmpty ? emotion : intentEmotion,
                gesture: gesture,
                gestureIntensity: gestureIntensity,
                energy: energy,
                holdMs: holdMs,
                beats: beats
            )

        case .ttsLipSync(let generationId, _, let mode, let complete, let cues):
            lipSyncEngine.ingestCues(cues, generationId: generationId, mode: mode, complete: complete)

        case .nsfwModeState(let enabled):
            log("server nsfw_mode_state enabled=\(enabled)")
            nsfwEnabled = enabled
        }
    }

    private func consumeHistoryPage(_ page: RemiServerHistoryPage) {
        let pageMessages = sanitizingAssistantTags(page.messages.map(\.chatMessage))
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
                // Previous stream abandoned — drop its raw buffers too.
                for id in streamingMessageIdByGeneration.values {
                    rawAssistantTextByMessageId.removeValue(forKey: id)
                }
                streamingMessageIdByGeneration.removeAll()
            }
            currentGenerationId = generationId
            if let messageId = streamingMessageIdByGeneration[generationId],
               let index = messages.firstIndex(where: { $0.id == messageId }) {
                let raw = (rawAssistantTextByMessageId[messageId] ?? messages[index].text) + chunk
                rawAssistantTextByMessageId[messageId] = raw
                messages[index].text = strippedDisplayText(forRaw: raw)
                persistMessages()
                return
            }

            let message = ChatMessage(role: .remi, text: strippedDisplayText(forRaw: chunk))
            messages.append(message)
            trimMessages()
            streamingMessageIdByGeneration[generationId] = message.id
            rawAssistantTextByMessageId[message.id] = chunk
            persistMessages()
            requestAutoScrollToBottom()
            return
        }

        if let index = messages.lastIndex(where: { $0.role == .remi }) {
            let messageId = messages[index].id
            let raw = (rawAssistantTextByMessageId[messageId] ?? messages[index].text) + chunk
            rawAssistantTextByMessageId[messageId] = raw
            messages[index].text = strippedDisplayText(forRaw: raw)
        } else {
            let message = ChatMessage(role: .remi, text: strippedDisplayText(forRaw: chunk))
            messages.append(message)
            trimMessages()
            rawAssistantTextByMessageId[message.id] = chunk
            requestAutoScrollToBottom()
        }
        persistMessages()
    }

    private func finalizeAssistantMessage(generationId: Int?, fullContent: String?) {
        if let generationId {
            if let messageId = streamingMessageIdByGeneration[generationId],
               let index = messages.firstIndex(where: { $0.id == messageId }) {
                let raw = nonEmpty(fullContent)
                    ?? rawAssistantTextByMessageId[messageId]
                    ?? messages[index].text
                applyParsedEmotionFallback(fromRaw: raw)
                messages[index].text = strippedDisplayText(forRaw: raw, declaredEmotion: emotion)
                rawAssistantTextByMessageId.removeValue(forKey: messageId)
                streamingMessageIdByGeneration.removeValue(forKey: generationId)
                currentGenerationId = nil
                persistMessages()
                return
            }

            if let raw = nonEmpty(fullContent) {
                applyParsedEmotionFallback(fromRaw: raw)
                appendMessage(ChatMessage(role: .remi, text: strippedDisplayText(forRaw: raw, declaredEmotion: emotion)))
            }
            currentGenerationId = nil
            streamingMessageIdByGeneration.removeValue(forKey: generationId)
            return
        }

        if let index = messages.lastIndex(where: { $0.role == .remi }) {
            let messageId = messages[index].id
            let raw = nonEmpty(fullContent) ?? rawAssistantTextByMessageId[messageId]
            if let raw {
                applyParsedEmotionFallback(fromRaw: raw)
                messages[index].text = strippedDisplayText(forRaw: raw, declaredEmotion: emotion)
                rawAssistantTextByMessageId.removeValue(forKey: messageId)
                persistMessages()
            }
        } else if let raw = nonEmpty(fullContent) {
            applyParsedEmotionFallback(fromRaw: raw)
            appendMessage(ChatMessage(role: .remi, text: strippedDisplayText(forRaw: raw, declaredEmotion: emotion)))
        }
    }

    /// Display text for an assistant message, with inline `<emotion>` markup
    /// stripped. The trailing bare emotion word is removed only when it provably
    /// came from a closed tag (`declaredEmotion == nil`, the streaming case) or
    /// matches the emotion the server declared for this turn (the finalize case).
    private func strippedDisplayText(forRaw raw: String, declaredEmotion: String? = nil) -> String {
        let word = RemiEmotionTag.detectEmotion(in: raw) ?? declaredEmotion
        return RemiEmotionTag.clean(raw, trailingEmotionWord: word)
    }

    /// Drive the avatar from the inline tag when one is present. The server's
    /// explicit emotion (applied by the `.chatEnd` / `.emotion` handlers) still
    /// wins, since those run after — this is only a fallback.
    private func applyParsedEmotionFallback(fromRaw raw: String) {
        if let detected = RemiEmotionTag.detectEmotion(in: raw) {
            emotion = detected
        }
    }

    private func nonEmpty(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }

    /// Defensive cleanup for history/cache: strip any inline emotion markup that a
    /// non-stripping code path (or a pre-fix cache entry) may have persisted, so
    /// the tag never resurfaces on reload. Only assistant messages are touched.
    private func sanitizingAssistantTags(_ messages: [ChatMessage]) -> [ChatMessage] {
        messages.map { message in
            guard message.role == .remi else { return message }
            let cleaned = strippedDisplayText(forRaw: message.text)
            guard cleaned != message.text else { return message }
            var sanitized = message
            sanitized.text = cleaned
            return sanitized
        }
    }

    func appendMessage(_ message: ChatMessage) {
        messages.append(message)
        trimMessages()
        persistMessages()
        requestAutoScrollToBottom()
    }

    func markAwaitingAssistantResponse() {
        isAwaitingAssistantResponse = true
    }

    func clearAssistantResponseWait() {
        isAwaitingAssistantResponse = false
    }

    func appendUserTranscript(_ content: String) {
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
        messages = sanitizingAssistantTags(Array(cached.suffix(RemiChatConfig.messageCacheLimit)))
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

    func log(_ message: String) {
        #if DEBUG
        print("[RemiChatLite] \(message)")
        #endif
    }

}

private enum HistorySource {
    case cache
    case server
}
