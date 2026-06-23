// ── CIO-P2: ImageRegistry + 指代消解单测 ─────────────────────────────
import { expect } from "chai";
import {
  registerImage,
  getRegistry,
  clearRegistry,
  resolveImageReference,
} from "../../brains/contextual_intent/image_registry";
import { classifyContextualIntent } from "../../brains/contextual_intent/classifier";
import type { ImageRegistryEntry } from "../../brains/contextual_intent/types";

function makeEntry(overrides?: Partial<ImageRegistryEntry>): ImageRegistryEntry {
  return {
    id: crypto.randomUUID(),
    origin: "generated",
    descriptor: "猫咪在阳台上晒太阳",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("CIO-P2: ImageRegistry", () => {
  const testConnId = "test-conn-p2";

  afterEach(() => clearRegistry(testConnId));

  it("注册后可获取", () => {
    const entry = makeEntry();
    registerImage(testConnId, entry);
    const reg = getRegistry(testConnId);
    expect(reg).to.have.length(1);
    expect(reg[0].id).to.equal(entry.id);
  });

  it("FIFO 淘汰超过 20 条", () => {
    for (let i = 0; i < 25; i++) {
      registerImage(testConnId, makeEntry({ id: `img-${i}` }));
    }
    const reg = getRegistry(testConnId);
    expect(reg).to.have.length(20);
    // 最旧的 5 条被淘汰
    expect(reg[0].id).to.equal("img-5");
    expect(reg[19].id).to.equal("img-24");
  });

  it("未知 connId 返回空数组", () => {
    expect(getRegistry("nonexistent")).to.deep.equal([]);
  });

  it("clearRegistry 清空注册表", () => {
    registerImage(testConnId, makeEntry());
    clearRegistry(testConnId);
    expect(getRegistry(testConnId)).to.deep.equal([]);
  });
});

describe("CIO-P2: resolveImageReference", () => {
  it("空 registry → null", () => {
    expect(resolveImageReference("上一张", [])).to.be.null;
  });

  it("Rule 1: 「上一张」 → 最近一条", () => {
    const entries = [
      makeEntry({ id: "cat", descriptor: "猫" }),
      makeEntry({ id: "sunset", descriptor: "夕阳" }),
    ];
    const ref = resolveImageReference("把上一张改成夜里的", entries);
    expect(ref).to.not.be.null;
    expect(ref!.resolvedImageId).to.equal("sunset");
    expect(ref!.confidence).to.equal(0.9);
  });

  it("Rule 1: 「这张」 → 最近一条", () => {
    const entries = [makeEntry({ id: "only" })];
    const ref = resolveImageReference("这张好好看", entries);
    expect(ref!.resolvedImageId).to.equal("only");
  });

  it("Rule 2: 「那张猫」 → descriptor 含猫的", () => {
    const entries = [
      makeEntry({ id: "cat", descriptor: "猫咪在阳台" }),
      makeEntry({ id: "sunset", descriptor: "夕阳西下" }),
    ];
    const ref = resolveImageReference("那张猫再画一张", entries);
    expect(ref).to.not.be.null;
    expect(ref!.resolvedImageId).to.equal("cat");
    expect(ref!.confidence).to.equal(0.7);
  });

  it("Rule 2: 关键词无匹配 → resolvedImageId=null", () => {
    const entries = [makeEntry({ id: "cat", descriptor: "猫" })];
    const ref = resolveImageReference("那张狗", entries);
    expect(ref).to.not.be.null;
    expect(ref!.resolvedImageId).to.be.null;
    expect(ref!.confidence).to.equal(0);
  });

  it("Rule 3: 「她」 → 最近上传图", () => {
    const entries = [
      makeEntry({ id: "gen1", origin: "generated" }),
      makeEntry({ id: "upload1", origin: "uploaded", descriptor: "角色立绘" }),
      makeEntry({ id: "gen2", origin: "generated" }),
    ];
    const ref = resolveImageReference("按她这个感觉画", entries);
    expect(ref).to.not.be.null;
    expect(ref!.resolvedImageId).to.equal("upload1");
    expect(ref!.confidence).to.equal(0.8);
  });

  it("Rule 3: 「这个角色」无上传图 → fallback 最近一条", () => {
    const entries = [
      makeEntry({ id: "gen1", origin: "generated" }),
      makeEntry({ id: "gen2", origin: "generated" }),
    ];
    const ref = resolveImageReference("这个角色再来一张", entries);
    expect(ref!.resolvedImageId).to.equal("gen2");
    expect(ref!.confidence).to.equal(0.5);
  });

  it("无指代表达 → null", () => {
    const entries = [makeEntry()];
    const ref = resolveImageReference("今天天气真好", entries);
    expect(ref).to.be.null;
  });
});

describe("CIO-P2: classifier with imageRegistry", () => {
  it("生图意图 + registry 有图 → reference 被填充", () => {
    const registry = [
      makeEntry({ id: "prev-cat", descriptor: "猫咪" }),
    ];
    const r = classifyContextualIntent({
      userMessage: "把上一张改成夜里的",
      hasImage: false,
      hasSessionImage: true,
      imageRegistry: registry,
    });
    expect(r.image).to.not.be.null;
    expect(r.image!.reference).to.not.be.null;
    expect(r.image!.reference!.resolvedImageId).to.equal("prev-cat");
  });

  it("有指代但无生图意图 → image.action=none + reference 有值", () => {
    const registry = [
      makeEntry({ id: "uploaded-char", origin: "uploaded", descriptor: "角色" }),
    ];
    const r = classifyContextualIntent({
      userMessage: "她好可爱",
      hasImage: false,
      hasSessionImage: false,
      imageRegistry: registry,
    });
    // "她" 命中 PERSON_REF_RE → reference 有值
    expect(r.image).to.not.be.null;
    expect(r.image!.action).to.equal("none");
    expect(r.image!.reference!.resolvedImageId).to.equal("uploaded-char");
  });

  it("无 registry 时不影响 P1 行为", () => {
    const r = classifyContextualIntent({
      userMessage: "画一张猫",
      hasImage: false,
      hasSessionImage: false,
    });
    expect(r.image).to.not.be.null;
    expect(r.image!.action).to.equal("generate");
    expect(r.image!.reference).to.be.undefined;
  });
});
