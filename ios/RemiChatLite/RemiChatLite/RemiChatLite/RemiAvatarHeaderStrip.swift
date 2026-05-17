import SwiftUI

struct RemiAvatarHeaderStrip: View {
    @ObservedObject var avatarState: RemiAvatarStateStore
    let connectionPhase: ConnectionPhase
    let showSignOutButton: Bool
    let onSignOut: (() -> Void)?
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 10) {
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

            VStack(alignment: .leading, spacing: 1) {
                Text("Remi")
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))

                Text(avatarState.companionLine)
                    .font(.system(size: 10, weight: .regular, design: .rounded))
                    .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))
                    .lineLimit(1)
            }

            Spacer(minLength: 10)

            HStack(spacing: 8) {
                Text(avatarState.presenceLabel)
                    .font(.system(size: 10, weight: .regular, design: .rounded))
                    .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(.white.opacity(colorScheme == .dark ? 0.07 : 0.30), in: Capsule())

                if showSignOutButton, let onSignOut {
                    Button("Sign Out", action: onSignOut)
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(.white.opacity(colorScheme == .dark ? 0.07 : 0.24), in: Capsule())
                        .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(minHeight: 48)
        .glassEffect(.regular.tint(RemiDesignTokens.strongGlassTint(colorScheme)).interactive(), in: RoundedRectangle(cornerRadius: RemiDesignTokens.surfaceCornerRadius, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: RemiDesignTokens.surfaceCornerRadius, style: .continuous)
                .fill(.white.opacity(colorScheme == .dark ? 0.08 : 0.22))
        )
    }
}
