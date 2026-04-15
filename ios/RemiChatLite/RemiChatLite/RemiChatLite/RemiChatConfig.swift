import Foundation

enum RemiChatConfig {
    // Set these in Xcode Scheme -> Run -> Environment Variables.
    // REMI_IOS_WS_URL, REMI_IOS_JWT, REMI_IOS_MOBILE_DEV_KEY
    static var wsURLString: String {
        ProcessInfo.processInfo.environment["REMI_IOS_WS_URL"] ?? "ws://127.0.0.1:3000/ws"
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
}
