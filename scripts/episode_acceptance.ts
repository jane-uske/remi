import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { initDatabase, closeDatabase, query } from "../storage/database";
import { ensureStorageUser } from "../storage/repositories/dev_identity";
import { getPgMemoryRepository } from "../storage/repositories/pg_memory_repository";
import {
  deleteEpisodesByUser,
  getEpisodesByUser,
  type DbEpisode,
} from "../storage/repositories/episode_repository";
import { deleteMemoriesByUser } from "../storage/repositories/memory_repository";
import { checkEmbeddingHealth } from "../llm/embedding_client";
import { runSlowBrain } from "../brains/slow_brain";
import { SlowBrainStore } from "../brains/slow_brain_store";
import type { PromptMessage } from "../brain/prompt_builder";

type ScenarioId = "debt_pressure" | "work_sleep" | "pet_liability";

type CliArgs = {
  scenarios: ScenarioId[];
  keepData: boolean;
  json: boolean;
};

type ScenarioTurn = {
  userMessage: string;
  assistantReply: string;
};

type ScenarioDefinition = {
  id: ScenarioId;
  label: string;
  turns: ScenarioTurn[];
  expectEpisode: (episodes: DbEpisode[]) => string | null;
};

type ScenarioResult = {
  id: ScenarioId;
  label: string;
  userId: string;
  episodesBefore: number;
  episodesAfter: number;
  createdEpisodes: DbEpisode[];
};

async function withMainLlmDisabled<T>(run: () => Promise<T>): Promise<T> {
  const previous = {
    key: process.env.key,
    base_url: process.env.base_url,
    model: process.env.model,
  };
  delete process.env.key;
  delete process.env.base_url;
  delete process.env.model;
  try {
    return await run();
  } finally {
    if (previous.key === undefined) delete process.env.key;
    else process.env.key = previous.key;
    if (previous.base_url === undefined) delete process.env.base_url;
    else process.env.base_url = previous.base_url;
    if (previous.model === undefined) delete process.env.model;
    else process.env.model = previous.model;
  }
}

type AcceptanceReportInput = {
  scenarios: ScenarioId[];
  embeddingStatus: string;
  createdEpisodes: Array<{
    scenario: ScenarioId;
    title: string;
    summary: string;
    unresolved: boolean;
    status: string;
  }>;
  totalEpisodesAfter: number;
  failures: string[];
};

function isScenarioId(value: string): value is ScenarioId {
  return value === "debt_pressure" || value === "work_sleep" || value === "pet_liability";
}

export function parseArgs(argv: string[]): CliArgs {
  const scenarios: ScenarioId[] = [];
  let keepData = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scenario") {
      const raw = (argv[index + 1] ?? "").trim();
      if (!isScenarioId(raw)) {
        throw new Error(`Unknown scenario: ${raw || "(empty)"}`);
      }
      scenarios.push(raw);
      index += 1;
      continue;
    }
    if (arg === "--keep-data") {
      keepData = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
  }

  return {
    scenarios: scenarios.length > 0 ? scenarios : ["debt_pressure", "work_sleep", "pet_liability"],
    keepData,
    json,
  };
}

