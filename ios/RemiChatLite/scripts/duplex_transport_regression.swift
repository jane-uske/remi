import Foundation

func assertTrue(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

@main
struct DuplexTransportRegressionRunner {
    static func main() {
        setenv("REMI_IOS_WS_URL", "ws://10.0.0.2:3000/ws?foo=bar", 1)

        guard let resolvedURL = RemiChatConfig.resolvedWebSocketURL(),
              let components = URLComponents(url: resolvedURL, resolvingAgainstBaseURL: false) else {
            fputs("FAIL: 无法构建协商后的 WebSocket URL\n", stderr)
            exit(1)
        }

        let queryItems = components.queryItems ?? []
        let queryMap = Dictionary(uniqueKeysWithValues: queryItems.map { ($0.name, $0.value ?? "") })
        assertTrue(queryMap["foo"] == "bar", "必须保留原始查询参数")
        assertTrue(queryMap["client"] == "ios_lite", "握手必须带 client=ios_lite")
        assertTrue(queryMap["tts_transport"] == "pcm_stream_v1", "握手必须带 pcm_stream_v1 transport")
        assertTrue(RemiChatConfig.declaredTtsTransport == "pcm_stream_v1", "client_context transport 常量必须和握手一致")
        let clientContextPayload = RemiChatConfig.buildClientContextPayload(
            timeZone: "Asia/Shanghai",
            locale: "zh-CN"
        )
        assertTrue(clientContextPayload["type"] as? String == "client_context", "client_context type 错误")
        assertTrue(clientContextPayload["timeZone"] as? String == "Asia/Shanghai", "client_context timeZone 错误")
        assertTrue(clientContextPayload["locale"] as? String == "zh-CN", "client_context locale 错误")
        assertTrue(clientContextPayload["ttsTransport"] as? String == "pcm_stream_v1", "client_context ttsTransport 错误")

        let pcmChunkJSON = """
        {"type":"voice_pcm_chunk","audio":"AQIDBA==","sampleRate":24000,"channels":1,"bitsPerSample":16,"generationId":7}
        """
        guard let pcmChunkMessage = RemiServerWireMessageParser.parse(pcmChunkJSON) else {
            fputs("FAIL: voice_pcm_chunk 解析失败\n", stderr)
            exit(1)
        }
        switch pcmChunkMessage {
        case .voicePcmChunk(let audio, let sampleRate, let channels, let bitsPerSample, let generationId):
            assertTrue(audio == "AQIDBA==", "voice_pcm_chunk 必须保留音频载荷")
            assertTrue(sampleRate == 24000, "voice_pcm_chunk sampleRate 解析错误")
            assertTrue(channels == 1, "voice_pcm_chunk channels 解析错误")
            assertTrue(bitsPerSample == 16, "voice_pcm_chunk bitsPerSample 解析错误")
            assertTrue(generationId == 7, "voice_pcm_chunk generationId 解析错误")
        default:
            fputs("FAIL: voice_pcm_chunk 被解析成错误的消息类型\n", stderr)
            exit(1)
        }

        let voiceJSON = """
        {"type":"voice","audio":"dm9pY2U=","generationId":9}
        """
        guard let voiceMessage = RemiServerWireMessageParser.parse(voiceJSON) else {
            fputs("FAIL: legacy voice 解析失败\n", stderr)
            exit(1)
        }
        switch voiceMessage {
        case .voice(let audio, let generationId):
            assertTrue(audio == "dm9pY2U=", "legacy voice 音频载荷不应回退")
            assertTrue(generationId == 9, "legacy voice generationId 解析错误")
        default:
            fputs("FAIL: legacy voice 被解析成错误的消息类型\n", stderr)
            exit(1)
        }

        print("PASS")
        print("ws_url=\(resolvedURL.absoluteString)")
        print("client_context=ok")
        print("voice_pcm_chunk=ok")
        print("legacy_voice=ok")
    }
}
