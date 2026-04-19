import Foundation

#if canImport(ClerkKit)
import ClerkKit
#endif

@MainActor
protocol RemiChatAuthSource: AnyObject {
    var authRuntimePolicy: RemiAuthRuntimePolicy { get }
    var currentUserId: String? { get }
    var legacyJwtToken: String? { get }
    var mobileDevKey: String? { get }

    func bearerToken() async throws -> String?
    func signOut() async throws
}

@MainActor
final class RemiRuntimeAuthSource: RemiChatAuthSource {
    static let shared = RemiRuntimeAuthSource()

    private init() {}

    var authRuntimePolicy: RemiAuthRuntimePolicy {
        RemiChatConfig.authRuntimePolicy
    }

    var currentUserId: String? {
        if authRuntimePolicy.clerkEnabled {
            return normalizedClerkUserId()
        }
        guard let jwtToken = legacyJwtToken else { return nil }
        return RemiChatIdentity.extractUserId(fromJWT: jwtToken)
    }

    var legacyJwtToken: String? {
        RemiChatConfig.jwtToken
    }

    var mobileDevKey: String? {
        RemiChatConfig.mobileDevKey
    }

    func bearerToken() async throws -> String? {
        if authRuntimePolicy.clerkEnabled {
            #if canImport(ClerkKit)
            if let token = try await Clerk.shared.auth.getToken() {
                return token
            }
            #endif
        }
        return legacyJwtToken
    }

    func signOut() async throws {
        guard authRuntimePolicy.clerkEnabled else { return }
        #if canImport(ClerkKit)
        try await Clerk.shared.auth.signOut()
        #endif
    }

    private func normalizedClerkUserId() -> String? {
        #if canImport(ClerkKit)
        guard let rawUserId = Clerk.shared.user?.id else {
            return nil
        }
        let userId = rawUserId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !userId.isEmpty else {
            return nil
        }
        return userId
        #else
        return nil
        #endif
    }
}
