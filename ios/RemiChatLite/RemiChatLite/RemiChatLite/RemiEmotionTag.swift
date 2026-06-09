import Foundation

/// Inline emotion markup stripping for the chat display.
///
/// The LLM is prompted to append `<emotion>xxx</emotion>` metadata to the end of
/// every reply so the avatar can react (brain/prompt_builder.ts). That markup is
/// metadata, not content, and must never reach the chat bubble. The web client
/// strips it (web/src/lib/chat/stripEmotionTags.ts) and the desktop app does the
/// same; this is the iOS port.
///
/// `clean(_:)` operates on the *whole accumulated buffer* and is idempotent, so it
/// can be re-run on every streaming chunk. Crucially it suppresses a tag that is
/// still being streamed — an unclosed `<emotion …>` or a partial `<emoti` / lone
/// `<` at the tail — so a tag split across chunk boundaries never flashes in the
/// bubble. This matches the streaming guarantee of `utils/emotion_tag_parser.ts`
/// (and is stricter than the web regex, which can briefly leak a partial prefix).
///
/// The emotion is also delivered out-of-band via `.emotion` / `.avatarIntent` /
/// `chat_end` wire messages, so the inline tag is purely cosmetic leakage — but
/// when a tag *is* present we reuse it as an avatar emotion fallback.
enum RemiEmotionTag {
    /// Canonical emotion vocabulary the server emits (emotion/emotion_state.ts).
    static let validEmotions: Set<String> = [
        "neutral", "happy", "curious", "shy", "sad", "concerned", "playful", "thoughtful",
    ]

    // A fully-closed tag with its inner word: <emotion ...>word</emotion>.
    private static let completePair = regex("<emotion\\b[^>]*>([\\s\\S]*?)<\\/emotion\\b[^>]*>")
    // Self-closing tag: <emotion/>, <emotion type="x"/>.
    private static let selfClosing = regex("<emotion\\b[^>]*\\/>")
    // A stray complete close tag (delimiter only — surrounding text is kept).
    private static let strayClose = regex("<\\/emotion\\b[^>]*>")
    // An unpaired open tag and everything after it: the tag is open but the close
    // hasn't streamed in yet, so suppress the open tag plus any partial content.
    private static let unclosedOpenToEnd = regex("<emotion\\b[^>]*>[\\s\\S]*$")
    // A tag whose word is complete but which hasn't closed: "<emotion", "<emotion ty".
    private static let trailingPartialTag = regex("<\\/?emotion\\b[^>]*$")
    // A tag whose word is still being typed: "<", "<e", "<emo", "</em", … (a strict
    // prefix of "<emotion" / "</emotion"). Mirrors emotion_tag_parser's partial check.
    private static let trailingPartialPrefix =
        regex("<\\/?(?:emotion|emotio|emoti|emot|emo|em|e)?$")
    // The word carried inside a fully-closed tag, for emotion detection.
    private static let closedTagContent = regex("<emotion\\b[^>]*>([^<]*)<\\/emotion\\b[^>]*>")

    /// Strips inline emotion markup from `text` for display. Safe and idempotent on
    /// a partial streaming buffer. When `trailingEmotionWord` is supplied, a bare
    /// trailing word equal to it is also removed (see ``stripTrailingWord``).
    static func clean(_ text: String, trailingEmotionWord: String? = nil) -> String {
        var result = replacingMatches(completePair, in: text)
        result = replacingMatches(selfClosing, in: result)
        result = replacingMatches(strayClose, in: result)
        result = replacingMatches(unclosedOpenToEnd, in: result)
        result = replacingMatches(trailingPartialTag, in: result)
        result = replacingMatches(trailingPartialPrefix, in: result)
        return stripTrailingWord(result, emotion: trailingEmotionWord)
    }

    /// Some backends also append the emotion as a bare trailing word (e.g. the
    /// reply ends with "…concerned") with no surrounding tag. Strip it only when it
    /// exactly matches the emotion declared for this turn, so legitimate English
    /// words at the end of a message are never removed. Mirrors
    /// `stripTrailingEmotionWord` in the web client.
    static func stripTrailingWord(_ text: String, emotion: String?) -> String {
        let word = (emotion ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !word.isEmpty else { return text }
        let pattern = "\\s*\(NSRegularExpression.escapedPattern(for: word))\\s*$"
        guard let wordRegex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return text
        }
        return trimmedEnd(replacingMatches(wordRegex, in: text))
    }

    /// Best-effort emotion read from a fully-closed inline tag, validated against
    /// the known vocabulary. Returns the lowercased word, or `nil` when there is no
    /// closed tag or the word is unknown. Used to drive the avatar as a fallback.
    /// Mirrors the detection in `utils/emotion_tag_parser.ts`.
    static func detectEmotion(in text: String) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = closedTagContent.firstMatch(in: text, range: range),
              match.numberOfRanges > 1,
              let wordRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        let word = text[wordRange].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return validEmotions.contains(word) ? word : nil
    }

    private static func regex(_ pattern: String) -> NSRegularExpression {
        // Patterns are compile-time constants; a failure here is a programming error.
        try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
    }

    private static func replacingMatches(_ regex: NSRegularExpression, in text: String) -> String {
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: "")
    }

    /// Equivalent of JS `String.prototype.trimEnd()` — trailing whitespace only.
    private static func trimmedEnd(_ text: String) -> String {
        var result = text
        while let last = result.last, last.isWhitespace {
            result.removeLast()
        }
        return result
    }
}
