import { initDatabase, closeDatabase } from "../storage/database";
import { getRecentUserMessages } from "../storage/repositories/message_repository";
import { getEpisodesByUser } from "../storage/repositories/episode_repository";
import {
  checkEmbeddingHealth,
} from "../llm/embedding_client";
import { findRelevant } from "../memory/episode_store";
import {
  buildEpisodeQualityAuditReport,
  renderEpisodeQualityAuditMarkdown,
  type EpisodeRecallAuditSample,
} from "../memory/episode_quality_audit";

type CliArgs = {
  userId: string;
  messageLimit: number;
  json: boolean;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  let userId = "";
  let messageLimit = 24;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--user" || arg === "--user-id") {
      userId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--messages") {
      messageLimit = parsePositiveInt(argv[index + 1], 24);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
    }
  }

  if (!userId.trim()) {
    throw new Error("Usage: npm run memory:v2:audit -- --user <uuid> [--messages 24] [--json]");
  }

  return {
    userId: userId.trim(),
    messageLimit,
    json,
  };
}

async function collectRecallSamples(
  userId: string,
  userMessages: Awaited<ReturnType<typeof getRecentUserMessages>>,
): Promise<EpisodeRecallAuditSample[]> {
  const samples: EpisodeRecallAuditSample[] = [];
  for (const message of userMessages.filter((entry) => entry.role === "user" && entry.content.trim().length >= 8)) {
    const ranked = await findRelevant(userId, message.content, 3);
    const top = ranked[0];
    samples.push({
      messageId: message.id,
      content: message.content,
      topEpisodeId: top?.episode.id ?? null,
      topEpisodeTitle: top?.episode.title,
      topScore: top ? Number(top.score.toFixed(3)) : undefined,
    });
  }
  return samples;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await initDatabase();

  try {
    const [messages, episodes, embeddingHealth] = await Promise.all([
      getRecentUserMessages(args.userId, Math.max(8, args.messageLimit)),
      getEpisodesByUser(args.userId),
      checkEmbeddingHealth(),
    ]);

    const recallSamples =
      embeddingHealth.ok
        ? await collectRecallSamples(args.userId, messages)
        : [];
    const report = buildEpisodeQualityAuditReport({
      episodes,
      messages,
      recallSamples,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify({
        embeddingHealth,
        report,
      }, null, 2)}\n`);
      return;
    }

    process.stdout.write(
      renderEpisodeQualityAuditMarkdown(report, {
        embeddingStatus: embeddingHealth.status,
        embeddingDetail: embeddingHealth.detail,
      }),
    );
  } finally {
    await closeDatabase().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[episode_memory_audit] failed:", (err as Error).message);
  process.exitCode = 1;
});
