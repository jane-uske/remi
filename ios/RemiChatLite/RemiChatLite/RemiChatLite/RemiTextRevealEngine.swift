import Foundation
import Combine

/// Character-level typewriter reveal engine for assistant messages.
///
/// Buffers incoming text from the LLM stream and reveals it character by
/// character at a controlled cadence (~18ms per char by default).
/// Consumers observe `revealedText` to drive the display.
@MainActor
final class RemiTextRevealEngine: ObservableObject {
    /// The text that should be displayed — revealed character by character.
    @Published private(set) var revealedText: String = ""

    /// When true, reveal has caught up to the full text (streaming complete + all chars shown).
    @Published private(set) var isComplete: Bool = false

    /// Full text received from the server so far (may be ahead of revealedText).
    private var fullText: String = ""
    /// Index of the next character to reveal in `fullText`.
    private var revealIndex: String.Index
    /// Timer driving the reveal.
    private var revealTask: Task<Void, Never>?
    /// Whether the server has signaled the message is complete.
    private var streamFinished: Bool = false

    /// Reveal cadence in nanoseconds per character.
    private let cadenceNs: UInt64

    /// - Parameter cadenceMs: Milliseconds per character. Default 18ms gives a natural typing feel.
    init(cadenceMs: Int = 18) {
        self.cadenceNs = UInt64(cadenceMs) * 1_000_000
        self.revealIndex = "".startIndex
    }

    /// Append new text from a streaming chunk.
    func append(_ chunk: String) {
        fullText += chunk
        startRevealIfNeeded()
    }

    /// Replace the full text (e.g., on finalize or when emotion tags are re-stripped).
    func setFullText(_ text: String) {
        fullText = text
        // If revealed text is already ahead (shouldn't happen), clamp.
        if revealedText.count > text.count {
            revealedText = text
            revealIndex = text.endIndex
        }
        startRevealIfNeeded()
    }

    /// Mark that the server has sent chat_end — no more chunks coming.
    func markStreamFinished() {
        streamFinished = true
        // If reveal has already caught up, mark complete immediately.
        if revealIndex >= fullText.endIndex {
            isComplete = true
        }
    }

    /// Instantly reveal all remaining text (e.g., user scrolled to bottom, or message is from history).
    func revealAll() {
        revealTask?.cancel()
        revealTask = nil
        revealedText = fullText
        revealIndex = fullText.endIndex
        isComplete = streamFinished
    }

    /// Reset for reuse.
    func reset() {
        revealTask?.cancel()
        revealTask = nil
        fullText = ""
        revealedText = ""
        revealIndex = "".startIndex
        isComplete = false
        streamFinished = false
    }

    // MARK: - Private

    private func startRevealIfNeeded() {
        guard revealTask == nil else { return }
        guard revealIndex < fullText.endIndex else { return }

        revealTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                guard self.revealIndex < self.fullText.endIndex else {
                    self.revealTask = nil
                    if self.streamFinished {
                        self.isComplete = true
                    }
                    return
                }

                self.fullText.formIndex(after: &self.revealIndex)
                self.revealedText = String(self.fullText[self.fullText.startIndex..<self.revealIndex])

                try? await Task.sleep(nanoseconds: self.cadenceNs)
            }
        }
    }
}
