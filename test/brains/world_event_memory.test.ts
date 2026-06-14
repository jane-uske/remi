const assert = require("assert").strict;
const path = require("path");

/**
 * RW-P1-4b：验证世界事件 → episode MomentInput 的映射。
 * buildWorldEventMoment 是纯函数（不碰 DB），直接断言其产物。
 */
const { buildWorldEventMoment } = require(
  path.resolve(__dirname, "../../server/session/world_event.ts"),
);

describe("RW-P1-4b 世界事件 → 长期记忆映射", () => {
  it("种花事件映射成带 userId 的有效 episode", () => {
    const m = buildWorldEventMoment("flower_planted", "user-1");
    assert.equal(m.userId, "user-1");
    assert.ok(m.summary.includes("种"), "摘要应提到种花");
    assert.ok(m.topic.includes("花"), "话题应含花");
    assert.equal(m.unresolved, false);
    assert.ok(m.salience > 0 && m.salience <= 1, "salience 在 (0,1]");
    assert.ok(typeof m.kind === "string" && m.kind.length > 0);
  });

  it("点灯、回访各有不同的记忆内容", () => {
    const lantern = buildWorldEventMoment("lantern_lit", "u");
    const revisit = buildWorldEventMoment("revisit", "u");
    assert.ok(lantern.summary.includes("灯"), "点灯摘要应提到灯");
    assert.ok(revisit.summary.includes("回"), "回访摘要应提到回来");
    assert.notEqual(lantern.topic, revisit.topic, "不同事件话题应不同");
  });

  it("未知事件返回 null（不写垃圾记忆）", () => {
    assert.equal(buildWorldEventMoment("teleport", "u"), null);
    assert.equal(buildWorldEventMoment(undefined, "u"), null);
    assert.equal(buildWorldEventMoment("", "u"), null);
  });

  it("三种已知事件都能生成 episode", () => {
    for (const e of ["flower_planted", "lantern_lit", "revisit"]) {
      const m = buildWorldEventMoment(e, "u");
      assert.ok(m && m.summary && m.topic, `${e} 应生成有效 moment`);
    }
  });
});
