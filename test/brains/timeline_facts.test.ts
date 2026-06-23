import { expect } from "chai";
import {
  formatTimelineFactsBlock,
  recallTimelineFacts,
} from "../../brains/timeline_facts";
import type { TemporalFact } from "../../storage/repositories/temporal_facts_repository";
import type { RemiSessionContext } from "../../brains/remi_session_context";

function fact(subject: string, predicate: string, object: string): TemporalFact {
  return {
    id: "x",
    userId: "u",
    subject,
    predicate,
    object,
    tValid: new Date(),
    tInvalid: null,
    recordedAt: new Date(),
    salience: 0.5,
  };
}

describe("M3-P2 timeline facts formatting", () => {
  it("empty facts → undefined (prompt falls back to Tier0–3)", () => {
    expect(formatTimelineFactsBlock([])).to.equal(undefined);
  });

  it("formats subject/predicate/object lines under a restraint heading", () => {
    const block = formatTimelineFactsBlock([
      fact("用户的工作", "状态", "在还债"),
      fact("用户", "居住城市", "上海"),
    ]);
    expect(block).to.be.a("string");
    expect(block).to.contain("用户的工作 状态 在还债");
    expect(block).to.contain("用户 居住城市 上海");
    // W-PRES-01 克制指引必须在场，避免 Remi 硬拉这些事实
    expect(block).to.contain("别硬拉");
  });

  it("renders one line per fact", () => {
    const block = formatTimelineFactsBlock([fact("用户", "养了", "一只猫")]) ?? "";
    const factLines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(factLines).to.have.length(1);
  });
});

// 超时降级分支依赖运行时 getConfig（其他 M3 单测同样不初始化 config），
// 故此处只覆盖 getConfig 调用之前的早返回分支；超时降级靠 typecheck +
// 标准 Promise.race + finally clearTimeout 模式保证，由集成路径验证。
describe("M3-P2 recallTimelineFacts early-return guards", () => {
  it("no repo → undefined", async () => {
    const ctx = { temporalFactsRepo: null, userId: "u" } as unknown as RemiSessionContext;
    expect(await recallTimelineFacts(ctx)).to.equal(undefined);
  });

  it("empty userId → undefined", async () => {
    const ctx = {
      temporalFactsRepo: { recall: async () => [] },
      userId: "",
    } as unknown as RemiSessionContext;
    expect(await recallTimelineFacts(ctx)).to.equal(undefined);
  });
});
