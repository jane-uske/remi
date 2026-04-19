import Foundation

enum RemiChatIdentity {
    static let defaultCacheKey = "remi.chat.ios.messages.v1.default"
    private static let cacheKeyPrefix = "remi.chat.ios.messages.v1.user."

    static func activeCacheKey(currentUserId: String?, jwtToken: String?) -> String {
        if let currentUserId = sanitizedCurrentUserId(currentUserId) {
            return cacheKeyPrefix + currentUserId
        }
        guard let token = jwtToken,
              let userId = extractUserId(fromJWT: token) else {
            return defaultCacheKey
        }
        return cacheKeyPrefix + userId
    }

    static func activeCacheKey(jwtToken: String?) -> String {
        activeCacheKey(currentUserId: nil, jwtToken: jwtToken)
    }

    static func extractUserId(fromJWT token: String) -> String? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        guard let payloadData = decodeBase64Url(String(parts[1])),
              let payload = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any] else {
            return nil
        }
        if let id = payload["id"] as? String, !id.isEmpty {
            return sanitizeCacheSegment(id)
        }
        if let sub = payload["sub"] as? String, !sub.isEmpty {
            return sanitizeCacheSegment(sub)
        }
        return nil
    }

    static func decodeBase64Url(_ value: String) -> Data? {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: base64)
    }

    static func sanitizeCacheSegment(_ value: String) -> String {
        let filtered = value.unicodeScalars.map { scalar -> Character in
            let allowed =
                (scalar.value >= 48 && scalar.value <= 57) ||
                (scalar.value >= 65 && scalar.value <= 90) ||
                (scalar.value >= 97 && scalar.value <= 122) ||
                scalar.value == 45 || scalar.value == 95
            return allowed ? Character(scalar) : "_"
        }
        return String(filtered)
    }

    private static func sanitizedCurrentUserId(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return sanitizeCacheSegment(trimmed)
    }
}
