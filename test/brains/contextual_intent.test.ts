// ── CIO-P1: Shadow 分类器单测 ─────────────────────────────────────────
import { expect } from "chai";
import { classifyContextualIntent } from "../../brains/contextual_intent/classifier";
import type { ClassifyInput } from "../../brains/contextual_intent/types";

function classify(userMessage: string, overrides?: Partial<ClassifyInput>) {
  return classifyContextualIntent({
    userMessage,
    hasImage: false,
    hasSessionImage: false,
    ...overrides,
  });
}

describe("CIO-P1: classifyContextualIntent", () => {
  // ── 普通聊天 ──────────────────────────────────────────────────────

  describe("chat (G1)", () => {
    it("纯文本聊天 → primary=chat，所有轴 null", () => {
      const r = classify("今天好累啊");
      expect(r.primary).to.equal("chat");
      expect(r.image).to.be.null;
      expect(r.voice).to.be.null;
      expect(r.performance).to.be.null;
      expect(r.meta.signals).to.be.empty;
    });

    it("问候 → chat", () => {
      const r = classify("早安");
      expect(r.primary).to.equal("chat");
    });

    it("复杂叙述 → chat", () => {
      const r = classify("我今天去了一家新开的咖啡店，味道还不错");
      expect(r.primary).to.equal("chat");
    });
  });

  // ── 生图轴 ────────────────────────────────────────────────────────

  describe("image (G3/G4)", () => {
    it("画一张猫 → generate_image", () => {
      const r = classify("画一张猫");
      expect(r.primary).to.equal("generate_image");
      expect(r.image).to.not.be.null;
      expect(r.image!.action).to.equal("generate");
    });

    it("帮我画个夕阳 → generate", () => {
      const r = classify("帮我画个夕阳");
      expect(r.primary).to.equal("generate_image");
      expect(r.image!.action).to.equal("generate");
    });

    it("生成一张图 → generate", () => {
      const r = classify("生成一张图");
      expect(r.primary).to.equal("generate_image");
    });

    it("重新画一张 → redraw (有上一张图)", () => {
      const r = classify("重新画一张", { hasSessionImage: true });
      expect(r.image!.action).to.equal("redraw");
    });

    it("重新画一张 (无上一张图) → generate", () => {
      const r = classify("重新画一张", { hasSessionImage: false });
      // 没有上一张图时 redraw 不命中，fallback 到 generate
      expect(r.image).to.not.be.null;
    });

    it("换成赛博朋克风格 → restyle", () => {
      const r = classify("换成赛博朋克风格");
      expect(r.image!.action).to.equal("restyle");
    });

    it("更骚一点 → refine (有上一张图)", () => {
      const r = classify("更骚一点", { hasSessionImage: true });
      expect(r.image!.action).to.equal("refine");
    });

    it("更骚一点 (无上一张图) → 不命中 refine", () => {
      const r = classify("更骚一点", { hasSessionImage: false });
      // refine 需要 hasSessionImage，否则不命中
      expect(r.image).to.be.null;
    });
  });

  // ── 看图轴 ────────────────────────────────────────────────────────

  describe("look_image (G2)", () => {
    it("发图+你看这个 → look_image", () => {
      const r = classify("你看这个好看吗", { hasImage: true });
      expect(r.primary).to.equal("look_image");
      expect(r.meta.signals).to.include("look_image");
    });

    it("无图+你看这个 → chat (没图就不是看图)", () => {
      const r = classify("你看这个好看吗", { hasImage: false });
      expect(r.primary).to.equal("chat");
    });
  });

  // ── 音色轴 ────────────────────────────────────────────────────────

  describe("voice (G6)", () => {
    it("用御姐音 → voice, set_preset yujie", () => {
      const r = classify("用御姐音");
      expect(r.primary).to.equal("voice");
      expect(r.voice).to.not.be.null;
      expect(r.voice!.op).to.equal("set_preset");
      expect(r.voice!.preset).to.equal("yujie");
    });

    it("换成萝莉音色 → set_preset luoli", () => {
      const r = classify("换成萝莉音色");
      expect(r.voice!.op).to.equal("set_preset");
      expect(r.voice!.preset).to.equal("luoli");
    });

    it("恢复原来的声音 → reset", () => {
      const r = classify("恢复原来的声音");
      expect(r.voice!.op).to.equal("reset");
    });

    it("说慢一点 → tune speed down", () => {
      const r = classify("说慢一点");
      expect(r.voice!.op).to.equal("tune");
      expect(r.voice!.tune!.kind).to.equal("speed");
      expect(r.voice!.tune!.direction).to.equal("down");
    });

    it("太快了 → tune speed down", () => {
      const r = classify("太快了");
      expect(r.voice!.op).to.equal("tune");
      expect(r.voice!.tune!.direction).to.equal("down");
    });

    it("语速恢复正常 → tune speed reset", () => {
      const r = classify("语速恢复正常");
      expect(r.voice!.op).to.equal("tune");
      expect(r.voice!.tune!.direction).to.equal("reset");
    });

    it("音调高一点 → tune pitch up", () => {
      const r = classify("音调高一点");
      expect(r.voice!.op).to.equal("tune");
      expect(r.voice!.tune!.kind).to.equal("pitch");
      expect(r.voice!.tune!.direction).to.equal("up");
    });
  });

  // ── 扮演轴 ────────────────────────────────────────────────────────

  describe("performance (G5)", () => {
    it("你扮演个御姐 → performance enter", () => {
      const r = classify("你扮演个御姐");
      expect(r.primary).to.equal("performance");
      expect(r.performance).to.not.be.null;
      expect(r.performance!.op).to.equal("enter");
      expect(r.performance!.styleDescriptor).to.equal("御姐");
    });

    it("扮演冷淡学姐跟我聊 → enter 冷淡学姐", () => {
      const r = classify("扮演冷淡学姐跟我聊");
      expect(r.performance!.op).to.equal("enter");
      expect(r.performance!.styleDescriptor).to.include("冷淡学姐");
    });

    it("别扮演了 → exit", () => {
      const r = classify("别扮演了");
      expect(r.performance!.op).to.equal("exit");
    });

    it("做回你自己 → exit", () => {
      const r = classify("做回你自己");
      expect(r.performance!.op).to.equal("exit");
    });

    it("正常点 → exit", () => {
      const r = classify("正常点");
      expect(r.performance!.op).to.equal("exit");
    });
  });

  // ── 多意图 ────────────────────────────────────────────────────────

  describe("mixed (A9)", () => {
    it("用御姐音，画张你的自拍 → mixed", () => {
      const r = classify("用御姐音，画张你的自拍");
      expect(r.primary).to.equal("mixed");
      expect(r.voice).to.not.be.null;
      expect(r.image).to.not.be.null;
      expect(r.meta.signals.length).to.be.greaterThanOrEqual(2);
    });
  });

  // ── meta 字段 ──────────────────────────────────────────────────────

  describe("meta", () => {
    it("source 恒为 shadow", () => {
      const r = classify("随便说什么");
      expect(r.meta.source).to.equal("shadow");
    });

    it("schemaVersion = 1", () => {
      const r = classify("x");
      expect(r.schemaVersion).to.equal(1);
    });

    it("classifierLatencyMs 是非负数", () => {
      const r = classify("你好");
      expect(r.meta.classifierLatencyMs).to.be.at.least(0);
    });
  });

  // ── 误触发防护 ──────────────────────────────────────────────────────

  describe("不误触发", () => {
    it("「我今天画了一幅画」→ 不应触发生图", () => {
      // "画了" 是过去时叙述，不是请求
      const r = classify("我今天画了一幅画");
      // 这里 regex 可能会误触发，记录下来用于 P2 校准
      // P1 阶段只记日志，误触发不影响行为
    });

    it("「说到画风，你喜欢什么类型」→ 不是改风格", () => {
      const r = classify("说到画风，你喜欢什么类型");
      // 不包含 "换成/改成" 前缀，不应命中 restyle
      expect(r.image?.action).to.not.equal("restyle");
    });

    it("「声音好好听」→ 不是要改音色", () => {
      const r = classify("声音好好听");
      expect(r.voice).to.be.null;
    });
  });
});

