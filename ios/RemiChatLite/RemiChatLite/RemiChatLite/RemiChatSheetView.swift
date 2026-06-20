import SwiftUI

struct RemiChatSheetView: View {
    @ObservedObject var store: RemiChatStore
    var isInputFocused: FocusState<Bool>.Binding
    let horizontalPadding: CGFloat
    @Environment(\.colorScheme) private var colorScheme
    @State private var topVisibleMessageID: String?
    @State private var pendingHistoryAnchorMessageID: String?

    private let innerCornerRadius: CGFloat = 18
    private let bottomScrollAnchor = "message-list-bottom-anchor"
    private let messageScrollCoordinateSpace = "message-scroll"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 14) {
                    if store.historyHasMore {
                        historyLoadMoreButton
                    }

                    ForEach(store.messages) { message in
                        bubble(for: message)
                            .background(alignment: .top) {
                                GeometryReader { geometry in
                                    Color.clear.preference(
                                        key: SheetVisibleMessageFramesKey.self,
                                        value: [
                                            SheetVisibleFrame(
                                                id: message.id,
                                                minY: geometry.frame(in: .named(messageScrollCoordinateSpace)).minY,
                                                maxY: geometry.frame(in: .named(messageScrollCoordinateSpace)).maxY
                                            )
                                        ]
                                    )
                                }
                            }
                            .id(message.id)
                    }

                    if store.isAwaitingAssistantResponse {
                        responseLoadingBubble
                            .id("remi-response-loading")
                    }

                    Color.clear
                        .frame(height: isInputFocused.wrappedValue ? 28 : 22)
                        .id(bottomScrollAnchor)
                }
                .padding(.horizontal, horizontalPadding)
                .padding(.top, 8)
                .padding(.bottom, 10)
            }
            .coordinateSpace(name: messageScrollCoordinateSpace)
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .onPreferenceChange(SheetVisibleMessageFramesKey.self) { frames in
                topVisibleMessageID = frames
                    .filter { $0.maxY > 0 }
                    .sorted { lhs, rhs in
                        if lhs.minY == rhs.minY { return lhs.id < rhs.id }
                        return lhs.minY < rhs.minY
                    }
                    .first?.id
            }
            .onChange(of: store.autoScrollToBottomVersion) { _, _ in
                withAnimation(.easeOut(duration: 0.24)) {
                    proxy.scrollTo(bottomScrollAnchor, anchor: .bottom)
                }
            }
            .onChange(of: store.historyLoadingMore) { wasLoading, isLoading in
                guard wasLoading, !isLoading else { return }
                let anchorID = pendingHistoryAnchorMessageID
                pendingHistoryAnchorMessageID = nil
                guard let anchorID, store.messages.contains(where: { $0.id == anchorID }) else { return }
                DispatchQueue.main.async {
                    proxy.scrollTo(anchorID, anchor: .top)
                }
            }
            .onChange(of: store.isAwaitingAssistantResponse) { _, awaiting in
                guard awaiting else { return }
                DispatchQueue.main.async {
                    withAnimation(.easeOut(duration: 0.24)) {
                        proxy.scrollTo(bottomScrollAnchor, anchor: .bottom)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var historyLoadMoreButton: some View {
        Button(action: { requestHistoryLoad() }) {
            HStack(spacing: 8) {
                if store.historyLoadingMore {
                    ProgressView().controlSize(.small)
                }
                Text(store.historyLoadingMore ? "Loading..." : "Load Earlier")
                    .font(.system(size: 13, weight: .regular, design: .rounded))
            }
            .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.28), in: RoundedRectangle(cornerRadius: innerCornerRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
        .opacity(0.9)
        .onAppear { requestHistoryAutoLoadIfNeeded() }
    }

    @ViewBuilder
    private func bubble(for message: ChatMessage) -> some View {
        HStack {
            if message.role == .user { Spacer(minLength: 28) }

            BubbleCard(
                role: message.role,
                cornerRadius: innerCornerRadius,
                fillColor: RemiChatBubbleStyle.bubbleColor(for: message.role, colorScheme: colorScheme),
                strokeColor: RemiChatBubbleStyle.strokeColor(for: message.role, colorScheme: colorScheme),
                shadowColor: RemiChatBubbleStyle.shadowColor(for: message.role, colorScheme: colorScheme),
                glassTint: RemiChatBubbleStyle.glassTint(for: message.role, colorScheme: colorScheme)
            ) {
                bubbleContent(for: message)
            }
            .frame(maxWidth: 320, alignment: message.role == .user ? .trailing : .leading)

            if message.role != .user { Spacer(minLength: 28) }
        }
    }

    @ViewBuilder
    private func bubbleContent(for message: ChatMessage) -> some View {
        let segments = RemiChatImageParser.parse(message.text)
        let hasImages = segments.contains { if case .image = $0 { return true } else { return false } }

        if hasImages {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(segments) { segment in
                    switch segment {
                    case .text(let text):
                        Text(text)
                            .font(.system(size: 16, weight: .regular, design: .rounded))
                            .foregroundStyle(RemiChatBubbleStyle.textColor(for: message.role, colorScheme: colorScheme))
                            .textSelection(.enabled)
                    case .image(let alt, let url):
                        RemiChatInlineImage(url: url, alt: alt)
                    }
                }
            }
        } else {
            Text(message.text)
                .font(.system(size: 16, weight: .regular, design: .rounded))
                .foregroundStyle(RemiChatBubbleStyle.textColor(for: message.role, colorScheme: colorScheme))
                .textSelection(.enabled)
        }
    }

    private var responseLoadingBubble: some View {
        HStack {
            BubbleCard(
                role: .remi,
                cornerRadius: innerCornerRadius,
                fillColor: RemiChatBubbleStyle.bubbleColor(for: .remi, colorScheme: colorScheme),
                strokeColor: RemiChatBubbleStyle.strokeColor(for: .remi, colorScheme: colorScheme),
                shadowColor: RemiChatBubbleStyle.shadowColor(for: .remi, colorScheme: colorScheme),
                glassTint: RemiChatBubbleStyle.glassTint(for: .remi, colorScheme: colorScheme)
            ) {
                HStack(spacing: 10) {
                    TypingDotsView(accent: RemiDesignTokens.accent(colorScheme))
                    Text(store.connectionPhase == .open ? "Remi is thinking..." : "Waiting to reconnect...")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))
                }
            }
            .frame(maxWidth: 320, alignment: .leading)
            Spacer(minLength: 28)
        }
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    private func requestHistoryAutoLoadIfNeeded() {
        guard store.historyHasMore, !store.historyLoadingMore else { return }
        DispatchQueue.main.async { requestHistoryLoad() }
    }

    private func requestHistoryLoad() {
        guard store.historyHasMore, !store.historyLoadingMore else { return }
        pendingHistoryAnchorMessageID = topVisibleMessageID ?? store.messages.first?.id
        store.loadMoreHistory()
    }
}

private struct SheetVisibleFrame: Equatable {
    let id: String
    let minY: CGFloat
    let maxY: CGFloat
}

private struct SheetVisibleMessageFramesKey: PreferenceKey {
    static var defaultValue: [SheetVisibleFrame] = []
    static func reduce(value: inout [SheetVisibleFrame], nextValue: () -> [SheetVisibleFrame]) {
        value.append(contentsOf: nextValue())
    }
}
