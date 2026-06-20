import SwiftUI

/// Organic blob silhouette — a circle deformed by a few rotating sine harmonics,
/// so it wobbles like a living droplet instead of a rounded rectangle.
///
/// `phase` (0…1) loops **seamlessly**: every time-varying term is an integer
/// multiple of `2π·phase`, so the silhouette at phase 1 equals phase 0 with no
/// jump when `RemiBlobView` wraps the morph clock back to 0.
struct RemiBlobShape: Shape {
    /// 0…1 drives the morph; loops seamlessly.
    var phase: CGFloat
    /// Bulge depth as a fraction of the radius. Higher = more liquid/organic.
    var amplitude: CGFloat = 0.085

    var animatableData: CGFloat {
        get { phase }
        set { phase = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let a = phase * 2 * .pi
        // Keep the widest bulge inside `rect`: shrink the base radius so the peak
        // (1 + Σ|coeffs|)·baseR never exceeds the half-dimension and clips.
        let maxBulge = amplitude * (1 + 0.6 + 0.4)
        let r0 = min(rect.width, rect.height) / 2
        let baseR = r0 / (1 + maxBulge)
        let center = CGPoint(x: rect.midX, y: rect.midY)

        let count = 72
        var pts: [CGPoint] = []
        pts.reserveCapacity(count)
        for i in 0..<count {
            let theta = CGFloat(i) / CGFloat(count) * 2 * .pi
            let r = baseR * (1
                + amplitude * sin(3 * theta + a)
                + amplitude * 0.6 * sin(5 * theta - 2 * a)
                + amplitude * 0.4 * sin(2 * theta + a))
            pts.append(CGPoint(x: center.x + r * cos(theta), y: center.y + r * sin(theta)))
        }

        // Smooth closed curve: quadratic segments through edge midpoints, each
        // raw point used as the control handle — gives a clean rounded silhouette.
        var path = Path()
        path.move(to: midpoint(pts[count - 1], pts[0]))
        for i in 0..<count {
            let curr = pts[i]
            let next = pts[(i + 1) % count]
            path.addQuadCurve(to: midpoint(curr, next), control: curr)
        }
        path.closeSubpath()
        return path
    }

    private func midpoint(_ p: CGPoint, _ q: CGPoint) -> CGPoint {
        CGPoint(x: (p.x + q.x) / 2, y: (p.y + q.y) / 2)
    }
}
