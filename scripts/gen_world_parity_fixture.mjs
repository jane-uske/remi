#!/usr/bin/env node
// ── 离线居家人生 P0 —— 黄金 fixture 生成器（一致性锁的"真相侧"）─────────────
//
// 目的：server 侧 world/*.ts 是 web/src/lib/world/*.ts 的逐字节移植。两份纯函数若
// 漂移会让归来叙事偏离 web 世界里的真实行为。这个脚本【在能 import web 的环境里】
// 跑 web 版的 scheduledBehaviorAt / weatherAt / worldTimePhaseAt，对一组固定 epoch
// （网格 + 种子随机，N≥1000）生成黄金 fixture JSON 提交进 test/world/fixtures/。
// server test（test/world/schedule_parity.test.ts）读这份 fixture，比对 world/* 输
// 出逐字节一致——漂移立刻红。
//
// 用法（从仓库根目录）：
//   node scripts/gen_world_parity_fixture.mjs
// 它会把 fixture 写到 test/world/fixtures/schedule_parity.json。
//
// 为什么用 web 版当真相：web 是这些确定性函数的原始来源（RemiWorld 渲染就用它）。
// server world/* 是为"服务端不能 import web"而做的镜像，必须跟住 web。
//
// 依赖 ts-node transpile-only 直接执行 web 的 .ts（这些文件是自包含纯函数，无 @/
// 别名、无 DOM/React import，可在 commonjs 下直接跑）。

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const outPath = resolve(repoRoot, "test/world/fixtures/schedule_parity.json");

// 在子进程里用 ts-node/register/transpile-only 加载 web 版，避免污染本进程的
// module resolution。脚本字符串内联，输出 JSON 到 stdout。
const driver = `
const path = require("path");
const repoRoot = ${JSON.stringify(repoRoot)};
const webDir = path.join(repoRoot, "web/src/lib/world");
const { scheduledBehaviorAt } = require(path.join(webDir, "behavior.ts"));
const { weatherAt } = require(path.join(webDir, "weather.ts"));
const { worldTimePhaseAt, worldTimeProfileAt } = require(path.join(webDir, "worldTime.ts"));

// 种子 LCG（确定性、可复现）。MAX/seed 固定 → 同样的 epoch 集合。
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const epochs = new Set();

// 1) 网格：覆盖一整天的每分钟（捕捉 phase 边界 5/11/17/21 时 + 多个 105s slot）。
//    基准日选一个固定 UTC 日，再叠加若干天偏移以覆盖不同 weather slot。
const BASE = Date.UTC(2026, 5, 24, 0, 0, 0); // 2026-06-24 00:00 UTC（与项目当前日期对齐）
for (let dayOffset = 0; dayOffset < 4; dayOffset++) {
  for (let minute = 0; minute < 24 * 60; minute += 7) {
    epochs.add(BASE + dayOffset * 86400_000 + minute * 60_000);
  }
}

// 2) 种子随机：在 ±400 天范围内撒点，覆盖各种 weather/phase/slot 组合。
const rng = makeRng(0xC0FFEE);
const RANGE_MS = 400 * 86400_000;
while (epochs.size < 1200) {
  const t = Math.floor(BASE + (rng() * 2 - 1) * RANGE_MS);
  epochs.add(t);
}

const samples = Array.from(epochs).sort((a, b) => a - b).map((epochMs) => {
  const w = weatherAt(epochMs);
  return {
    epochMs,
    behavior: scheduledBehaviorAt(epochMs),
    behaviorWithWeather: scheduledBehaviorAt(epochMs, w),
    weatherState: w.state,
    weatherLabel: w.label,
    indoorOnly: w.indoorOnly,
    phase: worldTimePhaseAt(epochMs),
    phaseLabel: worldTimeProfileAt(epochMs).label,
    behaviorPool: worldTimeProfileAt(epochMs).behaviorPool.slice(),
  };
});

process.stdout.write(JSON.stringify(samples));
`;

const res = spawnSync(
  process.execPath,
  ["--no-experimental-strip-types", "-r", "ts-node/register/transpile-only", "-e", driver],
  {
    cwd: repoRoot,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (res.status !== 0) {
  process.stderr.write(res.stderr || "fixture generation failed\n");
  process.exit(res.status ?? 1);
}

const samples = JSON.parse(res.stdout);
mkdirSync(dirname(outPath), { recursive: true });

const fixture = {
  // 这份 fixture 是确定性的：由 scripts/gen_world_parity_fixture.mjs 跑 web 版
  // (web/src/lib/world/*) 对固定网格 + 种子随机(seed=0xC0FFEE) epoch 生成。
  // 改了 web 或 server 任一份 world 纯函数后重跑：node scripts/gen_world_parity_fixture.mjs
  _meta: {
    generator: "scripts/gen_world_parity_fixture.mjs",
    source: "web/src/lib/world/{behavior,weather,worldTime}.ts",
    seed: "0xC0FFEE",
    count: samples.length,
    generatedAtNote: "deterministic — regenerate after editing any world/* pure fn",
  },
  samples,
};

writeFileSync(outPath, JSON.stringify(fixture, null, 0) + "\n");
process.stderr.write(`wrote ${samples.length} samples → ${outPath}\n`);
