import SwiftUI

struct RemiAvatarStageView: View {
    @ObservedObject var avatarState: RemiAvatarStateStore
    @ObservedObject var renderer: RemiLive2DRenderer
    let connectionPhase: ConnectionPhase
    @Environment(\.colorScheme) private var colorScheme
    @State private var auraBreath = false

    var body: some View {
        ZStack {
            auraBackground
                .offset(y: -20)
            avatarCanvas
                .offset(y: -28)
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
                startRadius: 12,
                endRadius: 260
            )
            .blur(radius: 48)

            Circle()
                .fill(startColor.opacity(0.28))
                .frame(width: 240, height: 240)
                .blur(radius: 72)
        }
        // Living light: a slow ~0.06 Hz breath so presence feels alive, not static.
        .scaleEffect(auraBreath ? 1.06 : 0.97)
        .opacity(auraBreath ? 1.0 : 0.82)
        .animation(.easeInOut(duration: 8).repeatForever(autoreverses: true), value: auraBreath)
        .animation(.easeInOut(duration: 1.2), value: emotion)
        .onAppear { auraBreath = true }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var avatarCanvas: some View {
        if renderer.loadError != nil {
            fallbackPortrait
        } else {
            RemiLive2DView(
                renderer: renderer,
                emotion: avatarState.currentEmotion.rawValue,
                phase: avatarState.avatarPhase,
                lipWeight: avatarState.avatarPhase == .speaking ? 0.34 : 0
            )
                .allowsHitTesting(false)
                .overlay {
                    if !renderer.isReady {
                        ProgressView()
                            .controlSize(.large)
                            .tint(RemiDesignTokens.secondaryText(colorScheme))
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityAddTraits(.isImage)
                .accessibilityLabel("Remi，你的虚拟伙伴")
                .accessibilityValue(renderer.isReady
                    ? "情绪：\(avatarState.currentEmotion.displayName)"
                    : "正在加载")
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
                        .fill(avatarState.turnStateBadgeColor)
                        .frame(width: 6, height: 6)
                        .accessibilityHidden(true)

                    Text(avatarState.presenceLabel)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    avatarState.turnStateBadgeColor.opacity(colorScheme == .dark ? 0.14 : 0.20),
                    in: Capsule()
                )
                .animation(.easeInOut(duration: 0.4), value: avatarState.turnStateBadgeColor)

                Text(avatarState.companionLine)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .padding(.bottom, 12)
            .accessibilityElement(children: .combine)
        }
        .animation(.easeInOut(duration: 0.6), value: avatarState.companionLine)
    }
}
