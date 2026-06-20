import SwiftUI

// MARK: - Persona Preset

enum RemiPersonaPreset: String, CaseIterable, Identifiable {
    case remiCore = "remi_core"
    case wittyWarm = "witty_warm"
    case relaxedRoast = "relaxed_roast"
    case playfulAttached = "playful_attached"
    case calmHealing = "calm_healing"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .remiCore:         "🌸 默认 Remi"
        case .wittyWarm:        "✨ 机灵温暖"
        case .relaxedRoast:     "🔥 松弛吐槽"
        case .playfulAttached:  "💕 黏人俏皮"
        case .calmHealing:      "🌿 沉稳治愈"
        }
    }
}

// MARK: - Account Menu View

struct RemiAccountMenuView: View {
    @ObservedObject var store: RemiChatStore
    @ObservedObject var avatarState: RemiAvatarStateStore
    let showSignOutButton: Bool
    let onSignOut: (() -> Void)?
    let onDismiss: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var showSettings = false
    @State private var activePreset: RemiPersonaPreset = .remiCore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    connectionInfoSection
                    personaSection
                    settingsButton
                    if showSignOutButton, let onSignOut {
                        signOutButton(action: onSignOut)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(backgroundGradient.ignoresSafeArea())
            .navigationTitle("账户")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { onDismiss() }
                }
            }
            .sheet(isPresented: $showSettings) {
                RemiSettingsView()
            }
        }
    }

    // MARK: - Connection Info

    private var connectionInfoSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("连接信息")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))

            VStack(spacing: 8) {
                infoPill(label: "状态", value: connectionLabel, color: RemiDesignTokens.connectionColor(for: store.connectionPhase))
                infoPill(label: "情绪", value: avatarState.currentEmotion.displayName, color: nil)
                infoPill(label: "服务器", value: redactedServerURL, color: nil)
                if let userId = store.authSource.currentUserId {
                    infoPill(label: "用户", value: userId, color: nil)
                }
            }
            .padding(14)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private var connectionLabel: String {
        switch store.connectionPhase {
        case .connecting: "连接中"
        case .open:       "已连接"
        case .closed:     "已断开"
        }
    }

    private var redactedServerURL: String {
        let url = RemiChatConfig.wsURLString
        // Redact any token parameter.
        if let range = url.range(of: #"token=[^&]+"#, options: .regularExpression) {
            return url.replacingCharacters(in: range, with: "token=***")
        }
        return url
    }

    private func infoPill(label: String, value: String, color: Color?) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))
                .frame(width: 48, alignment: .leading)
            if let color {
                Circle().fill(color).frame(width: 7, height: 7)
            }
            Text(value)
                .font(.system(size: 13, weight: .regular, design: .monospaced))
                .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
        }
    }

    // MARK: - Persona Section

    private var personaSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("人格预设")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))

            VStack(spacing: 4) {
                ForEach(RemiPersonaPreset.allCases) { preset in
                    Button(action: { selectPreset(preset) }) {
                        HStack {
                            Text(preset.displayName)
                                .font(.system(size: 14, weight: activePreset == preset ? .semibold : .regular, design: .rounded))
                                .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
                            Spacer()
                            if activePreset == preset {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(RemiDesignTokens.accent(colorScheme))
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(
                            activePreset == preset
                                ? RemiDesignTokens.accent(colorScheme).opacity(0.12)
                                : Color.clear,
                            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(10)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func selectPreset(_ preset: RemiPersonaPreset) {
        guard preset != activePreset else { return }
        activePreset = preset
        store.sendJSON([
            "type": "set_persona_preset",
            "presetId": preset.rawValue,
        ])
    }

    // MARK: - Settings & Sign Out Buttons

    private var settingsButton: some View {
        Button(action: { showSettings = true }) {
            HStack {
                Image(systemName: "gearshape")
                Text("服务设置")
            }
            .font(.system(size: 14, weight: .medium, design: .rounded))
            .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func signOutButton(action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                Text("退出登录")
            }
            .font(.system(size: 14, weight: .medium, design: .rounded))
            .foregroundStyle(.red.opacity(0.9))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var backgroundGradient: some View {
        LinearGradient(
            colors: RemiDesignTokens.backgroundStops(colorScheme),
            startPoint: .top,
            endPoint: .bottom
        )
    }
}
