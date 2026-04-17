import { initDatabase, closeDatabase } from "../storage/database";
import {
  getEpisodesByUser,
  updateEpisode,
} from "../storage/repositories/episode_repository";
import {
  classifyEpisodeForHygiene,
  listEpisodeHygieneLanguages,
  type EpisodeHygieneLanguage,
} from "../memory/episode_hygiene";

type CliArgs = {
  userId: string;
  language: EpisodeHygieneLanguage;
  apply: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  let userId = "";
  let language: EpisodeHygieneLanguage = "zh";
  let apply = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--user" || arg === "--user-id") {
      userId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--lang" || arg === "--language") {
      language = (argv[index + 1] ?? "") as EpisodeHygieneLanguage;
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
    }
  }

  if (!userId.trim()) {
    throw new Error("Usage: npm run memory:v2:hygiene -- --user <uuid> [--lang zh] [--apply] [--json]");
  }

  const supportedLanguages = listEpisodeHygieneLanguages();
  if (!supportedLanguages.includes(language)) {
    throw new Error(`Unsupported language "${language}". Supported: ${supportedLanguages.join(", ")}`);
  }

  return {
    userId: userId.trim(),
    language,
    apply,
    json,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await initDatabase();

  try {
    const episodes = await getEpisodesByUser(args.userId, undefined, { includeArchived: true });
    const candidates = episodes
      .filter((episode) => episode.status !== "archived")
      .map((episode) => ({
        episode,
        judgment: classifyEpisodeForHygiene(episode, args.language),
      }))
      .filter((entry) => entry.judgment.shouldArchive);

    if (args.apply) {
      for (const candidate of candidates) {
        await updateEpisode(candidate.episode.id, {
          status: "archived",
          unresolved: false,
        });
      }
    }

    const report = {
      userId: args.userId,
      language: args.language,
      apply: args.apply,
      candidateCount: candidates.length,
      candidates: candidates.map(({ episode, judgment }) => ({
        id: episode.id,
        title: episode.title,
        topics: episode.topics,
        recurrenceCount: episode.recurrence_count,
        relationshipWeight: episode.relationship_weight,
        previousStatus: episode.status,
        nextStatus: args.apply ? "archived" : episode.status,
        reasons: judgment.reasons,
      })),
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    process.stdout.write(`# Memory V2 Hygiene (${args.apply ? "apply" : "dry-run"})\n`);
    process.stdout.write(`- user: ${report.userId}\n`);
    process.stdout.write(`- language: ${report.language}\n`);
    process.stdout.write(`- candidates: ${report.candidateCount}\n`);
    for (const candidate of report.candidates) {
      process.stdout.write(`\n## ${candidate.title} (${candidate.id})\n`);
      process.stdout.write(`- topics: ${candidate.topics.join(", ") || "(none)"}\n`);
      process.stdout.write(`- recurrence: ${candidate.recurrenceCount}\n`);
      process.stdout.write(`- relationship_weight: ${candidate.relationshipWeight}\n`);
      process.stdout.write(`- status: ${candidate.previousStatus} -> ${candidate.nextStatus}\n`);
      for (const reason of candidate.reasons) {
        process.stdout.write(`- reason: ${reason.id} — ${reason.summary}\n`);
        for (const evidence of reason.evidence) {
          process.stdout.write(`  evidence: ${evidence}\n`);
        }
      }
    }
  } finally {
    await closeDatabase().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[episode_memory_hygiene] failed:", (err as Error).message);
  process.exitCode = 1;
});
