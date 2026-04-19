import SwiftUI

#if canImport(ClerkKit)
import ClerkKit
#endif

@main
struct RemiChatLiteApp: App {
    #if canImport(ClerkKit)
    private let configuredClerk: Clerk?
    #endif

    init() {
        let runtimePolicy = RemiChatConfig.authRuntimePolicy
        #if canImport(ClerkKit)
        if runtimePolicy.clerkEnabled, let publishableKey = runtimePolicy.publishableKey {
            configuredClerk = Clerk.configure(publishableKey: publishableKey)
        } else {
            configuredClerk = nil
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            #if canImport(ClerkKit)
            if let configuredClerk {
                RemiChatRootView()
                    .environment(configuredClerk)
            } else {
                RemiChatRootView()
            }
            #else
            RemiChatRootView()
            #endif
        }
    }
}
