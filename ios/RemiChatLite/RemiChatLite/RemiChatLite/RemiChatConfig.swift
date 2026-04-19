import Foundation

enum RemiChatConfig {
    // Set these in Xcode Scheme -> Run -> Environment Variables.
    // REMI_IOS_WS_URL, REMI_IOS_AUTH_MODE, REMI_IOS_CLERK_PUBLISHABLE_KEY, REMI_IOS_JWT, REMI_IOS_MOBILE_DEV_KEY
    private static var baseWsURLString: String {
        ProcessInfo.processInfo.environment["REMI_IOS_WS_URL"] ?? "ws://127.0.0.1:3000/ws"
    }

    static let clientFamily = "ios_lite"
    static let declaredTtsTransport = "pcm_stream_v1"

    static var wsURLString: String {
        resolvedWebSocketURL()?.absoluteString ?? baseWsURLString
    }

    static var authRuntimePolicy: RemiAuthRuntimePolicy {
        RemiAuthRuntimePolicy.resolve(
            authModeRaw: ProcessInfo.processInfo.environment["REMI_IOS_AUTH_MODE"],
            clerkPublishableKeyRaw: ProcessInfo.processInfo.environment["REMI_IOS_CLERK_PUBLISHABLE_KEY"]
        )
    }

    static var jwtToken: String? {
        let raw = ProcessInfo.processInfo.environment["REMI_IOS_JWT"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let raw, !raw.isEmpty {
            return raw
        }
        return nil
    }

    static var mobileDevKey: String? {
        let raw = ProcessInfo.processInfo.environment["REMI_IOS_MOBILE_DEV_KEY"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let raw, !raw.isEmpty {
            return raw
        }
        return nil
    }

    static let messageCacheLimit = 120
    static let reconnectDelaySeconds: TimeInterval = 2.0

    static func resolvedWebSocketURL() -> URL? {
        guard var components = URLComponents(string: baseWsURLString) else {
            return nil
        }

        var items = components.queryItems ?? []
        appendQueryItemIfMissing(name: "client", value: clientFamily, into: &items)
        appendQueryItemIfMissing(name: "tts_transport", value: declaredTtsTransport, into: &items)
        if shouldAppendLegacyJwtToQuery, let jwtToken {
            appendQueryItemIfMissing(name: "token", value: jwtToken, into: &items)
        }
        components.queryItems = items.isEmpty ? nil : items
        return components.url
    }

    static func buildClientContextPayload(
        timeZone: String = TimeZone.current.identifier,
        locale: String = Locale.preferredLanguages.first ?? Locale.current.identifier
    ) -> [String: Any] {
        var payload: [String: Any] = ["type": "client_context"]
        let normalizedTimeZone = timeZone.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedTimeZone.isEmpty {
            payload["timeZone"] = normalizedTimeZone
        }
        let normalizedLocale = locale.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedLocale.isEmpty {
            payload["locale"] = normalizedLocale
        }
        payload["ttsTransport"] = declaredTtsTransport
        return payload
    }

    static func preflightConnectionIssue(for url: URL) -> String? {
        #if targetEnvironment(simulator)
        return nil
        #else
        guard let host = url.host?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() else {
            return nil
        }
        if host == "127.0.0.1" || host == "localhost" || host == "::1" {
            return "真机不能连接 \(host)。把 REMI_IOS_WS_URL 改成你的 Mac 局域网 IP:3000，或改成公网 wss 地址。"
        }
        return nil
        #endif
    }

    private static func appendQueryItemIfMissing(
        name: String,
        value: String,
        into items: inout [URLQueryItem]
    ) {
        guard !items.contains(where: { $0.name == name && ($0.value?.isEmpty == false) }) else {
            return
        }
        items.append(URLQueryItem(name: name, value: value))
    }

    private static var shouldAppendLegacyJwtToQuery: Bool {
        !authRuntimePolicy.clerkEnabled
    }
}
