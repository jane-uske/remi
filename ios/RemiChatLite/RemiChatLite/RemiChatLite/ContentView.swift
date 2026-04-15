import SwiftUI

struct ChatView: View {
    @StateObject private var store = RemiChatStore()
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var isInputFocused: Bool
    @State private var isPushToTalkPressing = false
    @State private var isShowingDuplexDemo = false
    @State private var topVisibleMessageID: String?
    @State private var pendingHistoryAnchorMessageID: String?

    private let surfaceCornerRadius: CGFloat = 22
    private let innerCornerRadius: CGFloat = 18
    private let surfaceMinHeight: CGFloat = 44
    private let bottomScrollAnchor = "message-list-bottom-anchor"
    private let focusedMessageBottomInset: CGFloat = 28
    private let composerControlSize: CGFloat = 30
    private let composerControlSpacing: CGFloat = 4
    private let messageScrollCoordinateSpace = "message-scroll"

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                backgroundLayer
                    .ignoresSafeArea()

                messageList(horizontalPadding: horizontalPadding(for: proxy.size.width))
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                header
                    .padding(.top, topPadding(for: proxy.safeAreaInsets.top))
                    .padding(.horizontal, horizontalPadding(for: proxy.size.width))
                    .padding(.bottom, 10)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                inputBar
                    .padding(.horizontal, horizontalPadding(for: proxy.size.width))
                    .padding(.top, 8)
                    .padding(.bottom, composerBottomPadding(for: proxy.safeAreaInsets.bottom, isFocused: isInputFocused))
            }
            .contentShape(Rectangle())
            .onTapGesture {
                isInputFocused = false
            }
        }
        .onAppear { store.start() }
        .onDisappear { store.stop() }
        .fullScreenCover(isPresented: $isShowingDuplexDemo, onDismiss: {
            store.exitDuplexMode()
        }) {
            DuplexVoiceDemoView(store: store, isPresented: $isShowingDuplexDemo)
        }
    }

    private var backgroundLayer: some View {
        ZStack {
            baseBackground

            Circle()
                .fill(Color(red: 0.23, green: 0.71, blue: 0.66).opacity(colorScheme == .dark ? 0.24 : 0.18))
                .frame(width: 280, height: 280)
                .blur(radius: 24)
                .offset(x: -150, y: -260)

            Circle()
                .fill(Color(red: 0.98, green: 0.54, blue: 0.34).opacity(colorScheme == .dark ? 0.16 : 0.14))
                .frame(width: 320, height: 320)
                .blur(radius: 32)
                .offset(x: 170, y: 220)

            RoundedRectangle(cornerRadius: 44, style: .continuous)
                .fill(.white.opacity(colorScheme == .dark ? 0.03 : 0.24))
                .frame(width: 360, height: 360)
                .blur(radius: 80)
                .offset(x: 130, y: -180)
        }
    }

    private var baseBackground: some View {
        LinearGradient(
            colors: colorScheme == .dark
                ? [
                    Color(red: 0.05, green: 0.07, blue: 0.10),
                    Color(red: 0.08, green: 0.11, blue: 0.16),
                    Color(red: 0.11, green: 0.16, blue: 0.20),
                  ]
                : [
                    Color(red: 0.95, green: 0.97, blue: 0.99),
                    Color(red: 0.89, green: 0.93, blue: 0.97),
                    Color(red: 0.83, green: 0.91, blue: 0.92),
                  ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var header: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(.white.opacity(colorScheme == .dark ? 0.06 : 0.40))
                    .frame(width: 30, height: 30)

                Circle()
                    .fill(connectionColor.opacity(colorScheme == .dark ? 0.88 : 0.84))
                    .frame(width: 7, height: 7)
                    .offset(x: -8, y: 0)

                Image(systemName: "sparkles")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(primaryTextColor.opacity(0.9))
            }

            VStack(alignment: .leading, spacing: 1) {
                Text("Remi")
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .foregroundStyle(primaryTextColor)

                Text(companionLine)
                    .font(.system(size: 10, weight: .regular, design: .rounded))
                    .foregroundStyle(secondaryTextColor)
                    .lineLimit(1)
            }

            Spacer(minLength: 10)

            Text(statusPillTitle)
                .font(.system(size: 10, weight: .regular, design: .rounded))
                .foregroundStyle(primaryTextColor)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(.white.opacity(colorScheme == .dark ? 0.07 : 0.30), in: Capsule())
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(minHeight: 48)
        .glassEffect(.regular.tint(strongGlassTint).interactive(), in: RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous)
                .fill(.white.opacity(colorScheme == .dark ? 0.08 : 0.22))
        )
    }

    private func messageList(horizontalPadding: CGFloat) -> some View {
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
                                        key: VisibleMessageFramesPreferenceKey.self,
                                        value: [
                                            VisibleMessageFrame(
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
                        .frame(height: isInputFocused ? focusedMessageBottomInset : 22)
                        .id(bottomScrollAnchor)
                }
                .padding(.horizontal, horizontalPadding)
                .padding(.top, 8)
                .padding(.bottom, 10)
            }
            .coordinateSpace(name: messageScrollCoordinateSpace)
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .onPreferenceChange(VisibleMessageFramesPreferenceKey.self) { frames in
                topVisibleMessageID = frames
                    .filter { $0.maxY > 0 }
                    .sorted { lhs, rhs in
                        if lhs.minY == rhs.minY {
                            return lhs.id < rhs.id
                        }
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
            .onChange(of: isInputFocused) { _, focused in
                guard focused else { return }
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
                    ProgressView()
                        .controlSize(.small)
                }
                Text(store.historyLoadingMore ? "Loading..." : "Load Earlier")
                    .font(.system(size: 13, weight: .regular, design: .rounded))
            }
            .foregroundStyle(primaryTextColor)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.28), in: RoundedRectangle(cornerRadius: innerCornerRadius, style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
        .opacity(0.9)
        .onAppear {
            requestHistoryAutoLoadIfNeeded()
        }
    }

    private var inputBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let voiceStatusText {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: voiceStatusIconName)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(store.voiceRecording || store.duplexEnabled || store.pushToTalkAwaitingResult ? sendButtonBackground : secondaryTextColor)
                        .padding(.top, voicePreviewText == nil ? 0 : 1)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(voiceStatusText)
                            .font(.system(size: 12, weight: .regular, design: .rounded))
                            .foregroundStyle(primaryTextColor)
                            .lineLimit(1)

                        if let voicePreviewText {
                            Text(voicePreviewText)
                                .font(.system(size: 12, weight: .regular, design: .rounded))
                                .foregroundStyle(secondaryTextColor)
                                .lineLimit(2)
                        }
                    }

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 2)
            }

            HStack(alignment: .center, spacing: composerControlSpacing) {
                duplexButton
                pushToTalkButton

                TextField("Say something to Remi...", text: $store.draft, axis: .vertical)
                    .lineLimit(1...4)
                    .font(.system(size: 16, weight: .regular, design: .rounded))
                    .foregroundStyle(primaryTextColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .multilineTextAlignment(.leading)
                    .focused($isInputFocused)
                    .submitLabel(.send)
                    .onSubmit {
                        submitDraft()
                    }

                Button(action: { submitDraft() }) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 34, height: 34)
                        .background(sendButtonBackground, in: Circle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: surfaceMinHeight)
        .glassEffect(.regular.tint(strongGlassTint).interactive(), in: RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous)
                .fill(.white.opacity(colorScheme == .dark ? 0.09 : 0.24))
        )
    }

    private var duplexButton: some View {
        let active = store.duplexEnabled || isShowingDuplexDemo
        let disabled = !active && (store.pushToTalkRecording || store.pushToTalkAwaitingResult || isPushToTalkPressing)
        return Button(action: {
            isInputFocused = false
            isShowingDuplexDemo = true
        }) {
            ZStack {
                Circle()
                    .fill(active ? sendButtonBackground.opacity(0.18) : .white.opacity(colorScheme == .dark ? 0.08 : 0.34))
                    .frame(width: composerControlSize, height: composerControlSize)

                Image(systemName: active ? "dot.radiowaves.left.and.right" : "waveform")
                    .font(.system(size: active ? 15 : 13, weight: .semibold))
                    .foregroundStyle(active ? sendButtonBackground : primaryTextColor.opacity(0.92))
            }
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.42 : 1)
        .scaleEffect(active ? 1.04 : 1)
        .animation(.easeOut(duration: 0.16), value: active)
    }

    private var pushToTalkButton: some View {
        let active = store.pushToTalkRecording || isPushToTalkPressing
        let disabled = store.duplexEnabled || store.pushToTalkAwaitingResult
        return ZStack {
            Circle()
                .fill(active ? sendButtonBackground.opacity(0.18) : .white.opacity(colorScheme == .dark ? 0.08 : 0.34))
                .frame(width: composerControlSize, height: composerControlSize)

            Image(systemName: active ? "mic.circle.fill" : "mic.fill")
                .font(.system(size: active ? 16 : 13, weight: .semibold))
                .foregroundStyle(active ? sendButtonBackground : primaryTextColor.opacity(0.92))
        }
        .opacity(disabled ? 0.42 : 1)
        .scaleEffect(active ? 1.04 : 1)
        .animation(.easeOut(duration: 0.16), value: active)
        .contentShape(Circle())
        .allowsHitTesting(!disabled)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !disabled, !isPushToTalkPressing else { return }
                    isPushToTalkPressing = true
                    isInputFocused = false
                    store.beginPushToTalk()
                }
                .onEnded { _ in
                    guard isPushToTalkPressing else { return }
                    isPushToTalkPressing = false
                    store.endPushToTalk()
                }
        )
    }

    @ViewBuilder
    private func bubble(for message: ChatMessage) -> some View {
        HStack {
            if message.role == .user {
                Spacer(minLength: 28)
            }

            BubbleCard(
                role: message.role,
                cornerRadius: innerCornerRadius,
                fillColor: bubbleColor(for: message.role),
                strokeColor: bubbleStroke(for: message.role),
                shadowColor: shadowColor(for: message.role),
                glassTint: bubbleGlassTint(for: message.role)
            ) {
                Text(message.text)
                    .font(.system(size: 16, weight: .regular, design: .rounded))
                    .foregroundStyle(textColor(for: message.role))
                    .textSelection(.enabled)
            }
                .frame(maxWidth: 320, alignment: message.role == .user ? .trailing : .leading)

            if message.role != .user {
                Spacer(minLength: 28)
            }
        }
    }

    private var responseLoadingBubble: some View {
        HStack {
            BubbleCard(
                role: .remi,
                cornerRadius: innerCornerRadius,
                fillColor: bubbleColor(for: .remi),
                strokeColor: bubbleStroke(for: .remi),
                shadowColor: shadowColor(for: .remi),
                glassTint: bubbleGlassTint(for: .remi)
            ) {
                HStack(spacing: 10) {
                    TypingDotsView(accent: sendButtonBackground)

                    Text(store.connectionPhase == .open ? "Remi is thinking..." : "Waiting to reconnect...")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(secondaryTextColor)
                }
            }
            .frame(maxWidth: 320, alignment: .leading)

            Spacer(minLength: 28)
        }
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    private var connectionColor: Color {
        switch store.connectionPhase {
        case .open:
            return .green
        case .connecting:
            return .orange
        case .closed:
            return .gray
        }
    }

    private func bubbleColor(for role: ChatRole) -> Color {
        switch role {
        case .user:
            return Color(red: 0.13, green: 0.56, blue: 0.50)
        case .remi:
            return colorScheme == .dark
                ? Color.white.opacity(0.10)
                : Color.white.opacity(0.36)
        case .error:
            return Color(red: 0.73, green: 0.17, blue: 0.20).opacity(colorScheme == .dark ? 0.35 : 0.18)
        case .sys:
            return colorScheme == .dark
                ? Color.white.opacity(0.08)
                : Color.white.opacity(0.30)
        }
    }

    private func textColor(for role: ChatRole) -> Color {
        switch role {
        case .user:
            return .white
        case .error:
            return colorScheme == .dark ? .white.opacity(0.92) : Color(red: 0.46, green: 0.07, blue: 0.11)
        case .remi, .sys:
            return primaryTextColor
        }
    }

    private func bubbleStroke(for role: ChatRole) -> Color {
        switch role {
        case .user:
            return .white.opacity(0.14)
        case .remi, .sys:
            return .white.opacity(colorScheme == .dark ? 0.12 : 0.30)
        case .error:
            return Color.white.opacity(colorScheme == .dark ? 0.10 : 0.36)
        }
    }

    private func bubbleGlassTint(for role: ChatRole) -> Color {
        switch role {
        case .user:
            return sendButtonBackground.opacity(colorScheme == .dark ? 0.26 : 0.34)
        case .remi:
            return .white.opacity(colorScheme == .dark ? 0.12 : 0.28)
        case .sys:
            return .white.opacity(colorScheme == .dark ? 0.10 : 0.22)
        case .error:
            return Color(red: 0.73, green: 0.17, blue: 0.20).opacity(colorScheme == .dark ? 0.24 : 0.18)
        }
    }

    private func shadowColor(for role: ChatRole) -> Color {
        switch role {
        case .user:
            return Color(red: 0.05, green: 0.34, blue: 0.28).opacity(colorScheme == .dark ? 0.10 : 0.08)
        case .remi, .sys, .error:
            return .black.opacity(colorScheme == .dark ? 0.08 : 0.04)
        }
    }

    private var statusPillTitle: String {
        if store.connectionPhase == .open {
            return store.hasSyncedServerHistory ? "Live" : "Online"
        }
        if store.isShowingCachedHistory {
            return "Restored"
        }
        return store.connectionPhase == .connecting ? "Joining" : "Away"
    }

    private var companionLine: String {
        if store.connectionPhase == .open {
            return store.hasSyncedServerHistory ? "Live conversation synced" : "Connection is warm"
        }
        if store.isShowingCachedHistory {
            return "Recovered from your last session"
        }
        return store.connectionPhase == .connecting ? "Trying to reach your server..." : "Waiting for the server"
    }

    private var primaryTextColor: Color {
        colorScheme == .dark ? .white.opacity(0.96) : Color.black.opacity(0.88)
    }

    private var secondaryTextColor: Color {
        colorScheme == .dark ? .white.opacity(0.64) : Color.black.opacity(0.54)
    }

    private var sendButtonBackground: Color {
        colorScheme == .dark
            ? Color(red: 0.28, green: 0.72, blue: 0.66)
            : Color(red: 0.14, green: 0.58, blue: 0.52)
    }

    private var glassTint: Color {
        colorScheme == .dark
            ? Color.white.opacity(0.05)
            : Color.white.opacity(0.24)
    }

    private var strongGlassTint: Color {
        colorScheme == .dark
            ? Color.white.opacity(0.12)
            : Color.white.opacity(0.34)
    }

    private var voiceStatusText: String? {
        let caption = store.voiceStatusCaption.trimmingCharacters(in: .whitespacesAndNewlines)
        if !caption.isEmpty {
            return caption
        }
        let trimmed = store.voiceTranscriptPreview.trimmingCharacters(in: .whitespacesAndNewlines)
        if store.duplexEnabled {
            return store.voiceRecording ? "Full-duplex on. Speak anytime." : "Starting voice..."
        }
        if store.pushToTalkRecording || isPushToTalkPressing {
            return trimmed.isEmpty ? "Listening... release to send" : trimmed
        }
        if store.pushToTalkAwaitingResult {
            return "Transcribing..."
        }
        return trimmed.isEmpty ? nil : trimmed
    }

    private var voicePreviewText: String? {
        let caption = store.voiceStatusCaption.trimmingCharacters(in: .whitespacesAndNewlines)
        let preview = store.voiceTranscriptPreview.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !caption.isEmpty, !preview.isEmpty else { return nil }
        return preview
    }

    private var voiceStatusIconName: String {
        if store.duplexEnabled {
            return "dot.radiowaves.left.and.right"
        }
        if store.pushToTalkRecording || isPushToTalkPressing {
            return "mic.fill"
        }
        if store.voiceRecording {
            return "waveform"
        }
        let caption = store.voiceStatusCaption.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if caption.contains("no transcript") || caption.contains("try again") || caption.contains("timed out") || caption.contains("failed") {
            return "exclamationmark.triangle.fill"
        }
        if caption.contains("transcribing") {
            return "waveform.badge.magnifyingglass"
        }
        return "waveform"
    }

    private func horizontalPadding(for width: CGFloat) -> CGFloat {
        min(max(width * 0.055, 16), 28)
    }

    private func composerBottomPadding(for safeAreaBottom: CGFloat, isFocused: Bool) -> CGFloat {
        if isFocused {
            return 6
        }
        return -10
    }

    private func submitDraft() {
        store.sendDraft()
        isInputFocused = false
    }

    private func requestHistoryAutoLoadIfNeeded() {
        guard store.historyHasMore, !store.historyLoadingMore else { return }
        DispatchQueue.main.async {
            requestHistoryLoad()
        }
    }

    private func requestHistoryLoad() {
        guard store.historyHasMore, !store.historyLoadingMore else { return }
        pendingHistoryAnchorMessageID = topVisibleMessageID ?? store.messages.first?.id
        store.loadMoreHistory()
    }

    private func topPadding(for safeAreaTop: CGFloat) -> CGFloat {
        0
    }

}

