import Foundation

/// Minimal runtime config for the Remi watch client.
///
/// Resolution order for every value: process environment (set via the Xcode
/// scheme when running in the simulator) -> Info.plist -> baked-in default.
/// This keeps the MVP runnable with zero setup against a local dev gateway,
/// while still allowing a tunnel/wss override without a rebuild.
enum WatchConfig {
    static let clientFamily = "watch_lite"

    /// Default points at the Mac host loopback. The watch *simulator* shares the
    /// host network, so `127.0.0.1:3000` reaches a local `npm run dev` gateway.
    private static let defaultWsURLString = "ws://127.0.0.1:3000/ws"

    static var baseWsURLString: String {
        value(forKey: "REMI_WATCH_WS_URL") ?? defaultWsURLString
    }

    /// Optional local dev-key auth (`X-Remi-Mobile-Key`). Only used when the
    /// gateway runs with `REMI_MOBILE_DEV_ENABLED=1`. Leave unset when the
    /// gateway auth mode is `disabled`.
    static var mobileDevKey: String? {
        value(forKey: "REMI_WATCH_MOBILE_DEV_KEY")
    }

    static let reconnectDelaySeconds: TimeInterval = 2.0
    static let messageLimit = 80

    /// Builds the connect URL, appending the `client` discriminator the gateway
    /// uses for per-client routing without clobbering caller-supplied params.
    static func resolvedWebSocketURL() -> URL? {
        guard var components = URLComponents(string: baseWsURLString) else { return nil }
        var items = components.queryItems ?? []
        if !items.contains(where: { $0.name == "client" && ($0.value?.isEmpty == false) }) {
            items.append(URLQueryItem(name: "client", value: clientFamily))
        }
        components.queryItems = items.isEmpty ? nil : items
        return components.url
    }

    static func clientContextPayload(
        timeZone: String = TimeZone.current.identifier,
        locale: String = Locale.preferredLanguages.first ?? Locale.current.identifier
    ) -> [String: Any] {
        var payload: [String: Any] = ["type": "client_context"]
        let tz = timeZone.trimmingCharacters(in: .whitespacesAndNewlines)
        if !tz.isEmpty { payload["timeZone"] = tz }
        let loc = locale.trimmingCharacters(in: .whitespacesAndNewlines)
        if !loc.isEmpty { payload["locale"] = loc }
        return payload
    }

    private static func value(forKey key: String) -> String? {
        if let raw = ProcessInfo.processInfo.environment[key]?
            .trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
            return raw
        }
        if let raw = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
            return raw
        }
        return nil
    }
}
