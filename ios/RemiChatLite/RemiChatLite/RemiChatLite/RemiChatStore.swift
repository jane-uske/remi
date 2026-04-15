import Combine
import Foundation
import SwiftUI

@MainActor
final class RemiChatStore: ObservableObject {
    private static let transcriptMergeWindowMs: Int64 = 2200

    @Published private(set) var messages: [ChatMessage] = []
    @Published private(set) var connectionPhase: ConnectionPhase = .closed
    @Published private(set) var emotion: String = "neutral"
    @Published private(set) var historyHasMore = false
    @Published private(set) var historyLoadingMore = false
    @Published private(set) var isShowingCachedHistory = false
    @Published private(set) var hasSyncedServerHistory = false
    @Published private(set) var voiceRecording = false
    @Published private(set) var voiceStatusCaption = ""
    @Published private(set) var voiceTranscriptPreview = ""
    @Published var draft: String = ""

    private var socket: URLSessionWebSocketTask?
    private var shouldReconnect = false
    private var reconnectTask: Task<Void, Never>?
    private var keepAliveTask: Task<Void, Never>?
    private var voiceStartTask: Task<Void, Never>?
    private var currentGenerationId: Int?
    private var streamingMessageIdByGeneration: [Int: String] = [:]
    private var historyCursor: HistoryCursor?
    private var historySource: HistorySource = .cache
    private var pendingChatPayloads: [[String: Any]] = []
    private let voiceCapture = RemiVoiceCapture()
    private let voicePlayer = RemiVoicePlayer()
    private var lastUserTranscriptAtMs: Int64 = 0
    private var lastMeaningfulVoicePartial = ""

    init() {
        voicePlayer.onPlaybackStart = { [weak self] generationId in
            self?.sendPlaybackStart(generationId: generationId)
        }
        loadCachedMessages()
    }

    func start() {
        shouldReconnect = true
        connect()
    }

    func stop() {
        shouldReconnect = false
        reconnectTask?.cancel()
        reconnectTask = nil
        keepAliveTask?.cancel()
        keepAliveTask = nil
        voiceStartTask?.cancel()
        voiceStartTask = nil
        stopPushToTalk(sendDuplexStop: false)
        resetVoiceStatus()
        voicePlayer.stopAll()
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        connectionPhase = .closed
    }

    func sendDraft() {
        let content = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        draft = ""
        appendMessage(ChatMessage(role: .user, text: content))

        let payload: [String: Any] = [
            "type": "chat",
            "content": content,
        ]
        sendChatPayload(payload)
    }

    func beginPushToTalk() {
        guard !voiceRecording, voiceStartTask == nil else { return }
        guard connectionPhase == .open, socket != nil else {
            appendMessage(ChatMessage(role: .sys, text: "Connection is not ready for voice yet. Give it a second and try again."))
            if connectionPhase != .connecting {
                connect()
            }
            return
        }

        voicePlayer.stopAll()
        lastMeaningfulVoicePartial = ""
        voiceTranscriptPreview = ""
        updateVoiceListeningCaption()

        voiceStartTask = Task { [weak self] in
            guard let self else { return }
            do {
                let sampleRate = try await self.voiceCapture.start { [weak self] pcm, frameSampleRate in
                    Task { @MainActor [weak self] in
                        self?.sendPcmFrame(pcm, sampleRate: frameSampleRate)
                    }
                }
                if Task.isCancelled {
                    self.voiceCapture.stop()
                    self.resetVoiceStatus()
                    self.voiceStartTask = nil
                    return
                }
                self.voiceRecording = true
                self.voiceStartTask = nil
                self.sendJSON([
                    "type": "duplex_start",
                    "sampleRate": sampleRate,
                ])
            } catch {
                self.voiceStartTask = nil
                self.voiceRecording = false
                self.resetVoiceStatus()
                self.appendMessage(ChatMessage(role: .error, text: error.localizedDescription))
            }
        }
    }

    func endPushToTalk() {
        if let voiceStartTask {
            voiceStartTask.cancel()
            self.voiceStartTask = nil
            resetVoiceStatus()
            return
        }
        guard voiceRecording else { return }
        stopPushToTalk(sendDuplexStop: true)
        voiceStatusCaption = "Transcribing..."
        voiceTranscriptPreview = lastMeaningfulVoicePartial
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

    private func connect() {
        guard let url = URL(string: RemiChatConfig.wsURLString) else {
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
        if let jwt = RemiChatConfig.jwtToken {
            request.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        } else if let mobileKey = RemiChatConfig.mobileDevKey {
            request.setValue(mobileKey, forHTTPHeaderField: "X-Remi-Mobile-Key")
        }

        connectionPhase = .connecting
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
            flushPendingChatPayloads()
        }
        guard let data = text.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = payload["type"] as? String else {
            return
        }

        switch type {
        case "chat_chunk":
            let chunk = payload["content"] as? String ?? ""
            guard !chunk.isEmpty else { return }
            let generationId = intValue(payload["generationId"])
            appendAssistantChunk(chunk, generationId: generationId)

        case "chat_end":
            let generationId = intValue(payload["generationId"])
            let fullContent = payload["content"] as? String
            finalizeAssistantMessage(generationId: generationId, fullContent: fullContent)

        case "emotion":
            if let nextEmotion = payload["emotion"] as? String {
                emotion = nextEmotion
            }

        case "voice":
            if let audio = payload["audio"] as? String {
                voicePlayer.enqueue(base64Audio: audio, generationId: intValue(payload["generationId"]))
            }

        case "stt_partial":
            let partial = (payload["content"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !partial.isEmpty else { return }
            if let elapsed = parseRecordingElapsed(partial) {
                updateVoiceListeningCaption(elapsed: elapsed)
            } else {
                let normalized = normalizeVoicePreview(partial)
                lastMeaningfulVoicePartial = normalized
                voiceTranscriptPreview = normalized
                if voiceRecording {
                    voiceStatusCaption = "Listening... release to send"
                }
            }

        case "stt_final":
            let transcript = (payload["content"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            resetVoiceStatus()
            appendUserTranscript(transcript)

        case "interrupt":
            voicePlayer.stopAll()

        case "history_page":
            consumeHistoryPage(payload)

        case "error":
            let content = payload["content"] as? String ?? "Server error"
            historyLoadingMore = false
            resetVoiceStatus()
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
                                self.flushPendingChatPayloads()
                            }
                        }
                    }
                }
            }
        }
    }