private struct VisibleMessageFrame: Equatable {
    let id: String
    let minY: CGFloat
    let maxY: CGFloat
}

private struct VisibleMessageFramesPreferenceKey: PreferenceKey {
    static var defaultValue: [VisibleMessageFrame] = []

    static func reduce(value: inout [VisibleMessageFrame], nextValue: () -> [VisibleMessageFrame]) {
        value.append(contentsOf: nextValue())
    }
}

private struct BubbleCard<Content: View>: View {
    let role: ChatRole
    let cornerRadius: CGFloat
    let fillColor: Color
    let strokeColor: Color
    let shadowColor: Color
    let glassTint: Color
    @ViewBuilder let content: Content

    @State private var isPressed = false
    @State private var releaseTask: Task<Void, Never>?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        content
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background {
                shape
                    .fill(.clear)
                    .glassEffect(.regular.tint(glassTint).interactive(), in: shape)
                    .overlay {
                        shape.fill(fillColor.opacity(fillOpacity))
                    }
                    .overlay {
                        shape.fill(
                            LinearGradient(
                                colors: [
                                    .white.opacity(highlightOpacity),
                                    .white.opacity(role == .user ? 0.06 : 0.03),
                                    .clear,
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    }
                    .overlay {
                        shape.stroke(strokeColor, lineWidth: 1)
                    }
            }
            .scaleEffect(x: isPressed ? 0.985 : 1, y: isPressed ? 0.97 : 1)
            .offset(y: isPressed ? 1.5 : 0)
            .shadow(color: shadowColor.opacity(isPressed ? 0.55 : 1), radius: isPressed ? 6 : 10, x: 0, y: isPressed ? 2 : 4)
            .contentShape(shape)
            .animation(.spring(response: 0.26, dampingFraction: 0.62), value: isPressed)
            .onLongPressGesture(minimumDuration: 0, maximumDistance: 36, pressing: { pressing in
                releaseTask?.cancel()
                if pressing {
                    isPressed = true
                } else {
                    releaseTask = Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 90_000_000)
                        guard !Task.isCancelled else { return }
                        isPressed = false
                    }
                }
            }, perform: {})
            .onDisappear {
                releaseTask?.cancel()
            }
    }

