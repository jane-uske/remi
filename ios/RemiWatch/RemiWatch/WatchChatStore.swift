import Foundation
import Combine
import os

/// WebSocket chat client for the Remi watch MVP.
///
/// Connection lifecycle mirrors the iOS `RemiChatStore` transport at a much
/// smaller scope: connect -> send `client_context` on open -> send `chat`
/// payloads -> stream `chat_chunk` into a live assistant bubble, finalize on
/// `chat_end`. Auto-reconnects on failure while `shouldReconnect` is set.
@MainActor
final class WatchChatStore: ObservableObject {
    @Published private(set) var messages: [WatchChatMessage] = []
    @Published private(set) var phase: WatchConnectionPhase = .closed
    @Published private(set) var emotion: String = "neutral"
    @Published private(set) var awaitingReply = false
    @Published private(set) var historyHasMore = false
    @Published private(set) var historyLoadingMore = false
    @Published var ttsEnabled = true {
        didSet { voicePlayer.enabled = ttsEnabled }
    }
    @Published private(set) var authMode: WatchAuthMode = .none

    enum WatchAuthMode: String {
        case bearer   // Clerk session token (or legacy JWT)
        case devKey   // local X-Remi-Mobile-Key
        case none     // unauthenticated — relies on gateway loopback bypass

        var isSignedIn: Bool { self == .bearer }
    }

    private var historyCursor: WatchHistoryCursor?
    private let voicePlayer = WatchVoicePlayer()

    private var socket: URLSessionWebSocketTask?
    private var shouldReconnect = false
    private var didSendClientContext = false
    private var reconnectTask: Task<Void, Never>?
    private var keepAliveTask: Task<Void, Never>?
    private var pendingPayloads: [[String: Any]] = []

    /// generationId -> message id, so chunks for the same turn append in place.
    private var streamingMessageByGeneration: [Int: String] = [:]
    /// Fallback bubble when the server omits a generationId.
    private var fallbackStreamingMessageId: String?
    /// Raw (un-stripped) assistant text per bubble. Stripping must run on the
    /// full buffer because a `<emotion>` tag can split across chunk boundaries.
    private var rawTextByMessageId: [String: String] = [:]

    // MARK: - Lifecycle

    private static let log = Logger(subsystem: "run.remi.watch", category: "chat")

    func start() {
        shouldReconnect = true
        connect()
        runAutoSendProbeIfRequested()
    }

    /// Dev-only self-test: when launched with `REMI_WATCH_AUTOSEND=1` (inject via
    /// `SIMCTL_CHILD_REMI_WATCH_AUTOSEND=1` for the simulator), wait for the
    /// socket to open, then send one canned message. Used to verify the full
    /// connect -> stream -> emotion-strip -> bubble path without a UI tap.
    private func runAutoSendProbeIfRequested() {
        guard ProcessInfo.processInfo.environment["REMI_WATCH_AUTOSEND"] == "1" else { return }
        let text = ProcessInfo.processInfo.environment["REMI_WATCH_AUTOSEND_TEXT"]
            ?? "Hi Remi from the watch. Reply in one short line."
        Task { @MainActor [weak self] in
            for _ in 0..<40 where self?.phase != .open {
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
            guard let self else { return }
            Self.log.notice("autosend probe firing: \(text, privacy: .public)")
            self.send(text)
        }
    }

    func stop() {
        shouldReconnect = false
        reconnectTask?.cancel(); reconnectTask = nil
        keepAliveTask?.cancel(); keepAliveTask = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        didSendClientContext = false
        voicePlayer.stopAll()
        phase = .closed
    }

    func send(_ rawText: String) {
        let content = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }
        voicePlayer.stopAll()  // barge-in: cut any TTS still playing from the last turn
        appendMessage(WatchChatMessage(role: .user, text: content))
        awaitingReply = true
        sendPayload(["type": "chat", "content": content])
    }

    // MARK: - Connection

    private func connect() {
        guard socket == nil else { return }
        guard let url = WatchConfig.resolvedWebSocketURL() else {
            appendMessage(WatchChatMessage(role: .system, text: "Invalid WebSocket URL"))
            phase = .closed
            return
        }

        var request = URLRequest(url: url)
        // Auth precedence: Clerk/JWT bearer token > local dev-key > none (loopback bypass).
        if let token = WatchAuth.bearerToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            authMode = .bearer
        } else if let key = WatchConfig.mobileDevKey {
            request.setValue(key, forHTTPHeaderField: "X-Remi-Mobile-Key")
            authMode = .devKey
        } else {
            authMode = .none
        }
        Self.log.notice("ws connect auth=\(self.authMode.rawValue, privacy: .public)")