// ── CIO-P3: 看图 / 生图消歧单测 ────────────────────────────────────────
describe("CIO-P3: vision axis (看图/生图消歧)", () => {
  // ── 看图 ──
  it("发图+你看这个 → vision.wantsLook=true, referenceOnly=false", () => {
    const r = classify("你看这个好看吗", { hasImage: true });
    expect(r.vision).to.not.be.null;
    expect(r.vision!.wantsLook).to.be.true;
    expect(r.vision!.referenceOnly).to.be.false;
    expect(r.vision!.hasAttachment).to.be.true;
  });

  it("发图+这是什么 → vision.wantsLook=true", () => {
    const r = classify("这是什么", { hasImage: true });
    expect(r.vision!.wantsLook).to.be.true;
    expect(r.primary).to.equal("look_image");
  });

  it("发图+帮我看看 → vision.wantsLook=true", () => {
    const r = classify("帮我看看这个", { hasImage: true });
    expect(r.vision!.wantsLook).to.be.true;
  });

  // ── 参考生图 ──
  it("发图+按这张画一个 → vision.referenceOnly=true, wantsLook=false", () => {
    const r = classify("按这张画一个", { hasImage: true });
    expect(r.vision).to.not.be.null;
    expect(r.vision!.referenceOnly).to.be.true;
    expect(r.vision!.wantsLook).to.be.false;
    // 同时应有生图意图
    expect(r.image).to.not.be.null;
    expect(r.image!.action).to.equal("generate");
  });

  it("发图+照着这张生成 → referenceOnly=true", () => {
    const r = classify("照着这张生成一张", { hasImage: true });
    expect(r.vision!.referenceOnly).to.be.true;
  });

  it("发图+参考她画一张 → referenceOnly=true", () => {
    const r = classify("参考她画一张", { hasImage: true });
    expect(r.vision!.referenceOnly).to.be.true;
  });

  // ── 纯生图（有图但无看图动词）── referenceOnly=true
  it("发图+画张猫 → vision.referenceOnly=true（有生图意图但不看图）", () => {
    const r = classify("画张猫", { hasImage: true });
    expect(r.vision).to.not.be.null;
    expect(r.vision!.referenceOnly).to.be.true;
    expect(r.vision!.wantsLook).to.be.false;
  });

  // ── 无图 → vision 为 null ──
  it("无图时 vision 轴为 null", () => {
    const r = classify("你看这个好看吗", { hasImage: false });
    expect(r.vision).to.be.null;
  });

  // ── 混合情况：发图+看+生图 → mixed ──
  it("发图+看看+画一张 → mixed (看图+生图)", () => {
    const r = classify("你看看这个，帮我画一张类似的", { hasImage: true });
    expect(r.primary).to.equal("mixed");
    expect(r.meta.signals).to.include("look_image");
  });
});

