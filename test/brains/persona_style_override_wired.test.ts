// ── CIO Wired: styleOverride persistent + 增量追加 单测 ──────────────
import { expect } from "chai";
import {
  resolvePersonaStyleDirective,
  decayPersonaStyleOverride,
  hasPersistentKeyword,
  buildPersonaStyleOverrideGuidance,
  type PersonaStyleOverride,
} from "../../persona/style_override";

function baseOverride(overrides?: Partial<PersonaStyleOverride>): PersonaStyleOverride {
  return {
    humorBoost: false,
    teasingMode: "off",
    assistantySuppression: false,
    familiarityBoost: false,
    romanceBoost: false,
    roleplayStyle: "御姐",
    remainingTurns: 6,
    sourceText: "扮演御姐",
    ...overrides,
  };
}

describe("CIO Wired: persistent 长期模式", () => {
  it("「以后都这样说话」→ persistent=true", () => {
    const r = resolvePersonaStyleDirective({
      userMessage: "扮演御姐，以后都这样跟我说话",
    });
    expect(r).to.not.be.null;
    expect(r!.kind).to.equal("set");
    if (r!.kind === "set") {
      expect(r!.override.persistent).to.equal(true);
    }
  });

  it("「从现在起一直」→ persistent=true", () => {
    const r = resolvePersonaStyleDirective({
      userMessage: "扮演御姐，从现在起一直这样",
    });
    expect(r!.kind).to.equal("set");
    if (r!.kind === "set") expect(r!.override.persistent).to.equal(true);
  });

  it("无长期关键词 → persistent 不设", () => {
    const r = resolvePersonaStyleDirective({
      userMessage: "扮演御姐",
    });
    expect(r!.kind).to.equal("set");
    if (r!.kind === "set") {
      expect(r!.override.persistent).to.not.equal(true);
    }
  });

  it("persistent override 不被衰减", () => {
    const ov = baseOverride({ persistent: true, remainingTurns: 6 });
    expect(decayPersonaStyleOverride(ov)).to.deep.equal(ov);
  });

  it("非 persistent override 正常衰减", () => {
    const ov = baseOverride({ persistent: false, remainingTurns: 2 });
    const decayed = decayPersonaStyleOverride(ov);
    expect(decayed).to.not.be.null;
    expect(decayed!.remainingTurns).to.equal(1);
  });

  it("persistent guidance 用「以后一直」措辞", () => {
    const ov = baseOverride({ persistent: true });
    const g = buildPersonaStyleOverrideGuidance(ov);
    expect(g).to.include("以后一直保持");
  });
});

describe("CIO Wired: 增量追加「再X一点」", () => {
  it("无现有 override → 「再骚一点」按新 set 处理（非增量 merge）", () => {
    // 没有 currentOverride，extractIncrementalStyle 命中但没有 base → 不走 merge 分支
    const r = resolvePersonaStyleDirective({
      userMessage: "再骚一点",
      currentOverride: null,
    });
    // "骚" 不在任何 EXPLICIT_*_PATTERNS 里，没有 roleplayStyle → hasMeaningfulStyleSignal=false → null
    expect(r).to.be.null;
  });

  it("有现有 override + 「再骚一点」→ roleplayStyle append「，更骚一点」", () => {
    const current = baseOverride({ roleplayStyle: "御姐" });
    const r = resolvePersonaStyleDirective({
      userMessage: "再骚一点",
      currentOverride: current,
    });
    expect(r!.kind).to.equal("set");
    if (r!.kind === "set") {
      expect(r!.override.roleplayStyle).to.include("御姐");
      expect(r!.override.roleplayStyle).to.include("更骚");
    }
  });

  it("有现有 override + 「更S一点」→ append", () => {
    const current = baseOverride({ roleplayStyle: "御姐" });
    const r = resolvePersonaStyleDirective({
      userMessage: "更S一点",
      currentOverride: current,
    });
    if (r!.kind === "set") {
      expect(r!.override.roleplayStyle).to.include("更S一点");
    }
  });

  it("有现有 override + 「再御一点」→ append", () => {
    const current = baseOverride({ roleplayStyle: "温柔" });
    const r = resolvePersonaStyleDirective({
      userMessage: "再御一点",
      currentOverride: current,
    });
    if (r!.kind === "set") {
      expect(r!.override.roleplayStyle).to.include("更御");
    }
  });

  it("增量追加 + 「以后都」→ persistent 保留", () => {
    const current = baseOverride({ roleplayStyle: "御姐", persistent: true });
    const r = resolvePersonaStyleDirective({
      userMessage: "以后都再骚一点",
      currentOverride: current,
    });
    if (r!.kind === "set") {
      expect(r!.override.persistent).to.equal(true);
    }
  });

  it("增量追加刷新 remainingTurns 回满值", () => {
    const current = baseOverride({ roleplayStyle: "御姐", remainingTurns: 1 });
    const r = resolvePersonaStyleDirective({
      userMessage: "再骚一点",
      currentOverride: current,
    });
    if (r!.kind === "set") {
      expect(r!.override.remainingTurns).to.be.greaterThan(1);
    }
  });

  it("清除指令无视 currentOverride", () => {
    const current = baseOverride({ roleplayStyle: "御姐" });
    const r = resolvePersonaStyleDirective({
      userMessage: "恢复正常",
      currentOverride: current,
    });
    expect(r!.kind).to.equal("clear");
  });
});

describe("CIO Wired: hasPersistentKeyword", () => {
  it("「以后都」命中", () => {
    expect(hasPersistentKeyword("以后都这样")).to.be.true;
  });
  it("「一直这样」命中", () => {
    expect(hasPersistentKeyword("一直这样说话")).to.be.true;
  });
  it("普通消息不命中", () => {
    expect(hasPersistentKeyword("今天天气真好")).to.be.false;
  });
});
