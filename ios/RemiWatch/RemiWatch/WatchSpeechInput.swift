import Foundation
import WatchKit
import os

/// System dictation on watchOS via WatchKit (Speech.framework is not on watchOS).
/// Falls back to prompting the user if the interface controller is unavailable.
@MainActor
final class WatchSpeechInput: ObservableObject {
    @Published private(set) var isListening = false
    @Published private(set) var statusMessage: String?

    private static let log = Logger(subsystem: "run.remi.watch", category: "dictation")

    private let suggestions = ["Hi Remi", "今天怎么样", "晚上好"]

    /// `TextFieldLink` is the SwiftUI fallback when WatchKit has no interface controller (common in Simulator).
    var useTextFieldLinkFallback: Bool {
        WKExtension.shared().visibleInterfaceController == nil
            && WKExtension.shared().rootInterfaceController == nil
    }

    func startDictation(onFinal: @escaping (String) -> Void) {
        guard !isListening else { return }
        isListening = true
        statusMessage = nil

        guard let controller = WKExtension.shared().visibleInterfaceController
            ?? WKExtension.shared().rootInterfaceController else {
            statusMessage = "听写不可用，请用真机测试"
            isListening = false
            Self.log.error("no WKInterfaceController for dictation")
            return
        }

        controller.presentTextInputController(
            withSuggestions: suggestions,
            allowedInputMode: .plain
        ) { [weak self] results in
            Task { @MainActor in
                guard let self else { return }
                self.isListening = false
                let text = (results?.first as? String)?
                    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if !text.isEmpty {
                    Self.log.notice("dictation result: \(text, privacy: .public)")
                    onFinal(text)
                }
            }
        }
        Self.log.notice("presented system dictation sheet")
    }

    func stopDictation() {
        // System sheet is dismissed by the user; nothing to cancel programmatically.
        isListening = false
    }
}