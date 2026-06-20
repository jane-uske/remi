import SwiftUI

struct RemiAvatarHeaderStrip: View {
    @ObservedObject var store: RemiChatStore
    @ObservedObject var avatarState: RemiAvatarStateStore
    let connectionPhase: ConnectionPhase
    let showSignOutButton: Bool
    let onSignOut: (() -> Void)?
    var nsfwEnabled: Bool = false
    var onMenuTap: (() -> Void)?
    @Environment(\.colorScheme) private var colorScheme

    private var connectionText: String {
        switch connectionPhase {
        case .connecting: "连接中"
        case .open:       "已连接"
        case .closed:     "已断开"
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            // Avatar / connection button — tap opens account menu
            Button(action: { onMenuTap?() }) {
                ZStack {
                    Circle()
                        .fill(.white.opacity(colorScheme == .dark ? 0.06 : 0.40))
                        .frame(width: 30, height: 30)

                    Circle()
                        .fill(RemiDesignTokens.connectionColor(for: connectionPhase).opacity(0.88))
                        .frame(width: 7, height: 7)
                        .offset(x: -8, y: 0)

                    Image(systemName: "sparkles")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(RemiDesignTokens.primaryText(colorScheme).opacity(0.9))
                }
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("账户菜单")
            .accessibilityValue(connectionText)
            .accessibilityHint("点击打开账户菜单和设置")

            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text("Remi")
                        .font(.system(size: 18, weight: .semibold, design: .rounded))
                        .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))

                    if nsfwEnabled {
                        Text("🔞")
                            .font(.system(size: 10))
                            .padding(.horizontal, 4)
                            .padding(.vertical, 2)
                            .background(Color(red: 0.85, green: 0.30, blue: 0.45).opacity(0.24), in: Capsule())
                    }
                }

                Text(avatarState.companionLine)
                    .font(.system(size: 10, weight: .regular, design: .rounded))
                    .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)

            Spacer(minLength: 10)

            // Phase-colored presence capsule
            presenceCapsule
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(minHeight: 48)
        .glassEffect(.regular.tint(RemiDesignTokens.strongGlassTint(colorScheme)).interactive(), in: UnevenRoundedRectangle(bottomLeadingRadius: RemiDesignTokens.surfaceCornerRadius, bottomTrailingRadius: RemiDesignTokens.surfaceCornerRadius, style: .continuous))
        .background(
            UnevenRoundedRectangle(bottomLeadingRadius: RemiDesignTokens.surfaceCornerRadius, bottomTrailingRadius: RemiDesignTokens.surfaceCornerRadius, style: .continuous)
                .fill(.white.opacity(colorScheme == .dark ? 0.10 : 0.26))
                .ignoresSafeArea(edges: .top)
        )
    }

    private var presenceCapsule: some View {
        let badgeColor = connectionPhase == .open
            ? RemiDesignTokens.turnStateColor(for: store.turnState)
            : RemiDesignTokens.connectionColor(for: connectionPhase)

        return Text(avatarState.presenceLabel)
            .font(.system(size: 10, weight: .regular, design: .rounded))
            .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
                badgeColor.opacity(colorScheme == .dark ? 0.18 : 0.24),
                in: Capsule()
            )
            .animation(.easeInOut(duration: 0.4), value: store.turnState)
    }
}
