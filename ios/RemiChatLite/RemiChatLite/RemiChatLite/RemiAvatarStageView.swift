import SwiftUI

struct RemiAvatarStageView: View {
    @ObservedObject var avatarState: RemiAvatarStateStore
    @ObservedObject var renderer: RemiLive2DRenderer
    let connectionPhase: ConnectionPhase
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            auraBackground
            avatarCanvas
            companionOverlay
        }
    }

    private var auraBackground: some View {
        let emotion = avatarState.currentEmotion
        let startColor = RemiDesignTokens.color(hex: emotion.auraStartHex, alpha: 0.36)
        let endColor = RemiDesignTokens.color(hex: emotion.auraEndHex, alpha: 0.18)

        return ZStack {
            RadialGradient(
                colors: [startColor, endColor, .clear],
                center: .center,
                startRadius: 20,
                endRadius: 200
            )
            .blur(radius: 40)

            Circle()
                .fill(startColor.opacity(0.24))
                .frame(width: 200, height: 200)
                .blur(radius: 60)
        }
        .animation(.easeInOut(duration: 1.2), value: emotion)
    }

    @ViewBuilder
    private var avatarCanvas: some View {
        if renderer.isReady {
            RemiLive2DView(renderer: renderer)
                .allowsHitTesting(false)
        } else if renderer.loadError != nil {
            fallbackPortrait
        } else {
            ProgressView()
                .controlSize(.large)
                .tint(RemiDesignTokens.secondaryText(colorScheme))
        }
    }

    private var fallbackPortrait: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.crop.circle")
                .font(.system(size: 64))
                .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))

            Text("Remi")
                .font(.system(size: 22, weight: .semibold, design: .rounded))
                .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
        }
    }

    private var companionOverlay: some View {
        VStack {
            Spacer()

            VStack(spacing: 6) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(RemiDesignTokens.connectionColor(for: connectionPhase))
                        .frame(width: 6, height: 6)

                    Text(avatarState.presenceLabel)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.ultraThinMaterial, in: Capsule())

                Text(avatarState.companionLine)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .padding(.bottom, 12)
        }
        .animation(.easeInOut(duration: 0.6), value: avatarState.companionLine)
    }
}
