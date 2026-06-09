import Foundation
import Security
import os

/// Auth-token source for the watch.
///
/// A standalone watchOS app can't host Clerk's interactive sign-in UI the way the
/// iOS app does, so the Clerk **session token** is supplied out-of-band and cached
/// in the Keychain. Resolution order:
///   1. Keychain (persisted across launches — written by `store(token:)`)
///   2. `REMI_WATCH_AUTH_TOKEN` process env (simulator dev via `SIMCTL_CHILD_…`)
///   3. `REMI_WATCH_AUTH_TOKEN` from Info.plist
///
/// When a token exists it is sent as `Authorization: Bearer <token>` — the same
/// header the gateway accepts for Clerk sessions (and legacy JWT). The production
/// hand-off path (a paired-iPhone companion pushing its Clerk session token over
/// WatchConnectivity, or Clerk's watchOS SDK once adopted) calls `store(token:)`.
enum WatchAuth {
    private static let log = Logger(subsystem: "run.remi.watch", category: "auth")
    private static let service = "run.remi.watch.auth"
    private static let account = "clerk-session-token"

    /// The current bearer token, if any. nil → unauthenticated (local loopback dev).
    static var bearerToken: String? {
        if let t = keychainRead(), !t.isEmpty { return t }
        if let t = WatchConfig.envOrPlist("REMI_WATCH_AUTH_TOKEN") { return t }
        return nil
    }

    static var isSignedIn: Bool { bearerToken != nil }

    /// Persist a session token (e.g. handed off from the paired iPhone's Clerk session).
    static func store(token: String) {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        keychainWrite(trimmed)
        log.notice("stored session token (\(trimmed.count, privacy: .public) chars)")
    }

    static func clear() {
        keychainDelete()
        log.notice("cleared session token")
    }

    // MARK: - Keychain

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func keychainRead() -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private static func keychainWrite(_ token: String) {
        guard let data = token.data(using: .utf8) else { return }
        let query = baseQuery()
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            insert.merge(attrs) { _, new in new }
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    private static func keychainDelete() {
        SecItemDelete(baseQuery() as CFDictionary)
    }
}
