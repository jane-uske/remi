const assert = require("assert").strict;

const {
  collectMemorySnapshot,
  evaluateMemoryAlert,
  resolveResourceMonitorConfig,
  shouldEmitMemoryAlert,
} = require("../../server/resource_monitor");

describe("resource monitor", () => {
  it("does not warn just because heap fill ratio is high when rss and heap limit usage are safe", () => {
    const snapshot = collectMemorySnapshot(
      {
        rss: 420 * 1024 * 1024,
        heapUsed: 280 * 1024 * 1024,
        heapTotal: 300 * 1024 * 1024,
        external: 20 * 1024 * 1024,
        arrayBuffers: 4 * 1024 * 1024,
      },
      {
        heap_size_limit: 4096 * 1024 * 1024,
      },
      16 * 1024 * 1024 * 1024,
      2 * 1024 * 1024 * 1024,
    );

    const alert = evaluateMemoryAlert(snapshot, resolveResourceMonitorConfig({}));
    assert.equal(alert.level, "normal");
    assert.deepEqual(alert.reasons, []);
    assert.equal(Number((snapshot.heapFillRatio * 100).toFixed(0)) >= 90, true);
    assert.equal(Number((snapshot.heapLimitRatio * 100).toFixed(0)) < 10, true);
  });

  it("warns when rss crosses the configured absolute threshold", () => {
    const config = resolveResourceMonitorConfig({
      REMI_MEMORY_WARN_RSS_MB: "512",
      REMI_MEMORY_CRITICAL_RSS_MB: "1024",
    });
    const snapshot = collectMemorySnapshot(
      {
        rss: 700 * 1024 * 1024,
        heapUsed: 220 * 1024 * 1024,
        heapTotal: 300 * 1024 * 1024,
        external: 16 * 1024 * 1024,
        arrayBuffers: 2 * 1024 * 1024,
      },
      {
        heap_size_limit: 4096 * 1024 * 1024,
      },
      16 * 1024 * 1024 * 1024,
      4 * 1024 * 1024 * 1024,
    );

    const alert = evaluateMemoryAlert(snapshot, config);
    assert.equal(alert.level, "warn");
    assert.ok(alert.reasons.some((reason) => reason.includes("rss=")));
  });

  it("warns when heap usage approaches the V8 heap limit", () => {
    const config = resolveResourceMonitorConfig({
      REMI_MEMORY_WARN_HEAP_LIMIT_RATIO: "0.7",
      REMI_MEMORY_CRITICAL_HEAP_LIMIT_RATIO: "0.85",
    });
    const snapshot = collectMemorySnapshot(
      {
        rss: 600 * 1024 * 1024,
        heapUsed: 3100 * 1024 * 1024,
        heapTotal: 3300 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 2 * 1024 * 1024,
      },
      {
        heap_size_limit: 4096 * 1024 * 1024,
      },
      16 * 1024 * 1024 * 1024,
      3 * 1024 * 1024 * 1024,
    );

    const alert = evaluateMemoryAlert(snapshot, config);
    assert.equal(alert.level, "warn");
    assert.ok(alert.reasons.some((reason) => reason.includes("heapUsed/heapLimit")));
  });

  it("throttles repeated alerts unless severity changes", () => {
    const previous = {
      level: "warn",
      signature: "warn:rss=700MB >= 512MB",
      lastLoggedAt: 10_000,
    };

    assert.equal(
      shouldEmitMemoryAlert(
        previous,
        { level: "warn", reasons: ["rss=700MB >= 512MB"] },
        10_500,
        60_000,
      ),
      false,
    );
    assert.equal(
      shouldEmitMemoryAlert(
        previous,
        { level: "critical", reasons: ["rss=1200MB >= 1024MB"] },
        10_500,
        60_000,
      ),
      true,
    );
    assert.equal(
      shouldEmitMemoryAlert(
        previous,
        { level: "normal", reasons: [] },
        10_500,
        60_000,
      ),
      true,
    );
  });
});
