const assert = require("assert").strict;

const {
  classifyModeIntent,
} = require("../../capabilities/mode_control/mode_control_capability");

describe("adult-mode intent", () => {
  it("recognizes enable commands", () => {
    for (const message of [
      "开启成人模式",
      "进入成人模式",
      "打开成人模式吧",
      "帮我开启nsfw模式",
      "切换到成人模式",
    ]) {
      assert.equal(classifyModeIntent(message), "enable", message);
    }
  });

  it("recognizes disable commands (checked before enable)", () => {
    for (const message of [
      "退出成人模式",
      "关闭成人模式",
      "我想关掉成人模式",
      "结束成人模式",
    ]) {
      assert.equal(classifyModeIntent(message), "disable", message);
    }
  });

  it("does not toggle on a bare mention without an action verb", () => {
    for (const message of ["成人模式是什么", "你有成人模式吗"]) {
      assert.equal(classifyModeIntent(message), "none", message);
    }
  });

  it("returns none for unrelated messages", () => {
    assert.equal(classifyModeIntent("今天天气不错"), "none");
    assert.equal(classifyModeIntent("画一只猫"), "none");
    assert.equal(classifyModeIntent(""), "none");
  });
});