export function buildAcceptanceReport(input: AcceptanceReportInput): string {
  const passed = input.failures.length === 0 && input.totalEpisodesAfter > 0;
  const lines: string[] = [
    `Episode Acceptance: ${passed ? "PASS" : "FAIL"}`,
    `Scenarios: ${input.scenarios.join(", ")}`,
    `Embedding: ${input.embeddingStatus}`,
    `Episodes created: ${input.totalEpisodesAfter}`,
  ];

  if (input.createdEpisodes.length > 0) {
    lines.push("Created episodes:");
    for (const episode of input.createdEpisodes) {
      lines.push(
        `- [${episode.scenario}] ${episode.title} | ${episode.status} | unresolved=${episode.unresolved} | ${episode.summary}`,
      );
    }
  }

  if (input.failures.length > 0) {
    lines.push("Failures:");
    for (const failure of input.failures) {
      lines.push(`- ${failure}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  debt_pressure: {
    id: "debt_pressure",
    label: "债务压力",
    turns: [
      {
        userMessage: "点点上次追电瓶车把人弄摔了，家里赔了十几万。",
        assistantReply: "这一下子就不是小事了，先别急，我们按你眼前最难扛的那块慢慢捋。",
      },
      {
        userMessage: "所以我现在还欠七八万，我每个月挣三千。",
        assistantReply: "这压力确实很实在，先别硬扛，我们先按这几个条件算清楚。",
      },
      {
        userMessage: "我都不知道要还到什么时候。",
        assistantReply: "先别急着把自己判死，这条线还没结束，我们一步一步拆。",
      },
    ],
    expectEpisode: (episodes) =>
      episodes.some((episode) =>
        /欠|债|赔|压力|还/u.test(`${episode.title} ${episode.summary} ${(episode.topics ?? []).join(" ")}`),
      )
        ? null
        : "no debt-pressure episode found",
  },
  work_sleep: {
    id: "work_sleep",
    label: "工作拖累睡眠",
    turns: [
      {
        userMessage: "最近工作上一直被误解，回家脑子也停不下来。",
        assistantReply: "这种委屈最磨人，先别逼自己马上消化，我们先把最卡你的那根刺找出来。",
      },
      {
        userMessage: "我已经连续几天睡不好了，半夜还会突然醒。",
        assistantReply: "工作这条线已经开始拖睡眠了，这不是矫情，先按眼前状态慢慢来。",
      },
    ],
    expectEpisode: (episodes) =>
      episodes.some((episode) =>
        /工作|睡|失眠|误解/u.test(`${episode.title} ${episode.summary} ${(episode.topics ?? []).join(" ")}`),
      )
        ? null
        : "no work-sleep episode found",
  },
  pet_liability: {
    id: "pet_liability",
    label: "宠物惹祸后的现实压力",
    turns: [
      {
        userMessage: "我家狗惹了事之后，家里一直在为赔偿吵架。",
        assistantReply: "这已经不是单纯宠物趣事了，先别把自己一个人丢在这堆烂摊子里。",
      },
      {
        userMessage: "现在一提到点点我就会想到那笔赔偿，心里特别堵。",
        assistantReply: "这条线还卡在你身上，先不急着轻描淡写过去，我们慢慢捋。",
      },
    ],
    expectEpisode: (episodes) =>
      episodes.some((episode) =>
        /狗|宠物|赔偿|点点/u.test(`${episode.title} ${episode.summary} ${(episode.topics ?? []).join(" ")}`),
      )
        ? null
        : "no pet-liability episode found",
  },
};

async function cleanupUser(userId: string): Promise<void> {
  await deleteEpisodesByUser(userId);
  await deleteMemoriesByUser(userId);
  await query(
    `DELETE FROM messages
     WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)`,
    [userId],
  );
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM user_auth_identities WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM user_persona_presets WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
}

async function runScenario(definition: ScenarioDefinition): Promise<ScenarioResult> {
  const userId = randomUUID();
  await ensureStorageUser(userId);
  const memoryRepo = getPgMemoryRepository(userId);
  const slowBrain = new SlowBrainStore();
  const history: PromptMessage[] = [];
  const episodesBefore = (await getEpisodesByUser(userId, undefined, { includeArchived: true })).length;

  for (const turn of definition.turns) {
    await withMainLlmDisabled(() =>
      runSlowBrain({
        userId,
        userMessage: turn.userMessage,
        assistantReply: turn.assistantReply,
        history,
        slowBrain,
        memoryRepo,
        relationshipRepo: memoryRepo,
      }),
    );
    history.push({ role: "user", content: turn.userMessage });
    history.push({ role: "assistant", content: turn.assistantReply });
  }

  const episodes = await getEpisodesByUser(userId, undefined, { includeArchived: true });
  return {
    id: definition.id,
    label: definition.label,
    userId,
    episodesBefore,
    episodesAfter: episodes.length,
    createdEpisodes: episodes,
  };
}

function evaluateScenarioResult(result: ScenarioResult): string[] {
  const definition = SCENARIOS[result.id];
  const failures: string[] = [];
  if (result.episodesAfter <= result.episodesBefore) {
    failures.push("episodes did not increase");
  }
  const scenarioFailure = definition.expectEpisode(result.createdEpisodes);
  if (scenarioFailure) failures.push(scenarioFailure);
  return failures;
}

function shouldFallbackToContainer(err: unknown): boolean {
  const message = (err as Error)?.message ?? "";
  return /ECONNREFUSED|DATABASE_URL is not set|getaddrinfo|not resolvable/i.test(message);
}

function runAcceptanceInContainer(args: CliArgs): {
  embeddingStatus: string;
  results: ScenarioResult[];
} {
  const serializedScenarios = JSON.stringify(args.scenarios);
  const keepData = args.keepData ? "true" : "false";
  const turns = JSON.stringify(
    Object.fromEntries(
      Object.values(SCENARIOS).map((scenario) => [
        scenario.id,
        { id: scenario.id, label: scenario.label, turns: scenario.turns },
      ]),
    ),
  );
  const code = `
const { randomUUID } = require("crypto");
const { initDatabase, closeDatabase, query } = require("./dist/storage/database");
const { ensureStorageUser } = require("./dist/storage/repositories/dev_identity");
const { getPgMemoryRepository } = require("./dist/storage/repositories/pg_memory_repository");
const { deleteEpisodesByUser, getEpisodesByUser } = require("./dist/storage/repositories/episode_repository");
const { deleteMemoriesByUser } = require("./dist/storage/repositories/memory_repository");
const { checkEmbeddingHealth } = require("./dist/llm/embedding_client");
const { runSlowBrain } = require("./dist/brains/slow_brain");
const { SlowBrainStore } = require("./dist/brains/slow_brain_store");
const SCENARIOS = ${turns};
const REPORT_START = "__EPISODE_ACCEPTANCE_JSON_START__";
const REPORT_END = "__EPISODE_ACCEPTANCE_JSON_END__";
async function withMainLlmDisabled(run) {
  const previous = {
    key: process.env.key,
    base_url: process.env.base_url,
    model: process.env.model,
  };
  delete process.env.key;
  delete process.env.base_url;
  delete process.env.model;
  try {
    return await run();
  } finally {
    if (previous.key === undefined) delete process.env.key;
    else process.env.key = previous.key;
    if (previous.base_url === undefined) delete process.env.base_url;
    else process.env.base_url = previous.base_url;
    if (previous.model === undefined) delete process.env.model;
    else process.env.model = previous.model;
  }
}
async function cleanupUser(userId) {
  await deleteEpisodesByUser(userId);
  await deleteMemoriesByUser(userId);
  await query(\`DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)\`, [userId]);
  await query(\`DELETE FROM sessions WHERE user_id = $1\`, [userId]);
  await query(\`DELETE FROM user_auth_identities WHERE user_id = $1\`, [userId]);
  await query(\`DELETE FROM user_persona_presets WHERE user_id = $1\`, [userId]);
  await query(\`DELETE FROM users WHERE id = $1\`, [userId]);
}
async function runScenario(definition) {
  const userId = randomUUID();
  await ensureStorageUser(userId);
  const memoryRepo = getPgMemoryRepository(userId);
  const slowBrain = new SlowBrainStore();
  const history = [];
  const episodesBefore = (await getEpisodesByUser(userId, undefined, { includeArchived: true })).length;
  for (const turn of definition.turns) {
    await withMainLlmDisabled(() =>
      runSlowBrain({
        userId,
        userMessage: turn.userMessage,
        assistantReply: turn.assistantReply,
        history,
        slowBrain,
        memoryRepo,
        relationshipRepo: memoryRepo,
      }),
    );
    history.push({ role: "user", content: turn.userMessage });
    history.push({ role: "assistant", content: turn.assistantReply });
  }
  const episodes = await getEpisodesByUser(userId, undefined, { includeArchived: true });
  return {
    id: definition.id,
    label: definition.label,
    userId,
    episodesBefore,
    episodesAfter: episodes.length,
    createdEpisodes: episodes,
  };
}
(async() => {
  await initDatabase();
  try {
    const embedding = await checkEmbeddingHealth();
    const results = [];
    for (const id of ${serializedScenarios}) {
      results.push(await runScenario(SCENARIOS[id]));
    }
    console.log(REPORT_START);
    console.log(JSON.stringify({ embeddingStatus: embedding.status, results }));
    console.log(REPORT_END);
    if (${keepData} !== "true") {
      for (const result of results) {
        await cleanupUser(result.userId);
      }
    }
  } finally {
    await closeDatabase().catch(() => {});
  }
})().catch(async (err) => {
  console.error(err);
  try { await closeDatabase(); } catch {}
  process.exit(1);
});
`;

  const stdout = execFileSync(
    "docker",
    ["exec", "-i", "remi-ai-app-1", "node", "-e", code],
    { encoding: "utf8" },
  );
  const startToken = "__EPISODE_ACCEPTANCE_JSON_START__";
  const endToken = "__EPISODE_ACCEPTANCE_JSON_END__";
  const startIndex = stdout.indexOf(startToken);
  const endIndex = stdout.indexOf(endToken);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error(`container acceptance output missing JSON markers:\n${stdout}`);
  }
  const payload = stdout.slice(startIndex + startToken.length, endIndex).trim();
  return JSON.parse(payload) as { embeddingStatus: string; results: ScenarioResult[] };
}

async function executeAcceptance(args: CliArgs): Promise<{
  embeddingStatus: string;
  results: ScenarioResult[];
  source: "local" | "container";
}> {
  try {
    await initDatabase();
  } catch (err) {
    if (!shouldFallbackToContainer(err)) throw err;
    return { ...runAcceptanceInContainer(args), source: "container" };
  }

  const embedding = await checkEmbeddingHealth();
  const results: ScenarioResult[] = [];
  for (const scenarioId of args.scenarios) {
    results.push(await runScenario(SCENARIOS[scenarioId]));
  }
  return { embeddingStatus: embedding.status, results, source: "local" };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const executed = await executeAcceptance(args);
  const failures: string[] = [];
  const createdEpisodes: AcceptanceReportInput["createdEpisodes"] = [];

  for (const result of executed.results) {
    const scenarioFailures = evaluateScenarioResult(result);
    failures.push(...scenarioFailures.map((failure) => `${result.id}: ${failure}`));
    for (const episode of result.createdEpisodes) {
      createdEpisodes.push({
        scenario: result.id,
        title: episode.title,
        summary: episode.summary,
        unresolved: episode.unresolved,
        status: episode.status,
      });
    }
  }

  const reportPayload = {
    scenarios: args.scenarios,
    embeddingStatus: executed.embeddingStatus,
    createdEpisodes,
    totalEpisodesAfter: createdEpisodes.length,
    failures,
    perScenario: executed.results.map((result) => ({
      id: result.id,
      label: result.label,
      userId: result.userId,
      episodesAfter: result.episodesAfter,
      failures: evaluateScenarioResult(result),
    })),
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(reportPayload, null, 2)}\n`);
  } else {
    process.stdout.write(buildAcceptanceReport(reportPayload));
  }

  try {
    if (!args.keepData && executed.source === "local" && executed.results.length > 0) {
      for (const result of executed.results) {
        await cleanupUser(result.userId);
      }
    }
  } finally {
    if (executed.source === "local") {
      await closeDatabase().catch(() => {});
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[episode_acceptance] failed:", (err as Error).message);
    process.exitCode = 1;
  });
}
