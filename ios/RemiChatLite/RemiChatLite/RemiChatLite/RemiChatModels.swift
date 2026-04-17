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

    var chatMessage: ChatMessage {
        ChatMessage(id: id, role: role, text: text, createdAtMs: createdAtMs)
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
