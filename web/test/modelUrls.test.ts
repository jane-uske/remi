import type {} from "mocha";

const assert = require("node:assert/strict");

describe("modelUrls", () => {
  const modulePath = "../src/lib/avatar/modelUrls";

  function loadFreshModule() {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
  }

  const originalModelId = process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID;
  const originalModelUrl = process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL;

  afterEach(() => {
    if (typeof originalModelId === "string") {
      process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID = originalModelId;
    } else {
      delete process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID;
    }

    if (typeof originalModelUrl === "string") {
      process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL = originalModelUrl;
    } else {
      delete process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL;
    }
  });

  it("defaults to the local Hiyori public asset", () => {
    delete process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID;
    delete process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL;

    const modelUrls = loadFreshModule();

    assert.equal(modelUrls.getDefaultLive2DModelId(), "hiyori-pro");
    assert.equal(
      modelUrls.getDefaultLive2DModelUrl(),
      "/live2d/hiyori-pro/hiyori_pro_t11.model3.json",
    );
    assert.equal(modelUrls.getDefaultLive2DModelSource(), "public_asset");
  });

  it("supports selecting a registered model id", () => {
    process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID = "haru";
    delete process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL;

    const modelUrls = loadFreshModule();

    assert.equal(modelUrls.getDefaultLive2DModelId(), "haru");
    assert.match(
      modelUrls.getDefaultLive2DModelUrl(),
      /haru_greeter_t03\.model3\.json$/,
    );
    assert.equal(modelUrls.getDefaultLive2DModelSource(), "remote_url");
  });

  it("keeps raw URL override as the highest-priority debug path", () => {
    process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID = "hiyori-pro";
    process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL = "127.0.0.1:4010/model.model3.json";

    const modelUrls = loadFreshModule();

    assert.equal(modelUrls.getDefaultLive2DModelId(), "url-override");
    assert.equal(
      modelUrls.getDefaultLive2DModelUrl(),
      "http://127.0.0.1:4010/model.model3.json",
    );
    assert.equal(modelUrls.getDefaultLive2DModelSource(), "env");
  });
});
