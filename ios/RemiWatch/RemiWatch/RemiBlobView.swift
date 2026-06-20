import SwiftUI

/// Animated gradient blob — breathe, morph, float, optional listening rings.
struct RemiBlobView: View {
    enum Size {
        case hero, compact, complication

        var diameter: CGFloat {
            switch self {
            case .hero: return 118
            case .compact: return 72
            case .complication: return 36
            }
        }

        var glowBlur: CGFloat {
            switch self {
            case .hero: return 14
            case .compact: return 10
            case .complication: return 6
            }
        }
    }

    var size: Size = .hero
    var showRings: Bool = false
    var breathePeriod: Double = 5.0
    var morphPeriod: Double = 8.0

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let breathe = 1.0 + 0.07 * sin(t * 2 * .pi / breathePeriod)
            let floatY = -5.0 * sin(t * 2 * .pi / 6.5)
            let morph = CGFloat((t / morphPeriod).truncatingRemainder(dividingBy: 1.0))

            ZStack {
                if showRings {
                    ringLayer(phase: t, delay: 0)
                    ringLayer(phase: t, delay: 1.2)
                }

                ZStack {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [RemiBlobPalette.mid.opacity(0.85), .clear],
                                center: .center,
                                startRadius: 0,
                                endRadius: size.diameter * 0.55
                            )
                        )
                        .blur(radius: size.glowBlur)
                        .opacity(0.8)

                    RemiBlobShape(phase: morph)
                        .fill(RemiBlobPalette.blobGradient)
                        .shadow(color: RemiBlobPalette.cool.opacity(0.25), radius: 8, y: 4)
                        .overlay {
                            RemiBlobShape(phase: morph)
                                .stroke(Color.white.opacity(0.12), lineWidth: 0.5)
                        }
                        .overlay(alignment: .topLeading) {
                            Circle()
                                .fill(
                                    RadialGradient(
                                        colors: [Color.white.opacity(0.75), .clear],
                                        center: .center,
                                        startRadius: 0,
                                        endRadius: size.diameter * 0.12
                                    )
                                )
                                .frame(width: size.diameter * 0.22, height: size.diameter * 0.15)
                                .offset(x: size.diameter * 0.22, y: size.diameter * 0.14)
                                .blur(radius: 1)
                        }
                        .padding(size == .hero ? 4 : 2)
                }
                .scaleEffect(breathe)
                .offset(y: floatY)
            }
            .frame(width: size.diameter + (showRings ? 24 : 0), height: size.diameter + (showRings ? 24 : 0))
        }
    }

    private func ringLayer(phase: TimeInterval, delay: Double) -> some View {
        let local = (phase - delay).truncatingRemainder(dividingBy: 2.4)
        let progress = max(0, min(1, local / 2.4))
        let scale = 0.55 + progress * 1.1
        let opacity = 0.65 * (1 - progress)
        return Circle()
            .stroke(ringColor(delay: delay), lineWidth: 1.5)
            .scaleEffect(scale)
            .opacity(opacity)
            .frame(width: size.diameter, height: size.diameter)
    }

    private func ringColor(delay: Double) -> Color {
        delay < 0.1 ? RemiBlobPalette.warm : RemiBlobPalette.mid
    }
}