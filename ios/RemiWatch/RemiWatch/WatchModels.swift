import Foundation

enum WatchChatRole {
    case user
    case remi
    case system
}

struct WatchChatMessage: Identifiable, Equatable {
    let id: String
    let role: WatchChatRole
    var text: String

    init(id: String = UUID().uuidString, role: WatchChatRole, text: String) {
        self.id = id
        self.role = role
        self.text = text
    }
}

enum WatchConnectionPhase: Equatable {
    case closed
    case connecting
    case open
}

enum WatchHistoryMode {
    case replace
    case prepend
}

struct WatchHistoryCursor: Equatable {
    let id: String
    let createdAt: String
}

struct WatchHistoryMessage {
    let id: String
    let role: WatchChatRole
    let text: String
    let createdAtMs: Int64
}

/// Subset of the gateway wire protocol the watch MVP consumes.
enum WatchServerMessage {
    case chatChunk(content: String, generationId: Int?)
    case chatEnd(content: String?, generationId: Int?, emotion: String?)
    case emotion(String)
    case voice(audioBase64: String, generationId: Int?)
    case historyPage(mode: WatchHistoryMode, messages: [WatchHistoryMessage], nextCursor: WatchHistoryCursor?, hasMore: Bool)
    case error(String)

    static func parse(_ text: String) -> WatchServerMessage? {
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
            guard let audio = payload["audio"] as? String, !audio.isEmpty else { return nil }
            return .voice(audioBase64: audio, generationId: intValue(payload["generationId"]))
        case "history_page":
            let mode: WatchHistoryMode = (payload["mode"] as? String == "prepend") ? .prepend : .replace
            let messages = (payload["messages"] as? [[String: Any]] ?? [])
                .compactMap(WatchHistoryMessage.init(payload:))
            return .historyPage(
                mode: mode,
                messages: messages,
                nextCursor: WatchHistoryCursor(payload: payload["nextCursor"]),
                hasMore: payload["hasMore"] as? Bool ?? false
            )
        case "error":
            return .error(payload["content"] as? String ?? "Server error")
        default:
            return nil
        }
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let v = value as? Int { return v }
        if let v = value as? NSNumber { return v.intValue }
        if let v = value as? String { return Int(v) }
        return nil
    }
}

extension WatchHistoryMessage {
    init?(payload: [String: Any]) {
        guard let id = payload["id"] as? String, !id.isEmpty,
              let rawRole = payload["role"] as? String,
              let content = payload["content"] as? String, !content.isEmpty else {
            return nil
        }
        let role: WatchChatRole
        switch rawRole {
        case "user": role = .user
        case "assistant": role = .remi
        default: return nil
        }
        self.id = id
        self.role = role
        self.text = content
        self.createdAtMs = Self.parseCreatedAtMs(payload["createdAt"])
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    private static func parseCreatedAtMs(_ raw: Any?) -> Int64 {
        guard let s = raw as? String else { return Int64(Date().timeIntervalSince1970 * 1000) }
        let date = isoFractional.date(from: s) ?? isoPlain.date(from: s)
        guard let date else { return Int64(Date().timeIntervalSince1970 * 1000) }
        return Int64(date.timeIntervalSince1970 * 1000)
    }
}

extension WatchHistoryCursor {
    init?(payload: Any?) {
        guard let p = payload as? [String: Any],
              let id = p["id"] as? String,
              let createdAt = p["createdAt"] as? String else {
            return nil
        }
        self.init(id: id, createdAt: createdAt)
    }
}
