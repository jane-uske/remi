import SwiftUI

struct RemiCompanionView: View {
    @ObservedObject var store: RemiChatStore
    let identityKey: String
    let showSignOutButton: Bool
    let onSignOut: (() -> Void)?

    @StateObject private var avatarState: RemiAvatarStateStore
    @StateObject private var renderer = RemiLive2DRenderer()
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var isInputFocused: Bool
    @State private var chatSheetFraction: CGFloat = 0.4

    private let stageMinFraction: CGFloat = 0.15
    private let stageMaxFraction: CGFloat = 0.65

    init(store: RemiChatStore, identityKey: String, showSignOutButton: Bool, onSignOut: (() -> Void)?) {
        self.store = store
        self.identityKey = identityKey
        self.showSignOutButton = showSignOutButton
        self.onSignOut = onSignOut
        _avatarState = StateObject(wrappedValue: RemiAvatarStateStore(chatStore: store))
    }

    var body: some View {
        GeometryReader { proxy in
            let stageHeight = proxy.size.height * (1 - chatSheetFraction)

            ZStack {
                backgroundLayer.ignoresSafeArea()

                VStack(spacing: 0) {
                    RemiAvatarStageView(
                        avatarState: avatarState,
                        renderer: renderer,
                        connectionPhase: store.connectionPhase
                    )
                    .frame(height: max(stageHeight, 56))
                    .clipped()

                    chatSheet(width: proxy.size.width, safeAreaBottom: proxy.safeAreaInsets.bottom)
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if chatSheetFraction > 0.85 {
                    RemiAvatarHeaderStrip(
                        avatarState: avatarState,
                        connectionPhase: store.connectionPhase,
                        showSignOutButton: showSignOutButton,
                        onSignOut: onSignOut
                    )
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { isInputFocused = false }
        }
        .onAppear {
            renderer.lipSyncEngine = store.lipSyncEngine
            store.start()
        }
        .onChange(of: identityKey) { _, _ in
            store.restartForIdentityChangeIfNeeded()
        }
        .onChange(of: scenePhase) { _, newPhase in
            renderer.setSceneActive(newPhase == .active)
        }
        .onDisappear { store.stop() }
    }

    private func chatSheet(width: CGFloat, safeAreaBottom: CGFloat) -> some View {
        VStack(spacing: 0) {
            dragHandle
            chatContent(width: width)
            inputBar(width: width, safeAreaBottom: safeAreaBottom)
        }
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(.ultraThinMaterial)
                .ignoresSafeArea(edges: .bottom)
        )
        .gesture(sheetDragGesture)
    }

    private var dragHandle: some View {
        Capsule()
            .fill(RemiDesignTokens.secondaryText(colorScheme).opacity(0.4))
            .frame(width: 36, height: 4)
            .padding(.vertical, 8)
    }

    private var sheetDragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                let delta = -value.translation.height / UIScreen.main.bounds.height
                let newFraction = chatSheetFraction + delta
                chatSheetFraction = min(max(newFraction, 1 - stageMaxFraction), 1 - stageMinFraction)
            }
            .onEnded { value in
                let velocity = -value.predictedEndTranslation.height / UIScreen.main.bounds.height
                let target = chatSheetFraction + velocity * 0.3
                let snap: CGFloat
                if target > 0.75 {
                    snap = 1 - stageMinFraction
                } else if target < 0.45 {
                    snap = 1 - stageMaxFraction
                } else {
                    snap = 0.55
                }
                withAnimation(.spring(response: 0.4, dampingFraction: 0.82)) {
                    chatSheetFraction = snap
                }
            }
    }

    private func chatContent(width: CGFloat) -> some View {
        RemiChatSheetView(
            store: store,
            isInputFocused: $isInputFocused,
            horizontalPadding: RemiDesignTokens.horizontalPadding(for: width)
        )
    }

    private func inputBar(width: CGFloat, safeAreaBottom: CGFloat) -> some View {
        RemiCompanionInputBar(
            store: store,
            isInputFocused: $isInputFocused
        )
        .padding(.horizontal, RemiDesignTokens.horizontalPadding(for: width))
        .padding(.top, 8)
        .padding(.bottom, isInputFocused ? 6 : max(safeAreaBottom, 8))
    }

