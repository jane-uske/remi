/**
 * Episode Retrieval Eval Framework
 *
 * Measures recall@K and MRR for the episode scoring formula.
 * Run: npx tsx test/eval/episode_retrieval_eval.ts [--weights <json>]
 *
 * Fixtures in test/eval/fixtures/episode_retrieval_cases.json define
 * (query, expected_episode_ids) pairs. The eval either uses the live
 * embedding service or pre-computed fixture embeddings.
 */

import * as path from "node:path";
import * as fs from "node:fs";

// --- Types ---

export interface EvalCase {
  id: string;
  query: string;
  expectedEpisodeIds: string[];
  tags?: string[];
}

export interface ScoringWeights {
  cosine: number;
  salience: number;
  recency: number;
  unresolved: number;
  lexicalBoostCap: number;
  recentReferencePenalty: number;
  wideEpisodePenalty: number;
}

export interface EvalResult {
  caseId: string;
  query: string;
  expectedIds: string[];
  retrievedIds: string[];
  recallAt3: number;
  recallAt5: number;
  reciprocalRank: number;
  hit: boolean;
}

export interface EvalSummary {
  totalCases: number;
  meanRecallAt3: number;
  meanRecallAt5: number;
  meanReciprocalRank: number;
  hitRate: number;
  weights: ScoringWeights;
  results: EvalResult[];
}

// --- Default weights (matches current episode_store.ts) ---

export const DEFAULT_WEIGHTS: ScoringWeights = {
  cosine: 0.6,
  salience: 0.2,
  recency: 0.1,
  unresolved: 0.1,
  lexicalBoostCap: 0.12,
  recentReferencePenalty: 0.18,
  wideEpisodePenalty: 0.12,
};

// --- Scoring (isolated, parameterizable version) ---

export interface EpisodeScoreInput {
  cosine: number;
  salience: number;
  recencyScore: number;
  unresolvedBoost: number;
  lexicalBoost: number;
  recentReferencePenalty: number;
  breadthPenalty: number;
}

export function computeScore(input: EpisodeScoreInput, weights: ScoringWeights): number {
  return (
    weights.cosine * input.cosine +
    weights.salience * input.salience +
    weights.recency * input.recencyScore +
    weights.unresolved * input.unresolvedBoost +
    Math.min(weights.lexicalBoostCap, input.lexicalBoost) -
    input.recentReferencePenalty -
    input.breadthPenalty
  );
}

// --- Metrics ---

export function recallAtK(retrieved: string[], expected: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  const hits = expected.filter((id) => topK.includes(id)).length;
  return expected.length > 0 ? hits / expected.length : 0;
}

export function reciprocalRank(retrieved: string[], expected: string[]): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (expected.includes(retrieved[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

// --- Fixture management ---

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const FIXTURES_FILE = path.join(FIXTURES_DIR, "episode_retrieval_cases.json");

export function loadFixtures(): EvalCase[] {
  if (!fs.existsSync(FIXTURES_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(FIXTURES_FILE, "utf-8");
  return JSON.parse(raw) as EvalCase[];
}

export function saveFixtures(cases: EvalCase[]): void {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(cases, null, 2), "utf-8");
}

// --- Eval runner (offline, using pre-scored inputs) ---

export interface PreScoredCase {
  caseId: string;
  query: string;
  expectedEpisodeIds: string[];
  candidates: Array<{
    episodeId: string;
    inputs: EpisodeScoreInput;
  }>;
}

export function runOfflineEval(
  cases: PreScoredCase[],
  weights: ScoringWeights,
): EvalSummary {
  const results: EvalResult[] = [];

  for (const evalCase of cases) {
    const scored = evalCase.candidates
      .map((c) => ({
        episodeId: c.episodeId,
        score: computeScore(c.inputs, weights),
      }))
      .sort((a, b) => b.score - a.score);

    const retrievedIds = scored.map((s) => s.episodeId);
    const r3 = recallAtK(retrievedIds, evalCase.expectedEpisodeIds, 3);
    const r5 = recallAtK(retrievedIds, evalCase.expectedEpisodeIds, 5);
    const rr = reciprocalRank(retrievedIds, evalCase.expectedEpisodeIds);

    results.push({
      caseId: evalCase.caseId,
      query: evalCase.query,
      expectedIds: evalCase.expectedEpisodeIds,
      retrievedIds: retrievedIds.slice(0, 5),
      recallAt3: r3,
      recallAt5: r5,
      reciprocalRank: rr,
      hit: rr > 0,
    });
  }

  const totalCases = results.length;
  const meanRecallAt3 = totalCases > 0 ? results.reduce((s, r) => s + r.recallAt3, 0) / totalCases : 0;
  const meanRecallAt5 = totalCases > 0 ? results.reduce((s, r) => s + r.recallAt5, 0) / totalCases : 0;
  const meanReciprocalRank = totalCases > 0 ? results.reduce((s, r) => s + r.reciprocalRank, 0) / totalCases : 0;
  const hitRate = totalCases > 0 ? results.filter((r) => r.hit).length / totalCases : 0;

  return {
    totalCases,
    meanRecallAt3,
    meanRecallAt5,
    meanReciprocalRank,
    hitRate,
    weights,
    results,
  };
}

// --- Grid search ---

export interface GridSearchResult {
  bestWeights: ScoringWeights;
  bestMRR: number;
  allResults: Array<{ weights: ScoringWeights; mrr: number }>;
}

export function gridSearch(
  cases: PreScoredCase[],
  paramGrid: Partial<Record<keyof ScoringWeights, number[]>>,
): GridSearchResult {
  const keys = Object.keys(paramGrid) as (keyof ScoringWeights)[];
  const combinations: ScoringWeights[] = [];

  function generate(idx: number, current: ScoringWeights): void {
    if (idx >= keys.length) {
      combinations.push({ ...current });
      return;
    }
    const key = keys[idx];
    const values = paramGrid[key] ?? [current[key]];
    for (const val of values) {
      generate(idx + 1, { ...current, [key]: val });
    }
  }

  generate(0, { ...DEFAULT_WEIGHTS });

  let bestWeights = DEFAULT_WEIGHTS;
  let bestMRR = 0;
  const allResults: Array<{ weights: ScoringWeights; mrr: number }> = [];

  for (const weights of combinations) {
    const summary = runOfflineEval(cases, weights);
    allResults.push({ weights, mrr: summary.meanReciprocalRank });
    if (summary.meanReciprocalRank > bestMRR) {
      bestMRR = summary.meanReciprocalRank;
      bestWeights = weights;
    }
  }

  return { bestWeights, bestMRR, allResults };
}

// --- CLI entry ---

if (require.main === module) {
  const weightsArg = process.argv.indexOf("--weights");
  const weights = weightsArg >= 0 && process.argv[weightsArg + 1]
    ? { ...DEFAULT_WEIGHTS, ...JSON.parse(process.argv[weightsArg + 1]) }
    : DEFAULT_WEIGHTS;

  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    console.log("No eval fixtures found. Create test/eval/fixtures/episode_retrieval_cases.json");
    console.log("Format: Array of { id, query, expectedEpisodeIds, tags? }");
    process.exit(0);
  }

  console.log(`Loaded ${fixtures.length} eval cases`);
  console.log(`Weights: ${JSON.stringify(weights)}`);
  console.log("\nNote: Full online eval requires pre-scored input. Use --prescored <file> for offline eval.");
}
