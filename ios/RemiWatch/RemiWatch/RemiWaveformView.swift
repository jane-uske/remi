import SwiftUI

/// Gradient audio bars from the design's `remiWave` animation.
struct RemiWaveformView: View {
    var barCount: Int = 9
    var maxHeight: CGFloat = 28
    var active: Bool = true

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20.0)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(0..<barCount, id: \.self) { index in
                    let phase = t * 2.2 + Double(index) * 0.35
                    let wave = active ? (sin(phase) * 0.5 + 0.5) : 0.25
                    let h = max(4, maxHeight * CGFloat(0.3 + wave * 0.7))
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(RemiBlobPalette.waveGradient)
                        .frame(width: 3, height: h)
                }
            }
            .frame(height: maxHeight, alignment: .bottom)
        }
    }
}