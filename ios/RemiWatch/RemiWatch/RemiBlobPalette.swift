import SwiftUI

/// Color tokens from `Remi Watch · Blob.dc.html` (暖阳 palette).
enum RemiBlobPalette {
    static let warm = Color(red: 1.0, green: 0.69, blue: 0.49)   // #FFB07E
    static let mid = Color(red: 0.88, green: 0.48, blue: 0.78)    // #E07AC8
    static let cool = Color(red: 0.36, green: 0.47, blue: 0.89)   // #5B78E2
    static let cream = Color(red: 1.0, green: 0.89, blue: 0.78)   // #FFE3C6
    static let ink = Color(red: 0.96, green: 0.95, blue: 0.93)    // #F4F1EE
    static let inkMuted = Color(red: 0.96, green: 0.95, blue: 0.93).opacity(0.55)
    static let accentPeach = Color(red: 1.0, green: 0.72, blue: 0.57) // #FFB892
    static let badgeText = Color(red: 1.0, green: 0.80, blue: 0.66)   // #FFCBA8

    static var blobGradient: LinearGradient {
        LinearGradient(
            colors: [cream, warm, mid, cool],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static var waveGradient: LinearGradient {
        LinearGradient(colors: [warm, cool], startPoint: .top, endPoint: .bottom)
    }
}