import SwiftUI

@main
struct RemiWatchApp: App {
    @StateObject private var store = WatchChatStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .onAppear { store.start() }
        }
    }
}
