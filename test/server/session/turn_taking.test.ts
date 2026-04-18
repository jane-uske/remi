const assert = require("assert").strict;
const {
  decideTurnTaking,
  chooseBackchannelText,
  getMeaningfulTurnPreview,
  isTentativeSpeechText,
  evaluateBackchannelDecision,
  shouldOfferThinkingPauseBackchannel,
  shouldSuppressFallbackNoiseUtterance,
  shouldSuppressRecoveredFallbackUtterance,
  shouldSuppressStrictNoPreviewUtterance,
  strongFrameRatio,
} = require("../../../server/session/turn_taking");
const {
  classifyNonSpeechTranscript,
  classifyPreviewlessShortDuplexTranscript,
  heuristicTurnTakingPredictor,
} = require("../../../server/session/turn_taking_predictor");

describe("turn taking stage2", () => {
  const baseInput = {
    baseGapMs: 220,
    nowMs: 10_000,
    lastPartialUpdateAt: 9_400,
    lastGrowthAt: 9_400,
    hesitationHoldMs: 980,
    growthHoldMs: 720,
    likelyStableMs: 680,
    confirmedStableMs: 1_100,
    releaseMs: 60,
    minGapMs: 80,
  };

  it("holds on short pause when partial is still growing", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我觉得这个事情然后",
      lastPartialUpdateAt: 9_760,
      lastGrowthAt: 9_760,
    });

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.equal(decision.recentGrowth, true);
    assert.ok(decision.reasons.includes("recent_growth"));
  });

  it("marks punctuated stable sentence as confirmed end", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我今天有点累了。",
      lastPartialUpdateAt: 8_800,
      lastGrowthAt: 8_600,
    });

    assert.equal(decision.state, "CONFIRMED_END");
    assert.equal(decision.gapMs, 160);
    assert.equal(decision.sentenceClosed, true);
  });

  it("keeps semantic but unpunctuated ending at likely end", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我们晚上聊可以吗",
      lastPartialUpdateAt: 9_320,
      lastGrowthAt: 8_900,
    });

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.semanticallyComplete, true);
    assert.equal(decision.gapMs, 160);
  });

  it("falls back when preview is only recording placeholder", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "录音中… 1.4s",
      lastPartialUpdateAt: 0,
      lastGrowthAt: 0,
    });

    assert.equal(getMeaningfulTurnPreview("录音中… 1.4s"), "");
    assert.equal(decision.state, "CONFIRMED_END");
    assert.equal(decision.gapMs, 220);
    assert.equal(decision.usedFallback, true);
  });

  it("treats hesitation filler as hold", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "嗯嗯",
      lastPartialUpdateAt: 9_600,
      lastGrowthAt: 9_200,
    });

    assert.equal(isTentativeSpeechText("嗯嗯"), true);
    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 980);
  });

  it("holds incomplete long clause until it is stable enough", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我现在想优化 rem 的语音体验",
      lastPartialUpdateAt: 9_180,
      lastGrowthAt: 9_180,
    });

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.ok(decision.reasons.includes("incomplete_clause_not_stable"));
  });

  it("holds on continuation cue for the reported sentence pattern", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我现在想优化 rem 的语音体验，但是我不确定应该先改 stt 还是先改",
      lastPartialUpdateAt: 9_120,
      lastGrowthAt: 9_120,
    });

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.ok(decision.reasons.includes("continuation_cue"));
  });

  it("holds open clause tails such as 但是 before the user finishes the sentence", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "我现在想优化 rem 的语音体验，但是",
      lastPartialUpdateAt: 9_050,
      lastGrowthAt: 8_900,
    });

    assert.equal(decision.state, "HOLD");
    assert.equal(decision.gapMs, 720);
    assert.ok(decision.reasons.includes("open_clause_tail"));
  });

  it("releases faster for a stable carry-forward cue like 继续刚才那个", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "继续刚才那个",
      lastPartialUpdateAt: 9_100,
      lastGrowthAt: 8_900,
    });

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.gapMs, 80);
    assert.ok(decision.reasons.includes("carry_forward_cue"));
  });

  it("uses prosody fast release to target a ~480ms commit when the tail falls cleanly", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "那我们今晚就这样吧",
      lastPartialUpdateAt: 9_700,
      lastGrowthAt: 9_120,
      prosody: {
        reliable: true,
        voicedRatio: 0.72,
        voicedTailFrames: 3,
        pitchFrames: 5,
        pitchConfidence: 0.78,
        pitchSlopeHz: -18,
        tailEnergyDrop: 0.015,
        risingTail: false,
        fallingTail: true,
        sustainedVoicedTail: false,
      },
    });

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.gapMs, 180);
    assert.equal(decision.prosodyApplied, "prosody_fast_release");
  });

  it("releases quickly for a stable correction cue after an interruption", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "不是那个意思，我想说的是昨晚又没睡好",
      lastPartialUpdateAt: 9_120,
      lastGrowthAt: 8_900,
      growthPlateauMs: 900,
      interruptionType: "correction",
    });

    assert.equal(decision.state, "LIKELY_END");
    assert.equal(decision.gapMs, 80);
    assert.ok(decision.reasons.includes("correction_cue"));
    assert.ok(decision.reasons.includes("interruption:correction"));
  });

  it("releases quickly for a short emotional interruption once the partial plateaus", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "等一下你先别说",
      lastPartialUpdateAt: 9_240,
      lastGrowthAt: 9_080,
      growthPlateauMs: 500,
      interruptionType: "emotional_interrupt",
    });

    assert.equal(decision.state, "LIKELY_END");
    assert.ok(decision.reasons.includes("interruption:emotional_interrupt"));
  });

  it("uses partial growth trend aggregates to keep expanding semantic partials on hold", () => {
    const decision = decideTurnTaking({
      ...baseInput,
      previewText: "这样可以吗",
      lastPartialUpdateAt: 9_780,
      lastGrowthAt: 9_780,
      recentGrowthChars: 5,
      partialGrowthTrend: "expanding",
      semanticCompletionStreak: 0,
    });

    assert.equal(decision.state, "HOLD");
    assert.ok(decision.reasons.includes("partial_trend:expanding"));
  });

  it("offers a light backchannel on a stable thinking pause", () => {
    assert.equal(
      shouldOfferThinkingPauseBackchannel({
        state: "HOLD",
        previewText: "我觉得这个事情但是",
        stableMs: 1400,
        recentGrowth: false,
        semanticallyComplete: false,
        incompleteTail: true,
        minStableMs: 1100,
        minPreviewChars: 6,
      }),
      true,
    );
  });

  it("does not offer a backchannel while the partial is still actively growing", () => {
    assert.equal(
      shouldOfferThinkingPauseBackchannel({
        state: "HOLD",
        previewText: "我觉得这个事情但是",
        stableMs: 400,
        recentGrowth: true,
        semanticallyComplete: false,
        incompleteTail: true,
        minStableMs: 1100,
        minPreviewChars: 6,
      }),
      false,
    );
  });

  it("chooses a softer thinking-pause acknowledgement for shy and sad emotions", () => {
    assert.equal(chooseBackchannelText("shy", true), "嗯…你继续");
    assert.equal(chooseBackchannelText("sad", true), "我在听");
  });

  it("chooses brighter thinking-pause acknowledgements for happy and curious emotions", () => {
    assert.equal(chooseBackchannelText("happy", true), "你继续");
    assert.equal(chooseBackchannelText("curious", true), "然后呢");
  });

  it("returns a thinking_pause backchannel decision with emotion-aware text", () => {
    const decision = evaluateBackchannelDecision({
      emotion: "curious",
      state: "HOLD",
      previewText: "我想先说语音这一块但是",
      stableMs: 1500,
      recentGrowth: false,
      semanticallyComplete: false,
      incompleteTail: true,
      cooldownStableMs: 1100,
      minPreviewChars: 6,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, "thinking_pause");
    assert.equal(decision.text, "然后呢");
  });

  it("suppresses thinking-pause backchannel for explicit carry-forward cues", () => {
    const decision = evaluateBackchannelDecision({
      emotion: "neutral",
      state: "HOLD",
      previewText: "不是那个意思",
      stableMs: 1500,
      recentGrowth: false,
      semanticallyComplete: false,
      incompleteTail: false,
      cooldownStableMs: 1100,
      minPreviewChars: 4,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "turn_state");
  });

  it("suppresses thinking-pause backchannel for explicit correction cues", () => {
    const decision = evaluateBackchannelDecision({
      emotion: "neutral",
      state: "HOLD",
      previewText: "我的意思是",
      stableMs: 1500,
      recentGrowth: false,
      semanticallyComplete: false,
      incompleteTail: false,
      cooldownStableMs: 1100,
      minPreviewChars: 4,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "turn_state");
  });

  it("suppresses backchannel decisions while cooldown is active", () => {
    const decision = evaluateBackchannelDecision({
      emotion: "neutral",
      state: "LIKELY_END",
      previewText: "我们晚上继续聊可以吗",
      stableMs: 1600,
      recentGrowth: false,
      semanticallyComplete: true,
      incompleteTail: false,
      cooldownActive: true,
      cooldownStableMs: 1100,
      minPreviewChars: 6,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "cooldown");
  });

  it("suppresses short fallback-only utterances with no preview", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 660,
        suppressionMaxMs: 900,
      }),
      true,
    );
  });

  it("keeps fallback utterances when meaningful preview already exists", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "你记得我刚才说过什么吗",
        speechDurationMs: 660,
        suppressionMaxMs: 900,
      }),
      false,
    );
  });

  it("suppresses fallback hallucinations with weak rms and tiny final text", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 1280,
        suppressionMaxMs: 900,
        utteranceMaxRms: 0.021,
        minUtteranceRms: 0.035,
        utteranceFrameCount: 64,
        utteranceStrongFrames: 0,
        minStrongFrames: 2,
        minStrongRatio: 0.08,
        recognizedText: "是",
        tinyTextMaxChars: 1,
      }),
      true,
    );
  });

  it("suppresses fallback hallucinations with weak speech shape even when the final text is long", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 2860,
        suppressionMaxMs: 900,
        utteranceMaxRms: 0.0306,
        minUtteranceRms: 0.035,
        utteranceFrameCount: 140,
        utteranceStrongFrames: 0,
        minStrongFrames: 2,
        minStrongRatio: 0.08,
        recognizedText: "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目",
        tinyTextMaxChars: 1,
      }),
      true,
    );
  });

  it("keeps stronger fallback utterances even when final text is short", () => {
    assert.equal(
      shouldSuppressFallbackNoiseUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 1280,
        suppressionMaxMs: 900,
        utteranceMaxRms: 0.052,
        minUtteranceRms: 0.035,
        recognizedText: "嗯",
        tinyTextMaxChars: 1,
      }),
      false,
    );
  });

  it("suppresses recovered fallback short phrases when they are weak and previewless", () => {
    assert.equal(
      shouldSuppressRecoveredFallbackUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 1260,
        suppressionMaxMs: 900,
        utteranceMaxRms: 0.028,
        minUtteranceRms: 0.035,
        utteranceFrameCount: 72,
        utteranceStrongFrames: 0,
        minStrongFrames: 2,
        minStrongRatio: 0.08,
        recognizedText: "再说一遍",
        tinyTextMaxChars: 1,
      }),
      true,
    );
  });

  it("keeps recovered fallback utterances when the recovered audio shape is strong enough", () => {
    assert.equal(
      shouldSuppressRecoveredFallbackUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 1260,
        suppressionMaxMs: 900,
        utteranceMaxRms: 0.056,
        minUtteranceRms: 0.035,
        utteranceFrameCount: 72,
        utteranceStrongFrames: 22,
        minStrongFrames: 2,
        minStrongRatio: 0.08,
        recognizedText: "再说一遍",
        tinyTextMaxChars: 1,
      }),
      false,
    );
  });

  it("still suppresses recovered fallback utterances when STT returns a long hallucination", () => {
    assert.equal(
      shouldSuppressRecoveredFallbackUtterance({
        vadMode: "fallback_energy",
        previewText: "",
        speechDurationMs: 1480,
        suppressionMaxMs: 900,
        utteranceMaxRms: 0.028,
        minUtteranceRms: 0.035,
        utteranceFrameCount: 72,
        utteranceStrongFrames: 0,
        minStrongFrames: 2,
        minStrongRatio: 0.08,
        recognizedText: "请不吝点赞订阅转发打赏支持明镜与点点栏目",
        tinyTextMaxChars: 1,
      }),
      true,
    );
  });

  it("suppresses strict no-preview utterances with weak strong-frame shape", () => {
    assert.equal(
      shouldSuppressStrictNoPreviewUtterance({
        vadMode: "strict",
        previewText: "",
        utteranceFrameCount: 120,
        utteranceStrongFrames: 6,
        utteranceMaxRms: 0.02,
        minUtteranceRms: 0.035,
        minStrongFrames: 8,
        minStrongRatio: 0.22,
      }),
      true,
    );
  });

  it("keeps strict no-preview utterances when weak shape still carries strong energy", () => {
    assert.equal(
      shouldSuppressStrictNoPreviewUtterance({
        vadMode: "strict",
        previewText: "",
        utteranceFrameCount: 13,
        utteranceStrongFrames: 4,
        utteranceMaxRms: 0.12,
        minUtteranceRms: 0.035,
        minStrongFrames: 8,
        minStrongRatio: 0.22,
      }),
      false,
    );
  });

  it("keeps strict no-preview utterances when the speech shape is strong", () => {
    assert.equal(
      shouldSuppressStrictNoPreviewUtterance({
        vadMode: "strict",
        previewText: "",
        utteranceFrameCount: 100,
        utteranceStrongFrames: 34,
        utteranceMaxRms: 0.08,
        minUtteranceRms: 0.035,
        minStrongFrames: 8,
        minStrongRatio: 0.22,
      }),
      false,
    );
  });

  it("suppresses strict hallucinations when weak speech shape yields tiny final text", () => {
    assert.equal(
      shouldSuppressStrictNoPreviewUtterance({
        vadMode: "strict",
        previewText: "",
        utteranceFrameCount: 129,
        utteranceStrongFrames: 7,
        utteranceMaxRms: 0.02,
        minUtteranceRms: 0.035,
        minStrongFrames: 8,
        minStrongRatio: 0.22,
        recognizedText: "词曲 李宗盛",
        tinyTextMaxChars: 5,
      }),
      true,
    );
  });

  it("computes strong frame ratios defensively", () => {
    assert.equal(strongFrameRatio(0, 5), 0);
    assert.equal(strongFrameRatio(100, 25), 0.25);
  });

  it("rejects bracketed non-speech transcripts before they become user turns", () => {
    assert.deepEqual(classifyNonSpeechTranscript("[音乐]"), {
      reject: true,
      reason: "non_speech_tag_rejected",
      normalizedTranscript: "[音乐]",
    });
  });

  it("rejects media noise phrases like 谢谢观看 before they become user turns", () => {
    assert.deepEqual(classifyNonSpeechTranscript("谢谢观看!"), {
      reject: true,
      reason: "noise_phrase_rejected",
      normalizedTranscript: "谢谢观看",
    });
  });

  it("rejects media sign-off variants like 谢谢大家的观看 before they become user turns", () => {
    assert.deepEqual(classifyNonSpeechTranscript("谢谢大家的观看!"), {
      reject: true,
      reason: "noise_phrase_rejected",
      normalizedTranscript: "谢谢大家的观看",
    });
  });

  it("rejects cough-like onomatopoeia transcripts before they become user turns", () => {
    assert.deepEqual(classifyNonSpeechTranscript("咳咳。"), {
      reject: true,
      reason: "onomatopoeia_rejected",
      normalizedTranscript: "咳咳",
    });
  });

  it("does not reject normal speech that merely starts with a laughter syllable", () => {
    assert.deepEqual(classifyNonSpeechTranscript("哈喽哈喽能听到我说话吗？"), {
      reject: false,
      reason: null,
      normalizedTranscript: "哈喽哈喽能听到我说话吗",
    });
  });

  it("rejects previewless short feedback like 谢谢 under conservative duplex gating", () => {
    assert.deepEqual(
      classifyPreviewlessShortDuplexTranscript({
        text: "谢谢。",
        previewText: "",
        userSpeechScore: 0.74,
        nonSpeechMediaScore: 0.18,
      }),
      {
        reject: true,
        reason: "previewless_short_feedback_rejected",
        normalizedTranscript: "谢谢",
      },
    );
  });

  it("rejects previewless ambiguous short utterances when semantic evidence is weak", () => {
    assert.deepEqual(
      classifyPreviewlessShortDuplexTranscript({
        text: "好的。",
        previewText: "",
        userSpeechScore: 0.3,
        nonSpeechMediaScore: 0.82,
      }),
      {
        reject: true,
        reason: "noise_like_short_utterance",
        normalizedTranscript: "好的",
      },
    );
  });

  it("keeps short feedback when a meaningful preview already exists", () => {
    assert.deepEqual(
      classifyPreviewlessShortDuplexTranscript({
        text: "谢谢。",
        previewText: "谢谢",
        userSpeechScore: 0.74,
        nonSpeechMediaScore: 0.18,
      }),
      {
        reject: false,
        reason: null,
        normalizedTranscript: "谢谢",
      },
    );
  });

  it("does not reject longer speech that merely starts with short politeness", () => {
    assert.deepEqual(
      classifyPreviewlessShortDuplexTranscript({
        text: "谢谢你能听到我说话吗？",
        previewText: "",
        userSpeechScore: 0.91,
        nonSpeechMediaScore: 0.08,
      }),
      {
        reject: false,
        reason: null,
        normalizedTranscript: "谢谢你能听到我说话吗",
      },
    );
  });

  it("keeps interrupt validity low for previewless weak fallback noise while assistant is speaking", () => {
    const scores = heuristicTurnTakingPredictor.score({
      previewText: "",
      recognizedText: "谢谢观看!",
      speechDurationMs: 340,
      utteranceMaxRms: 0.03,
      utteranceFrameCount: 24,
      utteranceStrongFrames: 0,
      assistantSpeaking: true,
    });

    assert.equal(scores.pInterruptValid < 0.62, true);
    assert.equal(scores.pNonSpeechMedia > 0.8, true);
  });
});
