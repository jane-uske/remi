import SwiftUI

struct BubbleCard<Content: View>: View {
    let role: ChatRole
    let cornerRadius: CGFloat
    let fillColor: Color
    let strokeColor: Color
    let shadowColor: Color
    let glassTint: Color
    @ViewBuilder let content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        content
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background {
                shape
                    .fill(.clear)
                    .glassEffect(.regular.tint(glassTint), in: shape)
                    .overlay {
                        shape.fill(fillColor.opacity(fillOpacity))
                    }
                    .overlay {
                        shape.fill(
                            LinearGradient(
                                colors: [
                                    .white.opacity(highlightOpacity),
                                    .white.opacity(role == .user ? 0.06 : 0.03),
                                    .clear,
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    }
                    .overlay {
                        shape.stroke(strokeColor, lineWidth: 1)
                    }
            }
            .shadow(color: shadowColor, radius: 10, x: 0, y: 4)
    }

    private var fillOpacity: Double {
        switch role {
        case .user:  0.54
        case .remi:  0.26
        case .sys:   0.20
        case .error: 0.40
        }
    }

    private var highlightOpacity: Double {
        switch role {
        case .user:  0.26
        case .remi:  0.22
        case .sys:   0.18
        case .error: 0.14
        }
    }
}

struct TypingDotsView: View {
    let accent: Color
    @State private var activeIndex = 0

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(accent.opacity(activeIndex == index ? 0.92 : 0.32))
                    .frame(width: 7, height: 7)
                    .scaleEffect(activeIndex == index ? 1.1 : 0.82)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: activeIndex)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 260_000_000)
                activeIndex = (activeIndex + 1) % 3
            }
        }
    }
}

enum RemiChatBubbleStyle {

    static func bubbleColor(for role: ChatRole, colorScheme: ColorScheme) -> Color {
        switch role {
        case .user:
            return Color(red: 0.13, green: 0.56, blue: 0.50)
        case .remi:
            return colorScheme == .dark ? Color.white.opacity(0.10) : Color.white.opacity(0.36)
        case .error:
            return Color(red: 0.73, green: 0.17, blue: 0.20).opacity(colorScheme == .dark ? 0.35 : 0.18)
        case .sys:
            return colorScheme == .dark ? Color.white.opacity(0.08) : Color.white.opacity(0.30)
        }
    }

    static func textColor(for role: ChatRole, colorScheme: ColorScheme) -> Color {
        switch role {
        case .user:
            return .white
        case .error:
            return colorScheme == .dark ? .white.opacity(0.92) : Color(red: 0.46, green: 0.07, blue: 0.11)
        case .remi, .sys:
            return RemiDesignTokens.primaryText(colorScheme)
        }
    }

    static func strokeColor(for role: ChatRole, colorScheme: ColorScheme) -> Color {
        switch role {
        case .user:
            return .white.opacity(0.14)
        case .remi, .sys:
            return .white.opacity(colorScheme == .dark ? 0.12 : 0.30)
        case .error:
            return Color.white.opacity(colorScheme == .dark ? 0.10 : 0.36)
        }
    }

    static func glassTint(for role: ChatRole, colorScheme: ColorScheme) -> Color {
        let accent = RemiDesignTokens.accent(colorScheme)
        switch role {
        case .user:
            return accent.opacity(colorScheme == .dark ? 0.26 : 0.34)
        case .remi:
            return .white.opacity(colorScheme == .dark ? 0.18 : 0.36)
        case .sys:
            return .white.opacity(colorScheme == .dark ? 0.14 : 0.28)
        case .error:
            return Color(red: 0.73, green: 0.17, blue: 0.20).opacity(colorScheme == .dark ? 0.24 : 0.18)
        }
    }

    static func shadowColor(for role: ChatRole, colorScheme: ColorScheme) -> Color {
        switch role {
        case .user:
            return Color(red: 0.05, green: 0.34, blue: 0.28).opacity(colorScheme == .dark ? 0.10 : 0.08)
        case .remi, .sys, .error:
            return .black.opacity(colorScheme == .dark ? 0.08 : 0.04)
        }
    }
}
