import SwiftUI

/// Primary watch face from `Remi Watch · Blob.dc.html` — organic blob companion UI.
struct RemiBlobScreen: View {
    @EnvironmentObject private var store: WatchChatStore
    @StateObject private var speech = WatchSpeechInput()
    @Binding var showChat: Bool

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            RadialGradient(
                colors: [Color(red: 1, green: 0.63, blue: 0.47).opacity(0.14), .clear],
                center: UnitPoint(x: 0.5, y: 0.34),
                startRadius: 0,
                endRadius: 140
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 4)
                centerStage
                Spacer(minLength: 2)
                bottomArea
            }
            .padding(.horizontal, 6)
        }
        .onChange(of: speech.isListening) { _, listening in
            store.isListening = listening
        }
    }

    // MARK: - Top

    @ViewBuilder
    private var topBar: some View {
        if store.presencePhase == .speaking, !store.emotion.isEmpty {
            HStack {
                emotionBadge
                Spacer()
            }
            .padding(.top, 4)
        }
    }

    private var emotionBadge: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(RemiBlobPalette.warm)
                .frame(width: 6, height: 6)
                .shadow(color: RemiBlobPalette.warm.opacity(0.8), radius: 3)
            Text(store.emotion)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(RemiBlobPalette.badgeText)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(RemiBlobPalette.warm.opacity(0.14), in: Capsule())
        .overlay(Capsule().stroke(RemiBlobPalette.warm.opacity(0.28), lineWidth: 1))
    }

    // MARK: - Center

    @ViewBuilder
    private var centerStage: some View {
        switch store.presencePhase {
        case .idle, .connecting:
            RemiBlobView(size: .hero, breathePeriod: 5, morphPeriod: 8)
        case .listening, .thinking:
            RemiBlobView(size: .hero, showRings: store.presencePhase == .listening, breathePeriod: 2.6, morphPeriod: 4.5)
        case .speaking:
            VStack(spacing: 10) {
                RemiBlobView(size: .compact, breathePeriod: 1.8, morphPeriod: 4)
                if let reply = store.latestRemiReply {
                    Text(reply)
                        .font(.system(size: 13, weight: .regular, design: .rounded))
                        .foregroundStyle(RemiBlobPalette.ink.opacity(0.92))
                        .multilineTextAlignment(.center)
                        .lineLimit(4)
                        .padding(.horizontal, 8)
                }
            }
        }
    }

    // MARK: - Bottom

    @ViewBuilder
    private var bottomArea: some View {
        switch store.presencePhase {
        case .idle:
            VStack(spacing: 8) {
                Text(greetingTitle)
                    .font(.system(size: 20, weight: .medium, design: .rounded))
                    .foregroundStyle(RemiBlobPalette.ink)
                Text(greetingSubtitle)
                    .font(.system(size: 11.5, weight: .regular, design: .rounded))
                    .foregroundStyle(RemiBlobPalette.inkMuted)
                micButton
            }
            .padding(.bottom, 6)

        case .listening:
            VStack(spacing: 6) {
                RemiWaveformView(maxHeight: 30)
                Text("聆听中…")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(RemiBlobPalette.inkMuted)
                Button { speech.stopDictation() } label: { stopMicButton }
                    .buttonStyle(.plain)
            }
            .padding(.bottom, 8)

        case .thinking:
            VStack(spacing: 8) {
                RemiWaveformView(maxHeight: 22, active: true)
                Text("Remi 在想…")
                    .font(.system(size: 11.5, weight: .medium, design: .rounded))
                    .foregroundStyle(RemiBlobPalette.inkMuted)
            }
            .padding(.bottom, 10)

        case .speaking:
            VStack(spacing: 6) {
                RemiWaveformView(barCount: 7, maxHeight: 20)
                Button {
                    store.ttsEnabled.toggle()
                } label: {
                    Text(store.ttsEnabled ? "Remi 正在说话 · 轻点静音" : "已静音 · 轻点恢复")
                        .font(.system(size: 10.5, weight: .medium, design: .rounded))
                        .foregroundStyle(RemiBlobPalette.inkMuted)
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 8)

        case .connecting:
            Text(statusCaption)
                .font(.caption2)
                .foregroundStyle(RemiBlobPalette.inkMuted)
                .padding(.bottom, 10)
        }
    }

    @ViewBuilder
    private var micButton: some View {
        if speech.useTextFieldLinkFallback {
            TextFieldLink(prompt: Text("说话")) {
                micLabel
            } onSubmit: { text in
                store.send(text)
            }
            .buttonStyle(.plain)
        } else {
            Button {
                speech.startDictation { store.send($0) }
            } label: {
                micLabel
            }
            .buttonStyle(.plain)
            .accessibilityLabel("开始语音听写")
        }
    }

    private var micLabel: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [RemiBlobPalette.warm.opacity(0.3), RemiBlobPalette.cool.opacity(0.3)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(Circle().stroke(Color.white.opacity(0.2), lineWidth: 1))
                .frame(width: 48, height: 48)
            Image(systemName: "mic.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color(red: 1, green: 0.89, blue: 0.82))
        }
    }

    private var stopMicButton: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.3), lineWidth: 1.5)
                .frame(width: 40, height: 40)
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(RemiBlobPalette.warm)
                .frame(width: 13, height: 13)
        }
    }

    // MARK: - Copy helpers

    private var greetingTitle: String {
        let hour = Calendar.current.component(.hour, from: .now)
        switch hour {
        case 5..<12: return "早上好"
        case 12..<18: return "下午好"
        default: return "晚上好"
        }
    }

    private var greetingSubtitle: String {
        switch store.phase {
        case .open: return "我在这儿，和我说说话吧"
        case .connecting: return "正在连接…"
        case .closed: return "离线，重试中…"
        }
    }

    private var statusCaption: String {
        switch store.phase {
        case .open: return store.authMode.isSignedIn ? "已连接" : "已连接 · 本地"
        case .connecting: return "连接中…"
        case .closed: return "离线"
        }
    }

}