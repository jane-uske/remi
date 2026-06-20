import Foundation

enum RemiServerWireMessage {
    case chatChunk(content: String, generationId: Int?)
    case chatEnd(content: String?, generationId: Int?, emotion: String?)
    case emotion(String)
    case voice(audio: String, generationId: Int?)
    case voicePcmChunk(
        audio: String,
        sampleRate: Int,
        channels: Int,
        bitsPerSample: Int,
        generationId: Int?
    )
    case vadStart
    case vadEnd
    case sttPartial(String)
    case sttFinal(String)
    case interrupt
    case turnState(state: String, reason: String, generationId: Int?, preview: String?, interruptionType: String?)
    case sttPrediction(status: String, preview: String)
    case avatarFrame(emotion: String?, lipSyncViseme: String?, lipSyncWeight: Double?)
    case avatarIntent(emotion: String, gesture: String, gestureIntensity: Int, energy: Int, holdMs: Int, beats: [[String: Any]])
    case ttsLipSync(generationId: Int, source: String, mode: String, complete: Bool, cues: [[String: Any]])
    case historyPage(RemiServerHistoryPage)
    case nsfwModeState(enabled: Bool)
    case error(String)
}

struct RemiServerHistoryPage {
    let mode: RemiServerHistoryPageMode
    let messages: [HistoryPageMessage]
    let nextCursor: HistoryCursor?
    let hasMore: Bool
}

enum RemiServerHistoryPageMode {
    case replace
    case prepend
}

enum RemiServerWireMessageParser {
    static func parse(_ text: String) -> RemiServerWireMessage? {
        guard let data = text.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = payload["type"] as? String else {
            return nil
        }

        switch type {
        case "chat_chunk":
            return .chatChunk(
                content: payload["content"] as? String ?? "",
                generationId: intValue(payload["generationId"])
            )

        case "chat_end":
            return .chatEnd(
                content: payload["content"] as? String,
                generationId: intValue(payload["generationId"]),
                emotion: payload["emotion"] as? String
            )

        case "emotion":
            guard let emotion = payload["emotion"] as? String else { return nil }
            return .emotion(emotion)

        case "voice":
            guard let audio = payload["audio"] as? String else { return nil }
            return .voice(audio: audio, generationId: intValue(payload["generationId"]))

        case "voice_pcm_chunk":
            guard let audio = payload["audio"] as? String,
                  let sampleRate = intValue(payload["sampleRate"]),
                  let channels = intValue(payload["channels"]),
                  let bitsPerSample = intValue(payload["bitsPerSample"]) else {
                return nil
            }
            return .voicePcmChunk(
                audio: audio,
                sampleRate: sampleRate,
                channels: channels,
                bitsPerSample: bitsPerSample,
                generationId: intValue(payload["generationId"])
            )

        case "vad_start":
            return .vadStart

        case "vad_end":
            return .vadEnd

        case "stt_partial":
            return .sttPartial(payload["content"] as? String ?? "")

        case "stt_final":
            return .sttFinal(payload["content"] as? String ?? "")

        case "interrupt":
            return .interrupt

        case "turn_state":
            guard let state = payload["state"] as? String,
                  let reason = payload["reason"] as? String else { return nil }
            return .turnState(
                state: state,
                reason: reason,
                generationId: intValue(payload["generationId"]),
                preview: payload["preview"] as? String,
                interruptionType: payload["interruptionType"] as? String
            )

        case "stt_prediction":
            let status = payload["status"] as? String ?? ""
            let preview = (payload["preview"] as? String ?? "").trimmingCharacters(in: .whitespaces)
            guard !preview.isEmpty else { return nil }
            return .sttPrediction(status: status, preview: preview)

        case "avatar_frame":
            let frameDict = payload["frame"] as? [String: Any] ?? payload
            let emotion = frameDict["emotion"] as? String
            var lipViseme: String?
            var lipWeight: Double?
            if let lip = frameDict["lipSync"] as? [String: Any] {
                lipViseme = lip["viseme"] as? String
                lipWeight = lip["weight"] as? Double
            }
            return .avatarFrame(emotion: emotion, lipSyncViseme: lipViseme, lipSyncWeight: lipWeight)

        case "avatar_intent":
            let intentDict = payload["intent"] as? [String: Any] ?? payload
            let emotion = intentDict["emotion"] as? String ?? "neutral"
            let gesture = intentDict["gesture"] as? String ?? ""
            let gestureIntensity = intValue(intentDict["gestureIntensity"]) ?? 0
            let energy = intValue(intentDict["energy"]) ?? 0
            let holdMs = intValue(intentDict["holdMs"]) ?? 0
            let beats = payload["beats"] as? [[String: Any]] ?? []
            return .avatarIntent(
                emotion: emotion,
                gesture: gesture,
                gestureIntensity: gestureIntensity,
                energy: energy,
                holdMs: holdMs,
                beats: beats
            )

        case "tts_lip_sync":
            guard let generationId = intValue(payload["generationId"]) else { return nil }
            let source = payload["source"] as? String ?? ""
            let mode = payload["mode"] as? String ?? "replace"
            let complete = payload["complete"] as? Bool ?? false
            let cues = payload["cues"] as? [[String: Any]] ?? []
            return .ttsLipSync(
                generationId: generationId,
                source: source,
                mode: mode,
                complete: complete,
                cues: cues
            )

        case "history_page":
            return .historyPage(parseHistoryPage(payload))

        case "nsfw_mode_state":
            let enabled = payload["enabled"] as? Bool ?? false
            return .nsfwModeState(enabled: enabled)

        case "error":
            return .error(payload["content"] as? String ?? "Server error")

        default:
            return nil
        }
    }

    private static func parseHistoryPage(_ payload: [String: Any]) -> RemiServerHistoryPage {
        let mode = (payload["mode"] as? String) == "prepend"
            ? RemiServerHistoryPageMode.prepend
            : .replace
        let messages = (payload["messages"] as? [[String: Any]] ?? [])
            .compactMap(HistoryPageMessage.init(payload:))
        let nextCursor = HistoryCursor(payload: payload["nextCursor"])
        let hasMore = payload["hasMore"] as? Bool ?? false

        return RemiServerHistoryPage(
            mode: mode,
            messages: messages,
            nextCursor: nextCursor,
            hasMore: hasMore
        )
    }

    private static func intValue(_ value: Any?) -> Int? {
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
}

extension HistoryPageMessage {
    init?(payload: [String: Any]) {
        guard let id = payload["id"] as? String, !id.isEmpty else { return nil }
        guard let rawRole = payload["role"] as? String else { return nil }
        let role: ChatRole
        switch rawRole {
        case "user":
            role = .user
        case "assistant":
            role = .remi
        default:
            return nil
        }
        guard let text = payload["content"] as? String, !text.isEmpty else { return nil }
        let createdAtMs = Self.parseCreatedAtMs(payload["createdAt"])

        self.id = id
        self.role = role
        self.text = text
        self.createdAtMs = createdAtMs
    }

    private static func parseCreatedAtMs(_ raw: Any?) -> Int64 {
        guard let string = raw as? String,
              let date = ISO8601DateFormatter().date(from: string) else {
            return Int64(Date().timeIntervalSince1970 * 1000)
        }
        return Int64(date.timeIntervalSince1970 * 1000)
    }
}

extension HistoryCursor {
    init?(payload: Any?) {
        guard let payload = payload as? [String: Any],
              let id = payload["id"] as? String,
              let createdAt = payload["createdAt"] as? String else {
            return nil
        }
        self.init(id: id, createdAt: createdAt)
    }
}
