import SwiftUI

#if canImport(ClerkKit)
import ClerkKit
#endif

#if canImport(ClerkKitUI)
import ClerkKitUI
#endif

struct RemiChatRootView: View {
    #if canImport(ClerkKit)
    @Environment(Clerk.self) private var clerk
    #endif

    private let authSource = RemiRuntimeAuthSource.shared
    @StateObject private var store: RemiChatStore

    init() {
        _store = StateObject(wrappedValue: RemiChatStore(authSource: RemiRuntimeAuthSource.shared))
    }

    var body: some View {
        if authSource.authRuntimePolicy.clerkEnabled {
            clerkAuthShell
        } else {
            chatView(showSignOutButton: false, currentUserId: authSource.currentUserId)
        }
    }

    @ViewBuilder
    private var clerkAuthShell: some View {
        #if canImport(ClerkKit) && canImport(ClerkKitUI)
        if !clerk.isLoaded {
            loadingView
        } else if let currentUserId = clerk.user?.id {
            chatView(showSignOutButton: true, currentUserId: currentUserId)
        } else {
            AuthView(isDismissable: false)
        }
        #else
        unsupportedClerkView
        #endif
    }

    private var loadingView: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.97, blue: 0.99),
                    Color(red: 0.89, green: 0.93, blue: 0.97),
                    Color(red: 0.83, green: 0.91, blue: 0.92),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 14) {
                ProgressView()
                    .controlSize(.large)

                Text("Loading sign-in…")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(.primary.opacity(0.8))
            }
            .padding(24)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
    }

    private var unsupportedClerkView: some View {
        VStack(spacing: 12) {
            Text("Clerk iOS SDK is not linked")
                .font(.system(size: 18, weight: .semibold, design: .rounded))
            Text("Formal iOS sign-in was enabled, but the Clerk package is unavailable in this build.")
                .font(.system(size: 14, weight: .regular, design: .rounded))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(24)
    }

    private func chatView(showSignOutButton: Bool, currentUserId: String?) -> AnyView {
        let identityKey = currentUserId ?? "legacy-user"
        if showSignOutButton {
            return AnyView(
                ChatView(
                    store: store,
                    identityKey: identityKey,
                    showSignOutButton: true,
                    onSignOut: signOut
                )
            )
        }

        return AnyView(
            ChatView(
                store: store,
                identityKey: identityKey,
                showSignOutButton: false,
                onSignOut: nil
            )
        )
    }

    private func signOut() {
        Task { @MainActor in
            do {
                try await authSource.signOut()
            } catch {
                store.appendSystemError("Failed to sign out: \(error.localizedDescription)")
            }
        }
    }
}
