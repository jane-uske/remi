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

/// Subset of the gateway wire protocol the watch MVP consumes.
enum WatchServerMessage {
    case chatChunk(content: String, generationId: Int?)
    case chatEnd(content: String?, generationId: Int?, emotion: String?)
    case emotion(String)
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
