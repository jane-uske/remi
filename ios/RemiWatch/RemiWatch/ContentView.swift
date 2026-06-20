import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: WatchChatStore
    @State private var showChat = false

    var body: some View {
        RemiBlobScreen(showChat: $showChat)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showChat = true
                    } label: {
                        Image(systemName: "ellipsis.bubble")
                    }
                    .accessibilityLabel("Open chat history")
                }
            }
            .sheet(isPresented: $showChat) {
                WatchChatSheet()
            }
    }
}

/// Compact chat history sheet — secondary to the blob presence screen.
struct WatchChatSheet: View {
    @EnvironmentObject private var store: WatchChatStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var speech = WatchSpeechInput()
    @State private var draft = ""

    private let quickReplies = ["Hi Remi", "How are you?", "今天怎么样"]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        if store.historyHasMore || store.historyLoadingMore {
                            loadEarlierRow
                        }
                        if store.messages.isEmpty {
                            Text("No messages yet")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 12)
                        }
                        ForEach(store.messages) { message in
                            MessageRow(message: message)
                                .id(message.id)
                        }
                        if store.awaitingReply {
                            thinkingRow.id("thinking")
                        }
                    }
                    .padding(.horizontal, 2)
                }
                .onChange(of: store.messages) { _, _ in scrollToBottom(proxy) }
                .onChange(of: store.awaitingReply) { _, _ in scrollToBottom(proxy) }
            }
            .safeAreaInset(edge: .bottom) { inputBar }
            .navigationTitle("Chat")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { muteButton }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var muteButton: some View {
        Button {
            store.ttsEnabled.toggle()
        } label: {
            Image(systemName: store.ttsEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill")
        }
    }

    private var loadEarlierRow: some View {
        HStack {
            Spacer()
            if store.historyLoadingMore {
                ProgressView().scaleEffect(0.7)
            } else {
                Button("Load earlier") { store.loadMoreHistory() }
                    .font(.caption2)
            }
            Spacer()
        }
    }

    private var thinkingRow: some View {
        HStack {
            ProgressView().scaleEffect(0.7)
            Text("Remi is thinking…")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var inputBar: some View {
        VStack(spacing: 4) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(quickReplies, id: \.self) { reply in
                        Button(reply) { store.send(reply) }
                            .font(.caption2)
                    }
                }
            }
            HStack(spacing: 6) {
                if speech.useTextFieldLinkFallback {
                    TextFieldLink(prompt: Text("说话")) {
                        Image(systemName: "mic.fill")
                    } onSubmit: { store.send($0) }
                } else {
                    Button {
                        speech.startDictation { store.send($0) }
                    } label: {
                        Image(systemName: "mic.fill")
                    }
                }
                TextField("Message", text: $draft)
                    .submitLabel(.send)
                    .onSubmit(sendDraft)
                Button(action: sendDraft) {
                    Image(systemName: "arrow.up.circle.fill")
                }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(.horizontal, 4)
    }

    private func sendDraft() {
        let text = draft
        draft = ""
        store.send(text)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        let target = store.awaitingReply ? "thinking" : store.messages.last?.id
        guard let target else { return }
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(target, anchor: .bottom)
        }
    }
}

private struct MessageRow: View {
    let message: WatchChatMessage

    var body: some View {
        switch message.role {
        case .user:
            bubble(alignment: .trailing, background: Color.accentColor.opacity(0.85), foreground: .white)
        case .remi:
            bubble(alignment: .leading, background: Color.gray.opacity(0.28), foreground: .primary)
        case .system:
            Text(message.text)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func bubble(alignment: HorizontalAlignment, background: Color, foreground: Color) -> some View {
        HStack {
            if alignment == .trailing { Spacer(minLength: 16) }
            Text(message.text)
                .font(.caption)
                .foregroundStyle(foreground)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            if alignment == .leading { Spacer(minLength: 16) }
        }
    }
}