    private var backgroundLayer: some View {
        ZStack {
            LinearGradient(
                colors: RemiDesignTokens.backgroundStops(colorScheme),
                startPoint: .top,
                endPoint: .bottom
            )

            // Volumetric stage light — soft depth glow centred on the avatar.
            RadialGradient(
                colors: [RemiDesignTokens.stageHaloColor(colorScheme), .clear],
                center: UnitPoint(x: 0.5, y: 0.34),
                startRadius: 8,
                endRadius: 540
            )
            .blendMode(colorScheme == .dark ? .screen : .plusLighter)
        }
    }
}

struct RemiCompanionInputBar: View {
    @ObservedObject var store: RemiChatStore
    var isInputFocused: FocusState<Bool>.Binding
    @Environment(\.colorScheme) private var colorScheme
    @State private var isPushToTalkPressing = false

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            duplexButton
            pushToTalkButton

            TextField("Say something to Remi...", text: $store.draft, axis: .vertical)
                .lineLimit(1...4)
                .font(.system(size: 16, weight: .regular, design: .rounded))
                .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
                .focused(isInputFocused)
                .submitLabel(.send)
                .onSubmit { submitDraft() }

            Button(action: { submitDraft() }) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(RemiDesignTokens.accent(colorScheme), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("发送")
            .accessibilityHint("发送当前输入的消息")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: RemiDesignTokens.surfaceMinHeight)
        .glassEffect(.regular.tint(RemiDesignTokens.strongGlassTint(colorScheme)).interactive(), in: RoundedRectangle(cornerRadius: RemiDesignTokens.surfaceCornerRadius, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: RemiDesignTokens.surfaceCornerRadius, style: .continuous)
                .fill(.white.opacity(colorScheme == .dark ? 0.09 : 0.24))
        )
    }

    private var duplexButton: some View {
        let active = store.duplexEnabled
        let disabled = !active && (store.pushToTalkRecording || store.pushToTalkAwaitingResult || isPushToTalkPressing)
        return Button(action: {
            isInputFocused.wrappedValue = false
            store.enterDuplexMode()
        }) {
            ZStack {
                Circle()
                    .fill(active ? RemiDesignTokens.accent(colorScheme).opacity(0.18) : .white.opacity(colorScheme == .dark ? 0.08 : 0.34))
                    .frame(width: 30, height: 30)
                Image(systemName: active ? "dot.radiowaves.left.and.right" : "waveform")
                    .font(.system(size: active ? 15 : 13, weight: .semibold))
                    .foregroundStyle(active ? RemiDesignTokens.accent(colorScheme) : RemiDesignTokens.primaryText(colorScheme).opacity(0.92))
            }
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.42 : 1)
        .accessibilityLabel("全双工语音")
        .accessibilityValue(active ? "已开启" : "已关闭")
        .accessibilityHint("开启后可随时说话，无需按住")
    }

    private var pushToTalkButton: some View {
        let active = store.pushToTalkRecording || isPushToTalkPressing
        let disabled = store.duplexEnabled || store.pushToTalkAwaitingResult
        return ZStack {
            Circle()
                .fill(active ? RemiDesignTokens.accent(colorScheme).opacity(0.18) : .white.opacity(colorScheme == .dark ? 0.08 : 0.34))
                .frame(width: 30, height: 30)
            Image(systemName: active ? "mic.circle.fill" : "mic.fill")
                .font(.system(size: active ? 16 : 13, weight: .semibold))
                .foregroundStyle(active ? RemiDesignTokens.accent(colorScheme) : RemiDesignTokens.primaryText(colorScheme).opacity(0.92))
        }
        .opacity(disabled ? 0.42 : 1)
        .contentShape(Circle())
        .allowsHitTesting(!disabled)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !disabled, !isPushToTalkPressing else { return }
                    isPushToTalkPressing = true
                    isInputFocused.wrappedValue = false
                    store.beginPushToTalk()
                }
                .onEnded { _ in
                    guard isPushToTalkPressing else { return }
                    isPushToTalkPressing = false
                    store.endPushToTalk()
                }
        )
        .accessibilityElement()
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("按住说话")
        .accessibilityValue(active ? "录音中" : "")
        .accessibilityHint(disabled ? "全双工开启时不可用" : "双击并按住开始录音，松开发送")
    }

    private func submitDraft() {
        store.sendDraft()
        isInputFocused.wrappedValue = false
    }
}
