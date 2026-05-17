import Foundation

// MARK: - WebSocket Transport Layer
//
// Extracted from RemiChatStore (Phase 7).
// To complete the split in Xcode:
//   1. Remove these methods from RemiChatStore.swift
//   2. Change the following properties from `private` to `internal` in RemiChatStore.swift:
//      - socket, shouldReconnect, connectTask, reconnectTask, keepAliveTask
//      - didSendClientContextForCurrentSocket, pendingChatPayloads
//      - authSource, duplexTxFrameCount
//   3. Methods that cross layers (beginDuplexIfPossible, resetOutboundAudioState, etc.)
//      must also be internal — see RemiChatVoiceLayer.swift.

extension RemiChatStore {

    func connect() {
        if let connectTask, !connectTask.isCancelled {
            return
        }
        connectTask = Task { [weak self] in
            guard let self else { return }
            await self.performConnect()
            self.connectTask = nil
        }
    }

    func performConnect() async {
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

    func receiveLoop() {
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

    func consume(_ message: URLSessionWebSocketTask.Message) {
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

    func consumeServerText(_ text: String) {
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

    func sendChatPayload(_ payload: [String: Any]) {
        if connectionPhase == .open, socket != nil {
            sendJSON(payload, queueOnFailure: true)
            return
        }
        pendingChatPayloads.append(payload)
        if connectionPhase != .connecting {
            connect()
        }
    }

    func flushPendingChatPayloads() {
        guard connectionPhase == .open, socket != nil, !pendingChatPayloads.isEmpty else { return }
        let queued = pendingChatPayloads
        pendingChatPayloads.removeAll()
        for payload in queued {
            sendJSON(payload, queueOnFailure: true)
        }
    }

    func startKeepAlive(for task: URLSessionWebSocketTask) {
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

    func sendJSON(_ payload: [String: Any], queueOnFailure: Bool = false) {
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

    func sendVolatileJSON(_ payload: [String: Any]) {
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

    func sendClientContextIfNeeded() {
        guard !didSendClientContextForCurrentSocket else { return }
        didSendClientContextForCurrentSocket = true
        sendJSON(RemiChatConfig.buildClientContextPayload(), queueOnFailure: true)
    }

    func handleSocketFailure(_ error: Error) {
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

    func logPayload(_ direction: String, _ payload: [String: Any]) {
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

    func connectionFailureMessage(for error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorTimedOut {
            if let host = URL(string: RemiChatConfig.wsURLString)?.host, !host.isEmpty {
                return "Connection to \(host) timed out. Check that your iPhone and Mac are on the same Wi-Fi, macOS firewall allows port 3000, and the router is not blocking device-to-device traffic. Retrying..."
            }
            return "Connection timed out. Check same Wi-Fi, macOS firewall, and LAN reachability to port 3000. Retrying..."
        }
        return "Connection lost, retrying..."
    }

    func redactedWebSocketURL(_ url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url.absoluteString
        }
        components.queryItems = components.queryItems?.map { item in
            guard item.name == "token" else { return item }
            return URLQueryItem(name: item.name, value: "<redacted>")
        }
        return components.string ?? url.absoluteString
    }
}
