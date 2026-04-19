import Foundation

struct RemiAuthRuntimePolicy: Equatable {
    let clerkEnabled: Bool
    let legacyFallbackEnabled: Bool
    let publishableKey: String?

    static func resolve(
        authModeRaw: String?,
        clerkPublishableKeyRaw: String?
    ) -> RemiAuthRuntimePolicy {
        let normalizedMode = authModeRaw?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let normalizedPublishableKey = clerkPublishableKeyRaw?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let clerkEnabled =
            normalizedMode == "clerk" &&
            !(normalizedPublishableKey?.isEmpty ?? true)

        return RemiAuthRuntimePolicy(
            clerkEnabled: clerkEnabled,
            legacyFallbackEnabled: true,
            publishableKey: normalizedPublishableKey?.isEmpty == false ? normalizedPublishableKey : nil
        )
    }
}
