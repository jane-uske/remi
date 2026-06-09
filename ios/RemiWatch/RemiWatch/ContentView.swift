import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: WatchChatStore
    @State private var draft = ""

    private let quickReplies = ["Hi Remi", "How are you?", "今天怎么样"]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        if store.messages.isEmpty {
                            emptyState
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
                    .padding(.bottom, 4)
                }
                .onChange(of: store.messages) { _, _ in scrollToBottom(proxy) }
                .onChange(of: store.awaitingReply) { _, _ in scrollToBottom(proxy) }
            }
            .safeAreaInset(edge: .bottom) { inputBar }
            .navigationTitle("Remi")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { statusDot }
            }
        }
    }

    // MARK: - Pieces

    private var statusDot: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
            Text(store.emotion)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var statusColor: Color {
        switch store.phase {
        case .open: return .green
        case .connecting: return .yellow
        case .closed: return .red
        }
    }

    private var emptyState: some View {
        VStack(spacing: 6) {
            Text("Talk to Remi")
                .font(.headline)
            Text(statusCaption)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    private var statusCaption: String {
        switch store.phase {
        case .open: return "Connected"
        case .connecting: return "Connecting…"
        case .closed: return "Offline — retrying"
        }
    }

    private var thinkingRow: some View {
        HStack {
            ProgressView().scaleEffect(0.7)
            Text("Remi is thinking…")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var inputBar: some View {
        VStack(spacing: 4) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(quickReplies, id: \.self) { reply in
                        Button(reply) { store.send(reply) }
                            .font(.caption2)
                            .buttonStyle(.bordered)
                    }
                }
                .padding(.horizontal, 2)
            }
            HStack(spacing: 6) {
                TextField("Message", text: $draft)
                    .submitLabel(.send)
                    .onSubmit(sendDraft)
                Button(action: sendDraft) {
                    Image(systemName: "arrow.up.circle.fill")
                }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 2)
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
