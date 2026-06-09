import Foundation

/// Inline emotion markup stripping for the chat display.
///
/// The LLM is prompted to append `<emotion>xxx</emotion>` metadata to the end of
/// every reply so the avatar can react (brain/prompt_builder.ts). That markup is
/// metadata, not content, and must never reach the chat bubble. The web client
/// strips it via `web/src/lib/chat/stripEmotionTags.ts` and the desktop app does
/// the same; this is the iOS port of that logic, including the streaming case
/// where a `<emotion>` tag can be split across chunk boundaries.
///
/// The emotion is also delivered out-of-band via `.emotion` / `.avatarIntent` /
/// `chat_end` wire messages, so the inline tag is purely cosmetic leakage — but
/// when a tag *is* present we reuse it as an avatar emotion fallback.
enum RemiEmotionTag {
    /// Canonical emotion vocabulary the server emits (emotion/emotion_state.ts).
    static let validEmotions: Set<String> = [
        "neutral", "happy", "curious", "shy", "sad", "concerned", "playful", "thoughtful",
    ]

    // Complete tags: <emotion>...</emotion>, <emotion/>, <emotion type="x">, </emotion>.
    private static let completeTag = try! NSRegularExpression(
        pattern: "<\\/?emotion\\b[^>]*>", options: [.caseInsensitive])
    // A tag still being streamed that hasn't closed yet, e.g. "<emoti" / "<emotion ha".
    private static let trailingPartialTag = try! NSRegularExpression(
        pattern: "<\\/?emotion\\b[^>]*$", options: [.caseInsensitive])
    // A lone trailing "<" that may be the very start of an upcoming tag mid-stream.
    private static let trailingAngle = try! NSRegularExpression(
        pattern: "<$", options: [])
    // The word carried inside a fully-closed <emotion>…</emotion> tag.
    private static let closedTagContent = try! NSRegularExpression(
        pattern: "<emotion\\b[^>]*>([^<]*)<\\/emotion>", options: [.caseInsensitive])

    /// Strips inline emotion markup for display. Safe to call on a partial
    /// streaming buffer: a not-yet-closed `<emotion …` suffix (or a lone `<`) is
    /// removed so it never flashes in the bubble, and reappears as soon as more
    /// of the buffer arrives. Mirrors `stripEmotionTags` in the web client.
    static func strip(_ text: String) -> String {
        var result = replacingAll(completeTag, in: text)
        result = replacingAll(trailingPartialTag, in: result)
        result = replacingAll(trailingAngle, in: result)
        return result
    }

    /// Some backends also append the emotion as a bare trailing word (e.g. the
    /// reply ends with "…concerned"). Strip it only when it exactly matches the
    /// emotion declared for this turn, so legitimate English words at the end of a
    /// message are never removed. Mirrors `stripTrailingEmotionWord` in the web client.
    static func stripTrailingWord(_ text: String, emotion: String?) -> String {
        let word = (emotion ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !word.isEmpty else { return text }
        let pattern = "\\s*\(NSRegularExpression.escapedPattern(for: word))\\s*$"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return text
        }
        return trimmedEnd(replacingAll(regex, in: text))
    }

    /// Best-effort emotion read from a fully-closed inline tag, validated against
    /// the known vocabulary. Returns the lowercased word, or `nil` when there is no
    /// closed tag or the word is unknown. Used to drive the avatar as a fallback
    /// and to remove the bare word the tag leaves behind. Mirrors the detection in
    /// `utils/emotion_tag_parser.ts`.
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

    private static func replacingAll(_ regex: NSRegularExpression, in text: String) -> String {
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
