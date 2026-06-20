import Combine
import SwiftUI

@MainActor
final class RemiAvatarStateStore: ObservableObject {

    @Published private(set) var currentEmotion: AvatarEmotion = .neutral
    @Published private(set) var avatarPhase: RemiAvatarPhase = .idle
    @Published private(set) var companionLine: String = "我会一直在这里接着聊。"
    @Published private(set) var presenceLabel: String = "在这里"
    @Published private(set) var turnStateBadgeColor: Color = .gray

    private var cancellables = Set<AnyCancellable>()
    private weak var chatStore: RemiChatStore?

    init(chatStore: RemiChatStore) {
        self.chatStore = chatStore
        bind(chatStore)
    }

    private func bind(_ store: RemiChatStore) {
        store.$emotion
            .map { AvatarEmotion(rawEmotion: $0) }
            .assign(to: &$currentEmotion)

        Publishers.CombineLatest(store.$turnState, store.$connectionPhase)
            .map { turnState, connectionPhase -> RemiAvatarPhase in
                guard connectionPhase == .open else { return .idle }
                switch turnState {
                case .listeningActive, .listeningHold:
                    return .listening
                case .likelyEnd, .confirmedEnd, .assistantEntering:
                    return .thinking
                case .assistantSpeaking:
                    return .speaking
                case .interruptedByUser:
                    return .listening
                }
            }
            .assign(to: &$avatarPhase)

        Publishers.CombineLatest3(store.$turnState, store.$connectionPhase, store.$emotion)
            .map { turnState, connectionPhase, emotion in
                Self.resolveCompanionLine(turnState: turnState, connectionPhase: connectionPhase, emotion: emotion)
            }
            .assign(to: &$companionLine)

        store.$turnState
            .combineLatest(store.$connectionPhase)
            .map { turnState, connectionPhase -> String in
                guard connectionPhase == .open else { return "离线" }
                switch turnState {
                case .listeningActive, .listeningHold:
                    return "在听"
                case .likelyEnd, .confirmedEnd, .assistantEntering:
                    return "思考中"
                case .assistantSpeaking:
                    return "说话中"
                case .interruptedByUser:
                    return "在接话"
                }
            }
            .assign(to: &$presenceLabel)

        store.$turnState
            .combineLatest(store.$connectionPhase)
            .map { turnState, connectionPhase -> Color in
                guard connectionPhase == .open else {
                    return RemiDesignTokens.connectionColor(for: connectionPhase)
                }
                return RemiDesignTokens.turnStateColor(for: turnState)
            }
            .assign(to: &$turnStateBadgeColor)
    }

    private static func resolveCompanionLine(
        turnState: RemiTurnState,
        connectionPhase: ConnectionPhase,
        emotion: String
    ) -> String {
        if connectionPhase == .connecting {
            return "我正在重新接上，不会把这段对话丢掉。"
        }
        if connectionPhase == .closed {
            return "我会尽快重新接上，不会把这段对话丢在这里。"
        }

        switch turnState {
        case .listeningActive:
            return "我在听，你慢慢说。"
        case .listeningHold:
            return "我先不抢话，等你把这句落稳。"
        case .likelyEnd:
            return "我收到了，等最后这点声音落下来。"
        case .confirmedEnd, .assistantEntering:
            return "让我想一下，我马上接上。"
        case .assistantSpeaking:
            return "我在这里，不会让对话掉下去。"
        case .interruptedByUser:
            return "听到了，我先让给你。"
        }
    }
}
