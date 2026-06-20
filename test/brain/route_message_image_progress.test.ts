const assert = require("assert").strict;

const { RemiSessionContext } = require("../../brains/remi_session_context");
const { routeMessage } = require("../../brains/context_orchestrator");

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

describe("routeMessage image generation progress", () => {
  it("streams a visible ComfyUI generation hint before the slow image result", async () => {
    const restoreEnv = applyEnv({
      REMI_IMAGE_INTENT_LLM_ENABLED: "0",
      COMFYUI_ENABLED: "1",
    });
    const ctx = new RemiSessionContext("image-progress-test");
    const stream = routeMessage(ctx, "帮我画一张夕阳下的海", "neutral", undefined, {
      inputSource: "text",
    });

    const first = await stream.next();

    assert.equal(first.done, false);
    assert.match(String(first.value), /ComfyUI 正在生成/);
    await stream.return?.(undefined);
    restoreEnv();
  });
});