    private func stopPushToTalk(sendDuplexStop: Bool) {
        voiceCapture.stop()
        voiceRecording = false
        if sendDuplexStop, socket != nil {
            sendJSON(["type": "duplex_stop"])
        }
    }

    private func sendPcmFrame(_ pcm16: Data, sampleRate: Int) {
        guard voiceRecording, let socket else { return }
        let frame = encodePcmAudioFrame(pcm16: pcm16, sampleRate: sampleRate)
        socket.send(.data(frame)) { [weak self] error in
            guard let self, let error else { return }
            Task { @MainActor in
                self.handleSocketFailure(error)
            }
        }
    }

    private func sendPlaybackStart(generationId: Int?) {
        guard connectionPhase == .open, socket != nil else { return }
        var payload: [String: Any] = ["type": "playback_start"]
        if let generationId {
            payload["generationId"] = generationId
        }
        sendJSON(payload)
    }

    private func consumeHistoryPage(_ payload: [String: Any]) {
        let mode = (payload["mode"] as? String) == "prepend" ? HistoryMode.prepend : .replace
        let rawMessages = payload["messages"] as? [[String: Any]] ?? []
        let pageMessages = rawMessages.compactMap(HistoryPageMessage.init(payload:)).map(\.chatMessage)
        let cursor = HistoryCursor(payload: payload["nextCursor"])
        let shouldAdoptServerHistory = mode == .prepend || !pageMessages.isEmpty || messages.isEmpty

        if shouldAdoptServerHistory {
            historySource = .server
            historyCursor = cursor?.isValid == true ? cursor : nil
            historyHasMore = payload["hasMore"] as? Bool ?? false
            hasSyncedServerHistory = true
            isShowingCachedHistory = false
        }
        historyLoadingMore = false

        switch mode {
        case .replace:
            guard shouldAdoptServerHistory else { return }
            messages = deduplicatedMessages(from: pageMessages)
            trimMessages()
            persistMessages()
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
            return
        }

        if let index = messages.lastIndex(where: { $0.role == .remi }) {
            messages[index].text += chunk
        } else {
            let message = ChatMessage(role: .remi, text: chunk)
            messages.append(message)
            trimMessages()
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

    private func handleSocketFailure(_ error: Error) {
        if socket == nil && connectionPhase == .closed {
            return
        }
        connectionPhase = .closed
        voiceStartTask?.cancel()
        voiceStartTask = nil
        stopPushToTalk(sendDuplexStop: false)
        resetVoiceStatus()
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
    }

    private func resetVoiceStatus() {
        voiceStatusCaption = ""
        voiceTranscriptPreview = ""
        lastMeaningfulVoicePartial = ""
    }

    private func updateVoiceListeningCaption(elapsed: String? = nil) {
        if let elapsed, !elapsed.isEmpty {
            voiceStatusCaption = "Listening... \(elapsed)"
        } else {
            voiceStatusCaption = "Listening... release to send"
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
        UserDefaults.standard.set(data, forKey: RemiChatIdentity.activeCacheKey(jwtToken: RemiChatConfig.jwtToken))
    }

    private func loadCachedMessages() {
        guard let data = UserDefaults.standard.data(forKey: RemiChatIdentity.activeCacheKey(jwtToken: RemiChatConfig.jwtToken)),
              let cached = try? JSONDecoder().decode([ChatMessage].self, from: data) else {
            return
        }
        messages = Array(cached.suffix(RemiChatConfig.messageCacheLimit))
        historyHasMore = false
        historySource = .cache
        isShowingCachedHistory = !messages.isEmpty
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

    private func intValue(_ value: Any?) -> Int? {
        if let value = value as? Int {
            return value
        }
        if let value = value as? NSNumber {
            return value.intValue
        }
        if let value = value as? String {
            return Int(value)
        }
        return nil
    }

    private func log(_ message: String) {
        #if DEBUG
        print("[RemiChatLite] \(message)")
        #endif
    }
}

private enum HistoryMode {
    case replace
    case prepend
}

private enum HistorySource {
    case cache
    case server
}

private extension HistoryCursor {
    init?(payload: Any?) {
        guard let payload = payload as? [String: Any],
              let id = payload["id"] as? String,
              let createdAt = payload["createdAt"] as? String else {
            return nil
        }
        self.init(id: id, createdAt: createdAt)
    }
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
