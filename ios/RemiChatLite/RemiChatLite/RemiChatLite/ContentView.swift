import SwiftUI

struct ChatView: View {
    @StateObject private var store = RemiChatStore()
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var isInputFocused: Bool
    @State private var isMicPressing = false

    private let surfaceCornerRadius: CGFloat = 22
    private let innerCornerRadius: CGFloat = 18
    private let surfaceMinHeight: CGFloat = 44
    private let bottomScrollAnchor = "message-list-bottom-anchor"
    private let focusedMessageBottomInset: CGFloat = 28

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
                            .id(message.id)
                    }

                    Color.clear
                        .frame(height: isInputFocused ? focusedMessageBottomInset : 22)
                        .id(bottomScrollAnchor)
                }
                .padding(.horizontal, horizontalPadding)
                .padding(.top, 8)
                .padding(.bottom, 10)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.24)) {
                    proxy.scrollTo(bottomScrollAnchor, anchor: .bottom)
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
        Button(action: { store.loadMoreHistory() }) {
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
    }

    private var inputBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let voiceStatusText {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: voiceStatusIconName)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(store.voiceRecording ? sendButtonBackground : secondaryTextColor)
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

            HStack(alignment: .center, spacing: 4) {
                micButton

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
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(minHeight: surfaceMinHeight)
        .glassEffect(.regular.tint(strongGlassTint).interactive(), in: RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: surfaceCornerRadius, style: .continuous)
                .fill(.white.opacity(colorScheme == .dark ? 0.09 : 0.24))
        )
    }

    private var micButton: some View {
        let active = store.voiceRecording || isMicPressing
        return ZStack {
            Circle()
                .fill(active ? sendButtonBackground.opacity(0.16) : .white.opacity(colorScheme == .dark ? 0.08 : 0.34))
                .frame(width: 34, height: 34)

            Image(systemName: active ? "waveform.circle.fill" : "mic.fill")
                .font(.system(size: active ? 18 : 15, weight: .semibold))
                .foregroundStyle(active ? sendButtonBackground : primaryTextColor.opacity(0.92))
        }
        .scaleEffect(active ? 1.04 : 1)
        .animation(.easeOut(duration: 0.16), value: active)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !isMicPressing else { return }
                    isMicPressing = true
                    isInputFocused = false
                    store.beginPushToTalk()
                }
                .onEnded { _ in
                    guard isMicPressing else { return }
                    isMicPressing = false
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

            Text(message.text)
                .font(.system(size: 16, weight: .regular, design: .rounded))
                .foregroundStyle(textColor(for: message.role))
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(bubbleBackground(for: message.role))
                .overlay(
                    RoundedRectangle(cornerRadius: innerCornerRadius, style: .continuous)
                        .stroke(bubbleStroke(for: message.role), lineWidth: 1)
                )
                .frame(maxWidth: 320, alignment: message.role == .user ? .trailing : .leading)
                .shadow(color: shadowColor(for: message.role), radius: 10, x: 0, y: 4)

            if message.role != .user {
                Spacer(minLength: 28)
            }
        }
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
        if store.voiceRecording {
            return trimmed.isEmpty ? "Listening... release to send" : trimmed
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
        if store.voiceRecording {
            return "waveform"
        }
        let caption = store.voiceStatusCaption.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
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

    private func topPadding(for safeAreaTop: CGFloat) -> CGFloat {
        0
    }

    @ViewBuilder
    private func bubbleBackground(for role: ChatRole) -> some View {
        let shape = RoundedRectangle(cornerRadius: innerCornerRadius, style: .continuous)

        switch role {
        case .user:
            shape
                .fill(.thinMaterial)
                .overlay {
                    shape.fill(bubbleColor(for: role).opacity(colorScheme == .dark ? 0.58 : 0.72))
                }
        case .remi, .sys:
            shape
                .fill(.ultraThinMaterial)
                .overlay {
                    shape.fill(bubbleColor(for: role))
                }
        case .error:
            shape
                .fill(.thinMaterial)
                .overlay {
                    shape.fill(bubbleColor(for: role))
                }
        }
    }
}

#Preview {
    ChatView()
}
