import Foundation

func assertTrue(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

@main
struct ClerkAuthRegressionRunner {
    static func main() {
        setenv("REMI_IOS_AUTH_MODE", "clerk", 1)
        setenv("REMI_IOS_CLERK_PUBLISHABLE_KEY", "pk_test_ios_123", 1)

        let runtimePolicy = RemiAuthRuntimePolicy.resolve(
            authModeRaw: ProcessInfo.processInfo.environment["REMI_IOS_AUTH_MODE"],
            clerkPublishableKeyRaw: ProcessInfo.processInfo.environment["REMI_IOS_CLERK_PUBLISHABLE_KEY"]
        )

        assertTrue(runtimePolicy.clerkEnabled, "配置 Clerk 模式且提供 publishable key 时必须启用正式登录")
        assertTrue(runtimePolicy.legacyFallbackEnabled, "Clerk 模式下仍应保留 legacy fallback 兜底")
        assertTrue(runtimePolicy.publishableKey == "pk_test_ios_123", "必须透传 Clerk publishable key")

        let explicitUserCacheKey = RemiChatIdentity.activeCacheKey(
            currentUserId: "user_clerk_001",
            jwtToken: nil
        )
        let jwtOnlyCacheKey = RemiChatIdentity.activeCacheKey(
            currentUserId: nil,
            jwtToken: fakeJWT(payload: ["id": "user_jwt_001"])
        )
        let defaultCacheKey = RemiChatIdentity.activeCacheKey(
            currentUserId: nil,
            jwtToken: nil
        )

        assertTrue(
            explicitUserCacheKey == "remi.chat.ios.messages.v1.user.user_clerk_001",
            "显式 user id 必须优先决定缓存桶"
        )
        assertTrue(
            jwtOnlyCacheKey == "remi.chat.ios.messages.v1.user.user_jwt_001",
            "无显式 user id 时仍应兼容旧 JWT 分桶"
        )
        assertTrue(
            defaultCacheKey == RemiChatIdentity.defaultCacheKey,
            "无正式身份也无 JWT 时必须回退默认缓存桶"
        )

        print("PASS")
        print("runtime_policy=ok")
        print("cache_bucket=ok")
    }

    private static func fakeJWT(payload: [String: Any]) -> String {
        let header = ["alg": "none", "typ": "JWT"]
        let headerData = try! JSONSerialization.data(withJSONObject: header)
        let payloadData = try! JSONSerialization.data(withJSONObject: payload)
        return "\(base64URL(headerData)).\(base64URL(payloadData))."
    }

    private static func base64URL(_ data: Data) -> String {
        let base64 = data.base64EncodedString()
        return base64
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