    private var fillOpacity: Double {
        switch role {
        case .user:
            return 0.54
        case .remi:
            return 0.34
        case .sys:
            return 0.24
        case .error:
            return 0.40
        }
    }

    private var highlightOpacity: Double {
        switch role {
        case .user:
            return 0.26
        case .remi:
            return 0.22
        case .sys:
            return 0.18
        case .error:
            return 0.14
        }
    }
}

private struct TypingDotsView: View {
    let accent: Color
    @State private var activeIndex = 0

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(accent.opacity(activeIndex == index ? 0.92 : 0.32))
                    .frame(width: 7, height: 7)
                    .scaleEffect(activeIndex == index ? 1.1 : 0.82)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: activeIndex)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 260_000_000)
                activeIndex = (activeIndex + 1) % 3
            }
        }
    }
}

private struct DuplexVoiceDemoView: View {
    @ObservedObject var store: RemiChatStore
    @Binding var isPresented: Bool
    @Environment(\.colorScheme) private var colorScheme
    @State private var pulseOuter = false
    @State private var pulseInner = false
    @State private var orbitalDrift = false

    private let recentLimit = 4

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                backgroundLayer
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    topBar(safeAreaTop: proxy.safeAreaInsets.top)
                    Spacer(minLength: 20)
                    presenceStage(width: proxy.size.width)
                    Spacer(minLength: 24)
                    bottomPanel(safeAreaBottom: proxy.safeAreaInsets.bottom)
                }
                .padding(.horizontal, horizontalPadding(for: proxy.size.width))
                .padding(.bottom, max(18, proxy.safeAreaInsets.bottom))
            }
        }
        .onAppear {
            store.enterDuplexMode()
            withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) {
                pulseOuter = true
            }
            withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) {
                pulseInner = true
            }
            withAnimation(.easeInOut(duration: 6.0).repeatForever(autoreverses: true)) {
                orbitalDrift = true
            }
        }
        .onDisappear {
            store.exitDuplexMode()
        }
    }

    private var backgroundLayer: some View {
        ZStack {
            LinearGradient(
                colors: colorScheme == .dark
                    ? [
                        Color(red: 0.04, green: 0.06, blue: 0.09),
                        Color(red: 0.07, green: 0.10, blue: 0.15),
                        Color(red: 0.11, green: 0.16, blue: 0.20),
                      ]
                    : [
                        Color(red: 0.96, green: 0.98, blue: 0.99),
                        Color(red: 0.88, green: 0.93, blue: 0.97),
                        Color(red: 0.81, green: 0.90, blue: 0.93),
                      ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Circle()
                .fill(Color(red: 0.18, green: 0.66, blue: 0.63).opacity(colorScheme == .dark ? 0.28 : 0.18))
                .frame(width: 320, height: 320)
                .blur(radius: 32)
                .offset(x: orbitalDrift ? -110 : -160, y: orbitalDrift ? -210 : -260)

            Circle()
                .fill(Color(red: 0.99, green: 0.58, blue: 0.34).opacity(colorScheme == .dark ? 0.18 : 0.14))
                .frame(width: 360, height: 360)
                .blur(radius: 44)
                .offset(x: orbitalDrift ? 140 : 190, y: orbitalDrift ? 220 : 180)

            Ellipse()
                .fill(.white.opacity(colorScheme == .dark ? 0.05 : 0.26))
                .frame(width: 400, height: 220)
                .blur(radius: 80)
                .rotationEffect(.degrees(-18))
                .offset(x: 80, y: -130)
        }
    }

    private func topBar(safeAreaTop: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Rem Voice")
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                    .foregroundStyle(primaryTextColor)

                Text("Independent duplex demo mode")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(secondaryTextColor)
            }

            Spacer(minLength: 12)

            HStack(spacing: 8) {
                Circle()
                    .fill(connectionColor.opacity(0.92))
                    .frame(width: 8, height: 8)

                Text(store.connectionPhase == .open ? "Live Duplex" : store.connectionPhase.label)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(primaryTextColor)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.24), in: Capsule())

            Button(action: {
                isPresented = false
            }) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(primaryTextColor)
                    .frame(width: 34, height: 34)
                    .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.28), in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.top, max(16, safeAreaTop + 6))
    }

    private func presenceStage(width: CGFloat) -> some View {
        VStack(spacing: 22) {
            ZStack {
                Circle()
                    .stroke(Color.white.opacity(colorScheme == .dark ? 0.11 : 0.30), lineWidth: 1)
                    .frame(width: orbOuterDiameter(for: width), height: orbOuterDiameter(for: width))
                    .scaleEffect(pulseOuter ? 1.06 : 0.94)
                    .opacity(pulseOuter ? 0.88 : 0.44)

                Circle()
                    .stroke(Color(red: 0.14, green: 0.60, blue: 0.55).opacity(0.34), lineWidth: 24)
                    .frame(width: orbMidDiameter(for: width), height: orbMidDiameter(for: width))
                    .blur(radius: 10)
                    .scaleEffect(pulseInner ? 1.04 : 0.97)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.white.opacity(colorScheme == .dark ? 0.82 : 0.92),
                                Color(red: 0.20, green: 0.68, blue: 0.62).opacity(colorScheme == .dark ? 0.74 : 0.62),
                                Color(red: 0.08, green: 0.18, blue: 0.22).opacity(colorScheme == .dark ? 0.90 : 0.50),
                            ],
                            center: .topLeading,
                            startRadius: 10,
                            endRadius: orbCoreDiameter(for: width) * 0.6
                        )
                    )
                    .frame(width: orbCoreDiameter(for: width), height: orbCoreDiameter(for: width))
                    .shadow(color: Color(red: 0.09, green: 0.46, blue: 0.43).opacity(0.24), radius: 26, x: 0, y: 16)

                Circle()
                    .trim(from: 0.14, to: 0.56)
                    .stroke(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.0),
                                Color.white.opacity(0.68),
                                Color(red: 0.99, green: 0.56, blue: 0.34).opacity(0.84),
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        ),
                        style: StrokeStyle(lineWidth: 4, lineCap: .round)
                    )
                    .frame(width: orbCoreDiameter(for: width) + 28, height: orbCoreDiameter(for: width) + 28)
                    .rotationEffect(.degrees(orbitalDrift ? 118 : 18))

                VStack(spacing: 6) {
                    Text("Rem")
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.96))

                    Text(store.emotion.capitalized)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.72))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(.black.opacity(0.14), in: Capsule())
                }
            }

            VStack(spacing: 10) {
                Text(duplexHeadline)
                    .font(.system(size: 22, weight: .semibold, design: .rounded))
                    .foregroundStyle(primaryTextColor)
                    .multilineTextAlignment(.center)

                Text(duplexSubheadline)
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(secondaryTextColor)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            .padding(.horizontal, 12)
        }
    }

    private func bottomPanel(safeAreaBottom: CGFloat) -> some View {
        VStack(spacing: 14) {
            transcriptPanel

            HStack(spacing: 10) {
                Label(store.duplexEnabled ? "Listening lane open" : "Voice lane idle", systemImage: "waveform")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(primaryTextColor)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(.white.opacity(colorScheme == .dark ? 0.08 : 0.24), in: Capsule())

                Spacer(minLength: 10)

                Button(action: {
                    isPresented = false
                }) {
                    Text("Leave Voice")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(accentColor, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(18)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(.white.opacity(colorScheme == .dark ? 0.12 : 0.34), lineWidth: 1)
        )
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.16 : 0.08), radius: 24, x: 0, y: 12)
        .padding(.bottom, max(0, safeAreaBottom * 0.15))
    }

    private var transcriptPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Live Thread")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(primaryTextColor)

                Spacer(minLength: 10)

                Text(store.voiceTranscriptPreview.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Waiting for speech" : "Transcript active")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(secondaryTextColor)
            }

            if recentMessages.isEmpty {
                Text("Start speaking and this panel will pin the latest thread turns for the demo scene.")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(secondaryTextColor)
                    .lineSpacing(2)
            } else {
                VStack(spacing: 10) {
                    ForEach(recentMessages) { message in
                        HStack(alignment: .top, spacing: 10) {
                            Text(message.role == .user ? "You" : message.role == .remi ? "Rem" : "System")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(message.role == .user ? accentColor : secondaryTextColor)
                                .frame(width: 42, alignment: .leading)

                            Text(message.text)
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(primaryTextColor)
                                .lineLimit(2)

                            Spacer(minLength: 0)
                        }
                    }
                }
            }
        }
    }

    private var recentMessages: [ChatMessage] {
        Array(store.messages.suffix(recentLimit))
    }

    private var duplexHeadline: String {
        if store.connectionPhase != .open {
            return "Reconnecting Rem..."
        }
        if store.voiceRecording {
            return "Rem is present and listening."
        }
        return "Warming up the duplex lane."
    }

    private var duplexSubheadline: String {
        let caption = store.voiceStatusCaption.trimmingCharacters(in: .whitespacesAndNewlines)
        if !caption.isEmpty {
            return caption
        }
        let transcript = store.voiceTranscriptPreview.trimmingCharacters(in: .whitespacesAndNewlines)
        if !transcript.isEmpty {
            return transcript
        }
        return "This is the dedicated voice-mode demo shell. 3D Rem can slot into the center stage later without changing the duplex flow."
    }

    private var primaryTextColor: Color {
        colorScheme == .dark ? .white.opacity(0.96) : Color.black.opacity(0.88)
    }

    private var secondaryTextColor: Color {
        colorScheme == .dark ? .white.opacity(0.68) : Color.black.opacity(0.56)
    }

    private var accentColor: Color {
        colorScheme == .dark
            ? Color(red: 0.28, green: 0.72, blue: 0.66)
            : Color(red: 0.14, green: 0.58, blue: 0.52)
    }

    private var connectionColor: Color {
        switch store.connectionPhase {
        case .open:
            return Color(red: 0.24, green: 0.82, blue: 0.56)
        case .connecting:
            return Color(red: 0.96, green: 0.68, blue: 0.28)
        case .closed:
            return Color.white.opacity(0.42)
        }
    }

    private func horizontalPadding(for width: CGFloat) -> CGFloat {
        min(max(width * 0.07, 18), 32)
    }

    private func orbOuterDiameter(for width: CGFloat) -> CGFloat {
        min(max(width * 0.72, 248), 320)
    }

    private func orbMidDiameter(for width: CGFloat) -> CGFloat {
        orbOuterDiameter(for: width) * 0.78
    }

    private func orbCoreDiameter(for width: CGFloat) -> CGFloat {
        orbOuterDiameter(for: width) * 0.56
    }
}

#Preview {
    ChatView()
}
