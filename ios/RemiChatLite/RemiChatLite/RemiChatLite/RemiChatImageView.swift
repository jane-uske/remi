import SwiftUI

// MARK: - Inline Image Parsing

enum RemiChatImageParser {
    /// Regex matching markdown image syntax: ![alt](url)
    private static let imgPattern = try! NSRegularExpression(
        pattern: #"!\[([^\]]*)\]\(([^)]+)\)"#,
        options: []
    )

    /// Only render images from the trusted ComfyUI proxy endpoint.
    private static let trustedPrefix = "/api/comfyui/view"

    /// A segment of message content — either plain text or a trusted image.
    enum Segment: Identifiable {
        case text(String)
        case image(alt: String, url: URL)

        var id: String {
            switch self {
            case .text(let s): "t:\(s.prefix(32))"
            case .image(_, let url): "i:\(url.absoluteString)"
            }
        }
    }

    /// Parse a message's text into an array of text and image segments.
    /// Only images from `trustedPrefix` are kept; others are stripped entirely.
    static func parse(_ text: String) -> [Segment] {
        let nsText = text as NSString
        let matches = imgPattern.matches(in: text, range: NSRange(location: 0, length: nsText.length))

        guard !matches.isEmpty else {
            return [.text(text)]
        }

        var segments: [Segment] = []
        var lastEnd = 0

        for match in matches {
            let matchRange = match.range
            // Text before this match
            if matchRange.location > lastEnd {
                let before = nsText.substring(with: NSRange(location: lastEnd, length: matchRange.location - lastEnd))
                let trimmed = before.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { segments.append(.text(trimmed)) }
            }

            let alt = nsText.substring(with: match.range(at: 1))
            let src = nsText.substring(with: match.range(at: 2))

            // Only keep trusted image URLs.
            if src.hasPrefix(trustedPrefix), let fullURL = resolveImageURL(src) {
                segments.append(.image(alt: alt, url: fullURL))
            }
            // Untrusted images are silently dropped (same as web).

            lastEnd = matchRange.location + matchRange.length
        }

        // Trailing text
        if lastEnd < nsText.length {
            let trailing = nsText.substring(from: lastEnd).trimmingCharacters(in: .whitespacesAndNewlines)
            if !trailing.isEmpty { segments.append(.text(trailing)) }
        }

        return segments
    }

    /// Resolve a relative `/api/...` path to an absolute URL using the server base.
    private static func resolveImageURL(_ path: String) -> URL? {
        let wsURL = RemiChatConfig.wsURLString
        let base = wsURL
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
            .components(separatedBy: "/ws").first ?? wsURL
        return URL(string: base + path)
    }
}

// MARK: - Inline Image View

struct RemiChatInlineImage: View {
    let url: URL
    let alt: String
    @State private var showLightbox = false
    @State private var loadFailed = false

    var body: some View {
        if loadFailed { EmptyView() }
        else {
            Button(action: { showLightbox = true }) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 280, maxHeight: 360)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    case .failure:
                        Color.clear
                            .frame(width: 0, height: 0)
                            .onAppear { loadFailed = true }
                    case .empty:
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(.white.opacity(0.06))
                            .frame(width: 140, height: 180)
                            .overlay {
                                ProgressView()
                            }
                    @unknown default:
                        EmptyView()
                    }
                }
            }
            .buttonStyle(.plain)
            .fullScreenCover(isPresented: $showLightbox) {
                RemiImageLightbox(url: url, alt: alt)
            }
        }
    }
}

// MARK: - Full-Screen Lightbox

struct RemiImageLightbox: View {
    let url: URL
    let alt: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.black.opacity(0.92).ignoresSafeArea()

            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .padding(16)
                case .failure:
                    VStack(spacing: 12) {
                        Image(systemName: "photo.trianglebadge.exclamationmark")
                            .font(.system(size: 48))
                            .foregroundStyle(.white.opacity(0.5))
                        Text("加载失败")
                            .foregroundStyle(.white.opacity(0.6))
                    }
                case .empty:
                    ProgressView()
                        .tint(.white)
                @unknown default:
                    EmptyView()
                }
            }

            VStack {
                HStack {
                    Spacer()
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.white.opacity(0.7))
                            .padding(16)
                    }
                }
                Spacer()
                if !alt.isEmpty {
                    Text(alt)
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(.white.opacity(0.6))
                        .padding(.bottom, 24)
                }
            }
        }
        .onTapGesture { dismiss() }
        .statusBarHidden()
    }
}
