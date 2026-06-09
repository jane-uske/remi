import SwiftUI

enum RemiDesignTokens {
    static let surfaceCornerRadius: CGFloat = 22
    static let innerCornerRadius: CGFloat = 18
    static let surfaceMinHeight: CGFloat = 44

    static func primaryText(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? .white.opacity(0.96) : Color.black.opacity(0.88)
    }

    static func secondaryText(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark ? .white.opacity(0.64) : Color.black.opacity(0.54)
    }

    static func accent(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color(red: 0.28, green: 0.72, blue: 0.66)
            : Color(red: 0.14, green: 0.58, blue: 0.52)
    }

    static func glassTint(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color.white.opacity(0.05)
            : Color.white.opacity(0.24)
    }

    static func strongGlassTint(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color.white.opacity(0.12)
            : Color.white.opacity(0.34)
    }

    static func connectionColor(for phase: ConnectionPhase) -> Color {
        switch phase {
        case .open:       .green
        case .connecting: .orange
        case .closed:     .gray
        }
    }

    static func horizontalPadding(for width: CGFloat) -> CGFloat {
        min(max(width * 0.055, 16), 28)
    }

    static func color(hex: UInt, alpha: Double = 1) -> Color {
        Color(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }

    // MARK: - Aurora Glass surfaces
    // Deep, dimensional scene background (night = deep space, day = dawn mist) with a
    // soft volumetric "stage light" so the avatar reads as floating in depth.

    static func backgroundStops(_ colorScheme: ColorScheme) -> [Color] {
        colorScheme == .dark
            ? [
                Color(red: 0.04, green: 0.05, blue: 0.09),
                Color(red: 0.06, green: 0.09, blue: 0.15),
                Color(red: 0.05, green: 0.12, blue: 0.17),
              ]
            : [
                Color(red: 0.97, green: 0.98, blue: 1.00),
                Color(red: 0.90, green: 0.94, blue: 0.98),
                Color(red: 0.85, green: 0.92, blue: 0.94),
              ]
    }

    /// Radial halo behind the whole scene — pulls the eye to the avatar and adds depth.
    static func stageHaloColor(_ colorScheme: ColorScheme) -> Color {
        colorScheme == .dark
            ? Color(red: 0.16, green: 0.45, blue: 0.46).opacity(0.50)
            : Color.white.opacity(0.70)
    }
}