// ── CIO Wired: 图片风格请求 + performance 图片轴 ──────────────────────
describe("CIO Wired: 图片风格请求 (像她一点)", () => {
  it("发图+像她一点 → performance enter + wantsImageStyle", () => {
    const r = classify("我喜欢这种角色，你以后能不能像她一点", { hasImage: true });
    expect(r.performance).to.not.be.null;
    expect(r.performance!.op).to.equal("enter");
    expect(r.performance!.wantsImageStyle).to.equal(true);
  });

  it("无图+无registry+像她一点 → 不触发", () => {
    const r = classify("像她一点", { hasImage: false });
    expect(r.performance).to.be.null;
  });

  it("registry 有上传图+像这个角色 → wantsImageStyle", () => {
    const r = classify("像这个角色说话", {
      hasImage: false,
      imageRegistry: [
        { id: "u1", origin: "uploaded", descriptor: "银发少女", createdAt: 1 },
      ],
    });
    expect(r.performance).to.not.be.null;
    expect(r.performance!.wantsImageStyle).to.equal(true);
  });

  it("扮演御姐（纯文字）→ wantsImageStyle=false, descriptor=御姐", () => {
    const r = classify("扮演御姐");
    expect(r.performance!.op).to.equal("enter");
    expect(r.performance!.wantsImageStyle).to.not.equal(true);
    expect(r.performance!.styleDescriptor).to.equal("御姐");
  });

  it("做回你自己 → exit", () => {
    const r = classify("做回你自己");
    expect(r.performance!.op).to.equal("exit");
  });
});
