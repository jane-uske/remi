const assert = require("assert").strict;
const {
  describeActiveVideoTask,
} = require("../../capabilities/video_generation/video_generation_capability");

describe("describeActiveVideoTask — 假视频事实锚", () => {
  it("无后台任务时明确告诉 LLM 没有任务、不要编造进度", () => {
    const s = describeActiveVideoTask("conn-without-any-task-xyz");
    assert.ok(s.includes("没有"), `应说明没有任务: ${s}`);
    assert.ok(/不要|绝不/.test(s), `应禁止编造: ${s}`);
    // 没有任务时绝不能出现"在后台生成中"这类肯定有任务的话术
    assert.ok(
      !s.includes("在后台生成中"),
      `无任务时不应说在生成: ${s}`,
    );
  });
});
