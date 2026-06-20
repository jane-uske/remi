import SwiftUI

/// Organic blob silhouette — interpolates the three keyframes from `remiBlob` CSS.
struct RemiBlobShape: Shape {
    /// 0…1 cycles through morph keyframes.
    var phase: CGFloat

    var animatableData: CGFloat {
        get { phase }
        set { phase = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let w = rect.width
        let h = rect.height
        let t = phase.truncatingRemainder(dividingBy: 1)
        let (tl, tr, br, bl) = cornerRadii(for: t, width: w, height: h)
        return UnevenRoundedRectangle(
            topLeadingRadius: tl,
            bottomLeadingRadius: bl,
            bottomTrailingRadius: br,
            topTrailingRadius: tr
        ).path(in: rect)
    }

    private func cornerRadii(for t: CGFloat, width: CGFloat, height: CGFloat) -> (CGFloat, CGFloat, CGFloat, CGFloat) {
        // CSS border-radius pairs mapped to four SwiftUI corners (approximate).
        let k0: (CGFloat, CGFloat, CGFloat, CGFloat) = (0.42, 0.58, 0.56, 0.44)
        let k1: (CGFloat, CGFloat, CGFloat, CGFloat) = (0.62, 0.38, 0.44, 0.56)
        let k2: (CGFloat, CGFloat, CGFloat, CGFloat) = (0.46, 0.54, 0.62, 0.38)

        let seg = t * 3
        let a: (CGFloat, CGFloat, CGFloat, CGFloat)
        let b: (CGFloat, CGFloat, CGFloat, CGFloat)
        let local: CGFloat
        if seg < 1 {
            a = k0; b = k1; local = seg
        } else if seg < 2 {
            a = k1; b = k2; local = seg - 1
        } else {
            a = k2; b = k0; local = seg - 2
        }

        func lerp(_ x: CGFloat, _ y: CGFloat) -> CGFloat { x + (y - x) * local }
        let scale = min(width, height)
        return (
            lerp(a.0, b.0) * scale,
            lerp(a.1, b.1) * scale,
            lerp(a.2, b.2) * scale,
            lerp(a.3, b.3) * scale
        )
    }
}