        phase = .connecting
        didSendClientContext = false
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
                    self.handleFailure(error)
                case .success(let message):
                    self.consume(message)
                    self.receiveLoop()
                }
            }
        }
    }

    private func consume(_ message: URLSessionWebSocketTask.Message) {
        let text: String
        switch message {
        case .string(let s): text = s
        case .data(let d): text = String(data: d, encoding: .utf8) ?? ""
        @unknown default: return
        }
        guard !text.isEmpty else { return }

        if phase != .open {
            phase = .open
            sendClientContextIfNeeded()
            flushPending()
        }

        guard let parsed = WatchServerMessage.parse(text) else { return }
        switch parsed {
        case .chatChunk(let content, let generationId):
            appendChunk(content, generationId: generationId)
        case .chatEnd(let content, let generationId, let emo):
            finalizeStream(content: content, generationId: generationId, declaredEmotion: emo)
            awaitingReply = false
        case .emotion(let emo):
            emotion = emo
        case .voice(let audioBase64, _):
            if let data = Data(base64Encoded: audioBase64) {
                voicePlayer.enqueue(data)
            }
        case .historyPage(let mode, let pageMessages, let cursor, let hasMore):
            applyHistory(mode: mode, pageMessages: pageMessages, cursor: cursor, hasMore: hasMore)
        case .error(let text):
            appendMessage(WatchChatMessage(role: .system, text: text))
            awaitingReply = false
        }
    }

    // MARK: - History

    func loadMoreHistory() {
        guard !historyLoadingMore, historyHasMore, let cursor = historyCursor else { return }
        historyLoadingMore = true
        sendPayload(["type": "history_more", "cursor": ["id": cursor.id, "createdAt": cursor.createdAt]])
    }

    private func applyHistory(
        mode: WatchHistoryMode,
        pageMessages: [WatchHistoryMessage],
        cursor: WatchHistoryCursor?,
        hasMore: Bool
    ) {
        let mapped: [WatchChatMessage] = pageMessages.compactMap { hm in
            let text = hm.role == .remi
                ? displayText(forRaw: hm.text).trimmingCharacters(in: .whitespacesAndNewlines)
                : hm.text
            guard !text.isEmpty else { return nil }
            return WatchChatMessage(id: hm.id, role: hm.role, text: text)
        }
        switch mode {
        case .replace:
            // Server history is the source of truth at connect time. Preserve any
            // locally-appended messages that the page doesn't already contain
            // (e.g. a message the user sent before history arrived).
            let historyIds = Set(mapped.map(\.id))
            let localExtras = messages.filter { $0.role != .system && !historyIds.contains($0.id) }
            messages = mapped + localExtras
        case .prepend:
            let existingIds = Set(messages.map(\.id))
            let older = mapped.filter { !existingIds.contains($0.id) }
            messages.insert(contentsOf: older, at: 0)
        }
        historyCursor = cursor
        historyHasMore = hasMore && cursor != nil
        historyLoadingMore = false
        trim()
        Self.log.notice("history \(String(describing: mode), privacy: .public): +\(mapped.count) -> total \(self.messages.count), hasMore=\(self.historyHasMore)")
    }

    private func handleFailure(_ error: Error) {
        if socket == nil && phase == .closed { return }
        phase = .closed
        didSendClientContext = false
        awaitingReply = false
        historyLoadingMore = false
        keepAliveTask?.cancel(); keepAliveTask = nil
        socket = nil
        streamingMessageByGeneration.removeAll()
        fallbackStreamingMessageId = nil
        rawTextByMessageId.removeAll()

        guard shouldReconnect else { return }
        reconnectTask?.cancel()
        reconnectTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(WatchConfig.reconnectDelaySeconds * 1_000_000_000))
            guard let self, self.shouldReconnect else { return }
            self.connect()
        }
    }

    private func startKeepAlive(for task: URLSessionWebSocketTask) {
        keepAliveTask?.cancel()
        keepAliveTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15 * 1_000_000_000)
                guard let self else { return }
                let alive = await MainActor.run { self.shouldReconnect && self.socket === task }
                guard alive else { return }
                task.sendPing { [weak self] error in
                    guard let self, let error else { return }
                    Task { @MainActor in self.handleFailure(error) }
                }
            }
        }
    }

    // MARK: - Sending

    private func sendPayload(_ payload: [String: Any]) {
        guard phase == .open, let socket else {
            pendingPayloads.append(payload)
            if phase == .closed { connect() }
            return
        }
        write(payload, on: socket)
    }

    private func flushPending() {
        guard phase == .open, let socket, !pendingPayloads.isEmpty else { return }
        let queued = pendingPayloads
        pendingPayloads.removeAll()
        for payload in queued { write(payload, on: socket) }
    }

    private func sendClientContextIfNeeded() {
        guard !didSendClientContext, let socket else { return }
        didSendClientContext = true
        write(WatchConfig.clientContextPayload(), on: socket)
    }

    private func write(_ payload: [String: Any], on socket: URLSessionWebSocketTask) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { [weak self] error in
            guard let self, let error else { return }
            Task { @MainActor in self.handleFailure(error) }
        }
    }

    // MARK: - Message buffer

    private func appendMessage(_ message: WatchChatMessage) {
        messages.append(message)
        trim()
    }

    /// Display text for an assistant buffer: inline `<emotion>` markup removed, plus
    /// the bare trailing emotion word the closed tag leaves behind. The word to
    /// strip is taken from the inline tag itself first (`detectEmotion`), because
    /// the server delivers `chat_end.emotion` out-of-band and it may NOT match the
    /// inline word (e.g. inline `<emotion>playful</emotion>` but `chat_end` says
    /// `neutral`). Falling back to the declared word only when no inline tag exists.
    private func displayText(forRaw raw: String, declaredEmotion: String? = nil) -> String {
        let word = RemiEmotionTag.detectEmotion(in: raw) ?? declaredEmotion
        return RemiEmotionTag.stripTrailingWord(RemiEmotionTag.strip(raw), emotion: word)
    }

    private func appendChunk(_ content: String, generationId: Int?) {
        guard !content.isEmpty else { return }
        let messageId = streamingMessageId(for: generationId)
        let raw = (rawTextByMessageId[messageId] ?? "") + content
        rawTextByMessageId[messageId] = raw
        let display = displayText(forRaw: raw)
        if let idx = messages.firstIndex(where: { $0.id == messageId }) {
            messages[idx].text = display
        } else if !display.isEmpty {
            // Defer creating the bubble until there is visible text, so a leading
            // partial `<emotion…` chunk never flashes an empty bubble.
            messages.append(WatchChatMessage(id: messageId, role: .remi, text: display))
            trim()
        }
        awaitingReply = false
    }

    private func finalizeStream(content: String?, generationId: Int?, declaredEmotion: String?) {
        let messageId = streamingMessageId(for: generationId)
        let raw = (content?.isEmpty == false ? content : rawTextByMessageId[messageId]) ?? ""
        let display = displayText(forRaw: raw, declaredEmotion: declaredEmotion)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !display.isEmpty {
            if let idx = messages.firstIndex(where: { $0.id == messageId }) {
                messages[idx].text = display
            } else {
                messages.append(WatchChatMessage(id: messageId, role: .remi, text: display))
                trim()
            }
        }
        // Avatar/status emotion: prefer the out-of-band declared value, else the inline tag.
        let avatarEmotion = declaredEmotion ?? RemiEmotionTag.detectEmotion(in: raw)
        if let avatarEmotion, !avatarEmotion.isEmpty { emotion = avatarEmotion }
        rawTextByMessageId[messageId] = nil
        if let generationId { streamingMessageByGeneration[generationId] = nil }
        fallbackStreamingMessageId = nil
        Self.log.notice("bubble finalized (display): \(display, privacy: .public) | raw: \(raw, privacy: .public)")
    }

    private func streamingMessageId(for generationId: Int?) -> String {
        if let generationId {
            if let existing = streamingMessageByGeneration[generationId] { return existing }
            let newId = UUID().uuidString
            streamingMessageByGeneration[generationId] = newId
            return newId
        }
        if let fallbackStreamingMessageId { return fallbackStreamingMessageId }
        let newId = UUID().uuidString
        fallbackStreamingMessageId = newId
        return newId
    }

    private func trim() {
        if messages.count > WatchConfig.messageLimit {
            messages.removeFirst(messages.count - WatchConfig.messageLimit)
        }
    }
}
