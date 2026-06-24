/**
 * PR4: STT 增量 provider 自动检测
 *
 * 验证：
 *   1. 无 sherpa 模型 → canStreamPartials() false
 *   2. sherpa 可用 + 无显式配置 → 自动启用
 *   3. REMI_STT_INCREMENTAL_PROVIDER=sherpa-onnx 显式启用
 *   4. REMI_STT_INCREMENTAL_PROVIDER=none 显式禁用（即使 sherpa 可用）
 *   5. __resetIncrementalProviderCacheForTest() 清除缓存
 */
const assert = require("assert").strict;
const { withConfigEnv } = require("../helpers/config_test_utils");
const { sherpaSttRuntime } = require("../../voice/stt_sherpa_runtime");

function freshSttStream() {
  // Re-require to reset module-level cache (_cachedAutoIncremental = "uncached")
  const p = require.resolve("../../voice/stt_stream");
  delete require.cache[p];
  const { resetConfig } = require("../../server/config");
  resetConfig();
  const mod = require(p);
  return { stt: new mod.SttStream(), mod };
}

describe("STT incremental provider — PR4 auto-detect", () => {
  let origCanUseSherpa: () => boolean;

  beforeEach(() => {
    origCanUseSherpa = sherpaSttRuntime.canUseSherpa.bind(sherpaSttRuntime);
  });

  afterEach(() => {
    sherpaSttRuntime.canUseSherpa = origCanUseSherpa;
    // Always reset module cache so tests are independent
    delete require.cache[require.resolve("../../voice/stt_stream")];
    const { resetConfig } = require("../../server/config");
    resetConfig();
  });

  it("sherpa 不可用 + 无显式配置 → canStreamPartials() false", () => {
    sherpaSttRuntime.canUseSherpa = () => false;
    const { stt } = freshSttStream();
    assert.equal(stt.canStreamPartials(), false);
  });

  it("sherpa 可用 + 无显式配置 → 自动检测为 sherpa-onnx → canStreamPartials() true", () => {
    sherpaSttRuntime.canUseSherpa = () => true;
    const { stt } = freshSttStream();
    assert.equal(stt.canStreamPartials(), true);
  });

  it("REMI_STT_INCREMENTAL_PROVIDER=sherpa-onnx + sherpa 可用 → true", () => {
    sherpaSttRuntime.canUseSherpa = () => true;
    withConfigEnv({ REMI_STT_INCREMENTAL_PROVIDER: "sherpa-onnx" }, () => {
      const { stt } = freshSttStream();
      assert.equal(stt.canStreamPartials(), true);
    });
  });

  it("REMI_STT_INCREMENTAL_PROVIDER=none 禁用自动检测（即使 sherpa 可用）", () => {
    sherpaSttRuntime.canUseSherpa = () => true;
    withConfigEnv({ REMI_STT_INCREMENTAL_PROVIDER: "none" }, () => {
      const { stt } = freshSttStream();
      assert.equal(stt.canStreamPartials(), false);
    });
  });

  it("__resetIncrementalProviderCacheForTest() 清除缓存后重新检测", () => {
    sherpaSttRuntime.canUseSherpa = () => true;
    const { stt, mod } = freshSttStream();
    assert.equal(stt.canStreamPartials(), true); // caches "sherpa-onnx"

    // Now sherpa becomes unavailable and cache is reset
    sherpaSttRuntime.canUseSherpa = () => false;
    mod.__resetIncrementalProviderCacheForTest();
    assert.equal(stt.canStreamPartials(), false); // re-checks → null
  });

  it("STT_INCREMENTAL_PROVIDER 旧变量名仍生效（向后兼容）", () => {
    sherpaSttRuntime.canUseSherpa = () => true;
    withConfigEnv({ STT_INCREMENTAL_PROVIDER: "sherpa-onnx" }, () => {
      const { stt } = freshSttStream();
      assert.equal(stt.canStreamPartials(), true);
    });
  });
});
