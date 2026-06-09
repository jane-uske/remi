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

enum RemiTurnState: String, CaseIterable {
    case listeningActive = "listening_active"
    case listeningHold = "listening_hold"
    case likelyEnd = "likely_end"
    case confirmedEnd = "confirmed_end"
    case assistantEntering = "assistant_entering"
    case assistantSpeaking = "assistant_speaking"
    case interruptedByUser = "interrupted_by_user"
}

enum AvatarEmotion: String, CaseIterable {
    case neutral, happy, curious, shy, sad

    var auraStartHex: UInt { switch self {
        case .neutral: 0x65d5f0
        case .happy:   0xf7a6cf
        case .curious: 0x8cb9ff
        case .shy:     0xd7b2ff
        case .sad:     0x95bfd0
    }}

    var auraEndHex: UInt { switch self {
        case .neutral: 0x287d97
        case .happy:   0xdb6f8f
        case .curious: 0x4d7fd6
        case .shy:     0x9c6ff0
        case .sad:     0x5c7f90
    }}

    /// Human-readable emotion name for VoiceOver / accessibility.
    var displayName: String { switch self {
        case .neutral: "平静"
        case .happy:   "开心"
        case .curious: "好奇"
        case .shy:     "害羞"
        case .sad:     "难过"
    }}

    init(rawEmotion: String) {
        self = AvatarEmotion(rawValue: rawEmotion) ?? .neutral
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
