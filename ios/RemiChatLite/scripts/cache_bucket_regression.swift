import Foundation

func base64Url(_ data: Data) -> String {
    let base64 = data.base64EncodedString()
    return base64
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func fakeJWT(payload: [String: Any]) -> String {
    let header = ["alg": "none", "typ": "JWT"]
    let headerData = try! JSONSerialization.data(withJSONObject: header)
    let payloadData = try! JSONSerialization.data(withJSONObject: payload)
    return "\(base64Url(headerData)).\(base64Url(payloadData))."
}

func assertTrue(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

@main
struct CacheBucketRegressionRunner {
    static func main() {
        let user1Token = fakeJWT(payload: ["id": "user_001"])
        let user2Token = fakeJWT(payload: ["id": "user_002"])
        let weirdToken = fakeJWT(payload: ["id": "u$#@ser/3"])

        let key1 = RemiChatIdentity.activeCacheKey(jwtToken: user1Token)
        let key2 = RemiChatIdentity.activeCacheKey(jwtToken: user2Token)
        let keyWeird = RemiChatIdentity.activeCacheKey(jwtToken: weirdToken)
        let keyDefault = RemiChatIdentity.activeCacheKey(jwtToken: nil)

        assertTrue(key1 != key2, "user_001 和 user_002 必须落到不同缓存桶")
        assertTrue(keyDefault == RemiChatIdentity.defaultCacheKey, "无 JWT 时必须回落默认缓存桶")
        assertTrue(!keyWeird.contains("$") && !keyWeird.contains("/") && !keyWeird.contains("#"), "缓存 key 必须做字符清洗")

        print("PASS")
        print("user_001=\(key1)")
        print("user_002=\(key2)")
        print("default=\(keyDefault)")
        print("sanitized=\(keyWeird)")
    }
}
