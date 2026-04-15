import Foundation

enum ChatRole: String, Codable {
    case user
    case remi
    case error
    case sys
}

struct ChatMessage: Identifiable, Codable, Equatable {
    let id: String
    let role: ChatRole
    var text: String
    let createdAtMs: Int64

    init(
        id: String = UUID().uuidString,
        role: ChatRole,
        text: String,
        createdAtMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) {
        self.id = id
        self.role = role
        self.text = text
        self.createdAtMs = createdAtMs
    }
}

struct HistoryCursor: Codable, Equatable {
    let id: String
    let createdAt: String

    var isValid: Bool {
        !id.isEmpty && !createdAt.isEmpty
    }
}

struct HistoryPageMessage: Equatable {
    let id: String
    let role: ChatRole
    let text: String
    let createdAtMs: Int64

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

    var chatMessage: ChatMessage {
        ChatMessage(id: id, role: role, text: text, createdAtMs: createdAtMs)
    }

    private static func parseCreatedAtMs(_ raw: Any?) -> Int64 {
        guard let string = raw as? String,
              let date = ISO8601DateFormatter().date(from: string) else {
            return Int64(Date().timeIntervalSince1970 * 1000)
        }
        return Int64(date.timeIntervalSince1970 * 1000)
    }
}

enum ConnectionPhase: String {
    case connecting
    case open
    case closed

    var label: String {
        switch self {
        case .connecting:
            return "Connecting..."
        case .open:
            return "Connected"
        case .closed:
            return "Disconnected"
        }
    }
}
