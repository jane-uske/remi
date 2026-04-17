import Foundation

func assertTrue(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

@main
struct DuplexPlaybackLifecycleRegressionRunner {
    static func main() {
        var lifecycle = RemiPlaybackLifecycleTracker()
        assertTrue(lifecycle.beginIfNeeded(for: 7), "首个 generation 必须触发 playback_start")
        assertTrue(!lifecycle.beginIfNeeded(for: 7), "同一 generation 不应重复触发 playback_start")
        let firstEnd = lifecycle.endIfNeeded()
        assertTrue(firstEnd?.generationId == 7, "播放结束必须回到同一个 generation")
        assertTrue(lifecycle.endIfNeeded() == nil, "重复结束不应再次触发 playback_end")

        assertTrue(lifecycle.beginIfNeeded(for: nil), "无 generation 的首个播放也必须触发 playback_start")
        let nilEnd = lifecycle.endIfNeeded()
        assertTrue(nilEnd != nil && nilEnd?.generationId == nil, "无 generation 的播放结束也必须可观测")

        var streamTracker = RemiPcmStreamTracker()
        let format24k = RemiPcmStreamFormat(sampleRate: 24_000, channels: 1, bitsPerSample: 16)
        let format16k = RemiPcmStreamFormat(sampleRate: 16_000, channels: 1, bitsPerSample: 16)
        assertTrue(!streamTracker.requiresFlush(for: 3, format: format24k), "首次 stream 不应要求 flush")
        streamTracker.activate(generationId: 3, format: format24k)
        assertTrue(!streamTracker.requiresFlush(for: 3, format: format24k), "同 generation 同 format 不应 flush")
        assertTrue(streamTracker.requiresFlush(for: 4, format: format24k), "generation 切换必须 flush")
        assertTrue(streamTracker.requiresFlush(for: 3, format: format16k), "format 变化必须 flush")

        let defaultGain = RemiPcm16Gain.resolvedPlaybackGain(from: [:])
        assertTrue(abs(defaultGain - 1.8) < 0.0001, "默认 playback gain 应为 1.8x")

        let overriddenGain = RemiPcm16Gain.resolvedPlaybackGain(
            from: ["REMI_IOS_TTS_PLAYBACK_GAIN": "2.4"]
        )
        assertTrue(abs(overriddenGain - 2.4) < 0.0001, "环境变量应覆盖 playback gain")

        let clampedGain = RemiPcm16Gain.resolvedPlaybackGain(
            from: ["REMI_IOS_TTS_PLAYBACK_GAIN": "9.0"]
        )
        assertTrue(abs(clampedGain - 3.0) < 0.0001, "过大的 playback gain 必须被钳制")

        let defaultAttackGain = RemiPcm16Gain.resolvedPlaybackAttackGain(from: [:])
        assertTrue(abs(defaultAttackGain - 2.5) < 0.0001, "默认 attack gain 应为 2.5x")

        let defaultAttackMs = RemiPcm16Gain.resolvedPlaybackAttackMs(from: [:])
        assertTrue(defaultAttackMs == 420, "默认 attack 窗口应为 420ms")

        var pcm = Data(count: 4)
        pcm.withUnsafeMutableBytes { rawBytes in
            let samples = rawBytes.bindMemory(to: Int16.self)
            samples[0] = 12_000
            samples[1] = 20_000
        }
        let amplified = RemiPcm16Gain.apply(to: pcm, gain: 2.0)
        amplified.withUnsafeBytes { rawBytes in
            let samples = rawBytes.bindMemory(to: Int16.self)
            assertTrue(samples[0] == 24_000, "PCM gain 应该线性放大样本")
            assertTrue(samples[1] == Int16.max, "PCM gain 必须钳制到 Int16 上限")
        }

        var attackRemaining = 2
        var attackPcm = Data(count: 6)
        attackPcm.withUnsafeMutableBytes { rawBytes in
            let samples = rawBytes.bindMemory(to: Int16.self)
            samples[0] = 10_000
            samples[1] = 10_000
            samples[2] = 10_000
        }
        let attackAmplified = RemiPcm16Gain.applyAttackEnvelope(
            to: attackPcm,
            baseGain: 1.5,
            attackGain: 2.5,
            attackSamplesRemaining: &attackRemaining
        )
        attackAmplified.withUnsafeBytes { rawBytes in
            let samples = rawBytes.bindMemory(to: Int16.self)
            assertTrue(samples[0] == 25_000, "attack gain 应作用在起始样本")
            assertTrue(samples[1] == 25_000, "attack 窗口内样本应继续使用 attack gain")
            assertTrue(samples[2] == 15_000, "attack 窗口外样本应回落到 base gain")
        }
        assertTrue(attackRemaining == 0, "attack sample 计数应被正确消耗")

        print("PASS")
        print("lifecycle=ok")
        print("stream_tracker=ok")
        print("playback_gain=ok")
    }
}
