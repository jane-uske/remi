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
    @State private var chatSheetFraction: CGFloat = 0.2
    @State private var dragStartFraction: CGFloat? = nil
    @State private var showAccountMenu = false

    private let stageMinFraction: CGFloat = 0.15
    private let stageMaxFraction: CGFloat = 0.65
    private let restingFraction: CGFloat = 0.2
    /// Corner radius matching the iPhone's physical screen corners (~44pt).
    private let sheetCornerRadius: CGFloat = 44

    init(store: RemiChatStore, identityKey: String, showSignOutButton: Bool, onSignOut: (() -> Void)?) {
        self.store = store
        self.identityKey = identityKey
        self.showSignOutButton = showSignOutButton
        self.onSignOut = onSignOut
        _avatarState = StateObject(wrappedValue: RemiAvatarStateStore(chatStore: store))
    }

    var body: some View {
        GeometryReader { proxy in
            let effectiveFraction = store.nsfwEnabled ? 1 - stageMinFraction : chatSheetFraction
            let stageHeight = proxy.size.height * (1 - effectiveFraction)

            ZStack {
                backgroundLayer.ignoresSafeArea()

                VStack(spacing: 0) {
                    if !store.nsfwEnabled {
                        ZStack(alignment: .topTrailing) {
                            RemiAvatarStageView(
                                avatarState: avatarState,
                                renderer: renderer,
                                connectionPhase: store.connectionPhase
                            )

                            avatarMenuButton
                                .padding(.top, proxy.safeAreaInsets.top + 8)
                                .padding(.trailing, 14)
                        }
                        .frame(height: max(stageHeight, 56))
                        .clipped()
                        .contentShape(Rectangle())
                        .onTapGesture { isInputFocused = false }
                    }

                    chatSheet(width: proxy.size.width, safeAreaBottom: proxy.safeAreaInsets.bottom)
                }
                .ignoresSafeArea(edges: .top)
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if effectiveFraction > 0.85 || store.nsfwEnabled {
                    RemiAvatarHeaderStrip(
                        store: store,
                        avatarState: avatarState,
                        connectionPhase: store.connectionPhase,
                        showSignOutButton: showSignOutButton,
                        onSignOut: onSignOut,
                        nsfwEnabled: store.nsfwEnabled,
                        onMenuTap: { showAccountMenu = true }
                    )
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
        }
        .sheet(isPresented: $showAccountMenu) {
            RemiAccountMenuView(
                store: store,
                avatarState: avatarState,
                showSignOutButton: showSignOutButton,
                onSignOut: onSignOut,
                onDismiss: { showAccountMenu = false }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
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

    // MARK: - Always-visible menu button

    private var avatarMenuButton: some View {
        Button(action: { showAccountMenu = true }) {
            HStack(spacing: 6) {
                Circle()
                    .fill(RemiDesignTokens.connectionColor(for: store.connectionPhase))
                    .frame(width: 7, height: 7)

                Image(systemName: "gearshape")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.thinMaterial, in: Capsule())
            .overlay(Capsule().stroke(.white.opacity(colorScheme == .dark ? 0.10 : 0.24), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("设置和账户")
        .accessibilityHint("打开账户菜单和服务设置")
    }

    // MARK: - Chat Sheet

    private func chatSheet(width: CGFloat, safeAreaBottom: CGFloat) -> some View {
        VStack(spacing: 0) {
            dragHandle
            chatContent(width: width)
            inputBar(width: width, safeAreaBottom: safeAreaBottom)
        }
        .background {
            UnevenRoundedRectangle(
                topLeadingRadius: sheetCornerRadius,
                topTrailingRadius: sheetCornerRadius,
                style: .continuous
            )
            .fill(.ultraThinMaterial)
            .overlay {
                UnevenRoundedRectangle(
                    topLeadingRadius: sheetCornerRadius,
                    topTrailingRadius: sheetCornerRadius,
                    style: .continuous
                )
                .fill(
                    colorScheme == .dark
                        ? Color.black.opacity(0.30)
                        : Color.white.opacity(0.40)
                )
            }
            .ignoresSafeArea(edges: .bottom)
        }
    }

    private var dragHandle: some View {
        Capsule()
            .fill(RemiDesignTokens.secondaryText(colorScheme).opacity(0.4))
            .frame(width: 36, height: 4)
            .frame(maxWidth: .infinity)
            .frame(height: 28)
            .contentShape(Rectangle())
            .gesture(store.nsfwEnabled ? nil : sheetDragGesture)
    }

    private var sheetDragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                if dragStartFraction == nil {
                    dragStartFraction = chatSheetFraction
                }
                let delta = -value.translation.height / UIScreen.main.bounds.height
                let newFraction = (dragStartFraction ?? chatSheetFraction) + delta
                chatSheetFraction = min(max(newFraction, 1 - stageMaxFraction), 1 - stageMinFraction)
            }
            .onEnded { value in
                let velocity = -value.predictedEndTranslation.height / UIScreen.main.bounds.height
                let target = chatSheetFraction + velocity * 0.3
                let snap: CGFloat
                if target > 0.75 {
                    snap = 1 - stageMinFraction
                } else if target > 0.55 {
                    snap = 0.50
                } else if target > 0.30 {
                    snap = 1 - stageMaxFraction
                } else {
                    snap = restingFraction
                }
                withAnimation(.spring(response: 0.4, dampingFraction: 0.82)) {
                    chatSheetFraction = snap
                }
                dragStartFraction = nil
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
        .padding(.bottom, max(safeAreaBottom, 8))
    }

    private var backgroundLayer: some View {
        ZStack {
            LinearGradient(
                colors: RemiDesignTokens.backgroundStops(colorScheme),
                startPoint: .top,
                endPoint: .bottom
            )

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

// MARK: - Input Bar

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
