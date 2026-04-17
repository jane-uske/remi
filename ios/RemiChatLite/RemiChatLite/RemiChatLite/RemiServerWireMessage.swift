import Foundation

enum RemiServerWireMessage {
    case chatChunk(content: String, generationId: Int?)
    case chatEnd(content: String?, generationId: Int?)
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
    case historyPage(RemiServerHistoryPage)
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
                generationId: intValue(payload["generationId"])
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

        case "history_page":
            return .historyPage(parseHistoryPage(payload))

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
