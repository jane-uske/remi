import type {} from "mocha";

const assert = require("node:assert/strict");
const ReactLib = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { ChatWindow } = require("../src/components/ChatWindow");

describe("ChatWindow", () => {
  it("renders a compact overlay-friendly scroller density for stage-first layouts", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(ChatWindow, {
        messages: [
          {
            id: "m1",
            role: "rem",
            text: "我会在这里接着说。",
          },
        ],
        hasMoreHistory: false,
        loadingMoreHistory: false,
        onLoadMore: () => {},
        listMutation: "idle",
        listMutationNonce: 0,
        sttPartialText: "",
        streamingText: "",
        statusModel: {
          badgeLabel: "在线",
          responseBusy: false,
        },
      }),
    );

    assert.ok(markup.includes("min-h-0"));
    assert.ok(markup.includes("md:flex-1"));
    assert.ok(markup.includes("max-h-[min(34svh,19rem)]"));
    assert.ok(markup.includes("gap-1.5"));
    assert.ok(markup.includes("px-3"));
    assert.ok(markup.includes("remi-chat-scroll-fade"));
  });

  it("renders the supplied status model badge and busy state", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(ChatWindow, {
        messages: [
          {
            id: "m1",
            role: "user",
            text: "你好",
          },
        ],
        hasMoreHistory: false,
        loadingMoreHistory: false,
        onLoadMore: () => {},
        listMutation: "idle",
        listMutationNonce: 0,
        sttPartialText: "",
        streamingText: "",
        statusModel: {
          badgeLabel: "Remi 正在回复",
          responseBusy: true,
        },
      }),
    );

    assert.ok(markup.includes("Remi 正在回复"));
    assert.ok(markup.includes('aria-busy="true"'));
  });

  it("renders a shared prepare cue when the conversation model enters speaking_prepare", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(ChatWindow, {
        messages: [],
        hasMoreHistory: false,
        loadingMoreHistory: false,
        onLoadMore: () => {},
        listMutation: "idle",
        listMutationNonce: 0,
        sttPartialText: "",
        streamingText: "",
        statusModel: {
          badgeLabel: "开口中",
          responseBusy: true,
        },
        performanceModel: {
          phase: "speaking_prepare",
          phaseStartedAtMs: 9_980,
          phaseCueText: "Remi 正在起句",
          attentionTarget: "front",
          energyLevel: 0.52,
          languageBeat: {
            channel: "none",
            text: "",
            textLength: 0,
            tokenCount: 0,
            clauseIndex: 0,
            boundary: "none",
            emphasis: 0,
            progress: 0,
            cadenceMs: 42,
            seed: 0,
          },
          chatSync: {
            statusLabel: "开口中",
            bubbleTone: "preparing",
            showPreparingBubble: true,
            showThinkingPulse: false,
            showListeningPulse: false,
            showYieldClamp: false,
            revealCadenceMs: 24,
            tailHoldMs: 0,
            emphasisStrength: 0,
            displayStreamingText: "",
            displayPartialText: "",
          },
          avatarSync: {
            mouthFloor: 0.12,
            gazeBiasX: 0.05,
            gazeBiasY: 0.02,
            headImpulse: 0.28,
            bodyImpulse: 0.24,
            yieldClamp: 0,
            attentivePulse: 0,
          },
        },
      }),
    );

    assert.ok(markup.includes('data-chat-presence-phase="speaking_prepare"'));
    assert.ok(markup.includes('data-chat-stream-phase="preparing"'));
    assert.ok(markup.includes("正在起句"));
    assert.ok(markup.includes("remi-typing-dot"));
  });

  it("renders a thinking reply indicator before the first streamed token arrives", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(ChatWindow, {
        messages: [
          {
            id: "m1",
            role: "user",
            text: "你好",
          },
        ],
        hasMoreHistory: false,
        loadingMoreHistory: false,
        onLoadMore: () => {},
        listMutation: "idle",
        listMutationNonce: 0,
        sttPartialText: "",
        streamingText: "",
        statusModel: {
          badgeLabel: "Remi 正在回复",
          responseBusy: true,
        },
        performanceModel: {
          phase: "thinking",
          phaseStartedAtMs: 9_960,
          phaseCueText: "Remi 正在回复",
          attentionTarget: "inner",
          energyLevel: 0.24,
          languageBeat: {
            channel: "none",
            text: "",
            textLength: 0,
            tokenCount: 0,
            clauseIndex: 0,
            boundary: "none",
            emphasis: 0,
            progress: 0,
            cadenceMs: 40,
            seed: 0,
          },
          chatSync: {
            statusLabel: "Remi 正在回复",
            bubbleTone: "thinking",
            showPreparingBubble: true,
            showThinkingPulse: true,
            showListeningPulse: false,
            showYieldClamp: false,
            revealCadenceMs: 28,
            tailHoldMs: 0,
            emphasisStrength: 0,
            displayStreamingText: "",
            displayPartialText: "",
          },
          avatarSync: {
            mouthFloor: 0.01,
            gazeBiasX: -0.08,
            gazeBiasY: -0.2,
            headImpulse: -0.08,
            bodyImpulse: -0.04,
            yieldClamp: 0,
            attentivePulse: 0,
          },
        },
      }),
    );

    assert.ok(markup.includes('data-chat-presence-phase="thinking"'));
    assert.ok(markup.includes('data-chat-stream-phase="thinking"'));
    assert.ok(markup.includes("Remi 正在回复"));
    assert.ok(markup.includes("正在回复"));
    assert.ok(markup.includes("remi-typing-dot"));
  });

  it("renders the reply indicator from awaitingAssistantReply before performance model catches up", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(ChatWindow, {
        messages: [
          {
            id: "m1",
            role: "user",
            text: "你好",
          },
        ],
        hasMoreHistory: false,
        loadingMoreHistory: false,
        onLoadMore: () => {},
        listMutation: "idle",
        listMutationNonce: 0,
        sttPartialText: "",
        streamingText: "",
        awaitingAssistantReply: true,
        statusModel: {
          badgeLabel: null,
          responseBusy: false,
        },
        performanceModel: null,
      }),
    );

    assert.ok(markup.includes("Remi 正在回复"));
    assert.ok(markup.includes("正在回复"));
    assert.ok(markup.includes('data-chat-stream-phase="thinking"'));
    assert.ok(markup.includes('aria-busy="true"'));
  });

  it("renders an explicit yield cue so interrupted state is visibly distinct", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(ChatWindow, {
        messages: [],
        hasMoreHistory: false,
        loadingMoreHistory: false,
        onLoadMore: () => {},
        listMutation: "idle",
        listMutationNonce: 0,
        sttPartialText: "",
        streamingText: "等一下，我刚刚要说的是",
        statusModel: {
          badgeLabel: "先让给你",
          responseBusy: true,
        },
        performanceModel: {
          phase: "yield",
          phaseStartedAtMs: 9_990,
          phaseCueText: "Remi 先停一下，让你接话",
          attentionTarget: "user",
          energyLevel: 0.1,
          languageBeat: {
            channel: "assistant",
            text: "等一下，我刚刚要说的是",
            textLength: 11,
            tokenCount: 8,
            clauseIndex: 1,
            boundary: "comma",
            emphasis: 0.12,
            progress: 0.5,
            cadenceMs: 28,
            seed: 1.2,
          },
          chatSync: {
            statusLabel: "先让给你",
            bubbleTone: "yield",
            showPreparingBubble: false,
            showThinkingPulse: false,
            showListeningPulse: false,
            showYieldClamp: true,
            revealCadenceMs: 24,
            tailHoldMs: 0,
            emphasisStrength: 0.12,
            displayStreamingText: "",
            displayPartialText: "",
          },
          avatarSync: {
            mouthFloor: 0,
            gazeBiasX: -0.1,
            gazeBiasY: -0.2,
            headImpulse: -0.4,
            bodyImpulse: -0.3,
            yieldClamp: 1,
            attentivePulse: 0,
          },
        },
      }),
    );

    assert.ok(markup.includes('data-chat-stream-phase="yield"'));
    assert.ok(markup.includes("Remi 先停一下，让你接话"));
  });

  it("renders an explicit active cue so speaking active is no longer visually collapsed into the other phases", () => {
    const markup = renderToStaticMarkup(
      ReactLib.createElement(ChatWindow, {
        messages: [],
        hasMoreHistory: false,
        loadingMoreHistory: false,
        onLoadMore: () => {},
        listMutation: "idle",
        listMutationNonce: 0,
        sttPartialText: "",
        streamingText: "好的，我们继续！",
        statusModel: {
          badgeLabel: null,
          responseBusy: false,
        },
        performanceModel: {
          phase: "speaking_active",
          phaseStartedAtMs: 9_900,
          phaseCueText: "Remi 正在顺着这句说",
          attentionTarget: "front",
          energyLevel: 0.72,
          languageBeat: {
            channel: "assistant",
            text: "好的，我们继续！",
            textLength: 8,
            tokenCount: 6,
            clauseIndex: 2,
            boundary: "emphasis",
            emphasis: 0.58,
            progress: 0.42,
            cadenceMs: 24,
            seed: 7.6,
          },
          chatSync: {
            statusLabel: "说话中",
            bubbleTone: "speaking",
            showPreparingBubble: false,
            showThinkingPulse: false,
            showListeningPulse: false,
            showYieldClamp: false,
            revealCadenceMs: 24,
            tailHoldMs: 180,
            emphasisStrength: 0.58,
            displayStreamingText: "好的，我们继续！",
            displayPartialText: "",
          },
          avatarSync: {
            mouthFloor: 0.14,
            gazeBiasX: 0.06,
            gazeBiasY: 0.01,
            headImpulse: 0.3,
            bodyImpulse: 0.34,
            yieldClamp: 0,
            attentivePulse: 0,
          },
        },
      }),
    );

    assert.ok(markup.includes('data-chat-stream-phase="speaking_active"'));
    assert.ok(markup.includes("Remi 正在顺着这句说"));
  });
});
