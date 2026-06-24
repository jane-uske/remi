// ── Project Memory Layer (user long-term-affairs memory) ─────────────
// Lets Remi behave like a long-term partner who remembers what the user is
// pursuing over time — study goals (e.g. learning Japanese), fitness, creative
// work, a personal site, a long-running dev task (the Remi project itself is
// just ONE such affair, not the only domain) — including north star, current
// focus, decisions, rejected options, open questions, next steps, how they like
// to work, and a timeline of milestones, instead of the last few chat turns.
//
// Storage: a single structured JSON document persisted under a `__rem_` system
// key in the existing `memories` table (same pattern as relationship_state).
// This deliberately avoids a DB migration — local-prod has no pgmigrations
// bookkeeping, so `migrate:up` from 001 would collide with existing tables.
// A module-level per-user cache keeps it durable across reconnects in-process
// even when no database is configured.
//
// RemiSelf invariant: ProjectMemory has NO identity field. A request to "act a
// bit more like <character>" is captured as a Performance Profile / preference
// (`performance_profiles`), never as a change to who Remi is. Identity lives in
// persona/RemiSelf and is never written here.

import type { MemoryRepository } from "./memory_repository";
import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";

const logger = createLogger("project_memory");

export const PROJECT_MEMORY_KEY = "__rem_project_memory_v1";

export function projectMemoryEnabled(): boolean {
  return getConfig().REMI_PROJECT_MEMORY_ENABLED;
}

// ── Types ──

export type ProjectTimelineStatus =
  | "planned"
  | "in_progress"
  | "done"
  | "blocked"
  | "decided";

export interface ProjectTimelineNode {
  date: string; // ISO date (YYYY-MM-DD)
  session_hint?: string;
  topic: string;
  summary: string;
  status: ProjectTimelineStatus;
}

export interface ProjectDecision {
  topic: string;
  decision: string;
  rationale?: string;
  decidedAt?: number;
}

export interface ProjectRejectedOption {
  option: string;
  reason?: string;
}

export interface ProjectNextSuggestion {
  suggestion: string;
  priority: number; // 1 = highest
  rationale?: string;
}

/**
 * A captured "speak/behave a bit more like X" request. This is a performance
 * skin, NOT an identity. `saved=false` means it was offered/entered but the
 * user has not yet chosen to persist it.
 */
export interface ProjectPerformanceProfile {
  name: string;
  descriptor: string;
  source?: string;
  saved: boolean;
  createdAt?: number;
}

export interface ProjectMemory {
  version: "v1";
  project_name: string;
  north_star: string;
  current_focus: string;
  recent_actions: string[];
  decisions: ProjectDecision[];
  rejected_options: ProjectRejectedOption[];
  open_questions: string[];
  next_suggestions: ProjectNextSuggestion[];
  user_working_style: string[];
  /** Performance Profiles — style skins kept separate from identity (RemiSelf). */
  performance_profiles: ProjectPerformanceProfile[];
  timeline: ProjectTimelineNode[];
  updated_at: number;
}

/**
 * Incremental update emitted by the extractor (or any caller). Applied
 * deterministically by {@link applyProjectMemoryUpdate}. Uses delta semantics
 * (mirrors core_memory_edits): scalars replace, list-`_add` fields merge with
 * dedup, `next_suggestions` replaces the forward-looking list wholesale.
 */
export interface ProjectMemoryUpdate {
  project_name?: string;
  north_star?: string;
  current_focus?: string;
  recent_actions_add?: string[];
  decisions_add?: ProjectDecision[];
  rejected_options_add?: ProjectRejectedOption[];
  open_questions_add?: string[];
  open_questions_resolved?: string[];
  next_suggestions?: ProjectNextSuggestion[];
  user_working_style_add?: string[];
  performance_profiles_add?: ProjectPerformanceProfile[];
  timeline_add?: ProjectTimelineNode[];
}

/** Where a recall request wants the emphasis. */
export type ProjectRecallFocus =
  | "status"
  | "next"
  | "past_decision"
  | "performance"
  | "general";

// ── Caps ──

const MAX_RECENT_ACTIONS = 10;
const MAX_DECISIONS = 12;
const MAX_REJECTED = 10;
const MAX_OPEN_QUESTIONS = 10;
const MAX_NEXT_SUGGESTIONS = 6;
const MAX_WORKING_STYLE = 8;
const MAX_PERFORMANCE_PROFILES = 6;
const MAX_TIMELINE = 14;
// Dedicated projectMemoryBlock budget (own system part, NOT the shared 500-char
// priorityContext). Only appears on recall turns, so it can be generous.
const MAX_RENDER_CHARS = 1200;

// ── Helpers ──

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toStringList(value: unknown, limit: number, maxLen = 160): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = clean(item, maxLen);
    if (s) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** Case/space-insensitive substring dedup: drop entries already represented. */
function dedupMerge(existing: string[], incoming: string[], cap: number): string[] {
  const result = [...existing];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  for (const candidate of incoming) {
    const c = norm(candidate);
    if (!c) continue;
    const idx = result.findIndex((e) => {
      const n = norm(e);
      return n === c || n.includes(c) || c.includes(n);
    });
    if (idx >= 0) {
      // Prefer the longer / newer phrasing, keep its position.
      if (candidate.length > result[idx].length) result[idx] = candidate;
      continue;
    }
    result.unshift(candidate); // newest first
  }
  return result.slice(0, cap);
}

/**
 * RemiSelf guardrail: reject text that tries to redefine WHO Remi is (identity
 * replacement / roleplay-as-another-character). Such intent must travel through
 * performance_profiles, never into the project's framing fields.
 */
const IDENTITY_OVERRIDE_PATTERN =
  /(你现在是|你就是|你是一只|你是一个(?!.{0,6}(AI助手|陪伴|数字))|从现在起你是|扮演成?|化身为|变成(?:一只|一个)?\S*(?:娘|酱|猫|狐|女仆|主人)|cosplay|你的(?:真实)?身份是|改名(?:为|叫)|不再是\s*remi|你不是\s*remi)/iu;

function isIdentityOverride(text: string): boolean {
  return IDENTITY_OVERRIDE_PATTERN.test(text);
}

/** Returns the sanitized framing text, or null when it must be rejected. */
function guardFramingText(text: string, max: number): string | null {
  const t = clean(text, max);
  if (!t) return null;
  if (isIdentityOverride(t)) {
    logger.info("project memory: rejected identity-override framing text", {
      preview: t.slice(0, 60),
    });
    return null;
  }
  return t;
}

function normalizeStatus(value: unknown): ProjectTimelineStatus {
  return value === "planned" ||
    value === "in_progress" ||
    value === "done" ||
    value === "blocked" ||
    value === "decided"
    ? value
    : "in_progress";
}

function normalizeDecision(value: unknown): ProjectDecision | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const topic = clean(r.topic, 60);
  const decision = clean(r.decision, 220);
  if (!topic || !decision) return null;
  const rationale = clean(r.rationale, 200);
  const decidedAt =
    typeof r.decidedAt === "number" && Number.isFinite(r.decidedAt)
      ? r.decidedAt
      : undefined;
  return { topic, decision, ...(rationale ? { rationale } : {}), ...(decidedAt ? { decidedAt } : {}) };
}

function normalizeRejected(value: unknown): ProjectRejectedOption | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const option = clean(r.option, 160);
  if (!option) return null;
  const reason = clean(r.reason, 200);
  return { option, ...(reason ? { reason } : {}) };
}

function normalizeNext(value: unknown): ProjectNextSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const suggestion = clean(r.suggestion, 220);
  if (!suggestion) return null;
  const priority =
    typeof r.priority === "number" && Number.isFinite(r.priority)
      ? Math.max(1, Math.min(99, Math.floor(r.priority)))
      : 5;
  const rationale = clean(r.rationale, 160);
  return { suggestion, priority, ...(rationale ? { rationale } : {}) };
}

function normalizeProfile(value: unknown): ProjectPerformanceProfile | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const name = clean(r.name, 48);
  const descriptor = clean(r.descriptor, 200);
  if (!name || !descriptor) return null;
  const source = clean(r.source, 120);
  const createdAt =
    typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : undefined;
  return {
    name,
    descriptor,
    saved: r.saved === true,
    ...(source ? { source } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function normalizeTimelineNode(value: unknown): ProjectTimelineNode | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const topic = clean(r.topic, 60);
  const summary = clean(r.summary, 200);
  if (!topic && !summary) return null;
  const date = clean(r.date, 16) || "";
  const session_hint = clean(r.session_hint, 60);
  return {
    date,
    topic: topic || summary.slice(0, 40),
    summary: summary || topic,
    status: normalizeStatus(r.status),
    ...(session_hint ? { session_hint } : {}),
  };
}

export function emptyProjectMemory(now = Date.now()): ProjectMemory {
  return {
    version: "v1",
    project_name: "",
    north_star: "",
    current_focus: "",
    recent_actions: [],
    decisions: [],
    rejected_options: [],
    open_questions: [],
    next_suggestions: [],
    user_working_style: [],
    performance_profiles: [],
    timeline: [],
    updated_at: now,
  };
}

/** Parse/validate a persisted (or LLM-supplied) document into a safe shape. */
export function normalizeProjectMemory(value: unknown): ProjectMemory | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const base = emptyProjectMemory(
    typeof r.updated_at === "number" && Number.isFinite(r.updated_at)
      ? r.updated_at
      : Date.now(),
  );
  base.project_name = clean(r.project_name, 80);
  base.north_star = clean(r.north_star, 400);
  base.current_focus = clean(r.current_focus, 400);
  base.recent_actions = toStringList(r.recent_actions, MAX_RECENT_ACTIONS, 160);
  base.decisions = Array.isArray(r.decisions)
    ? (r.decisions.map(normalizeDecision).filter(Boolean) as ProjectDecision[]).slice(0, MAX_DECISIONS)
    : [];
  base.rejected_options = Array.isArray(r.rejected_options)
    ? (r.rejected_options.map(normalizeRejected).filter(Boolean) as ProjectRejectedOption[]).slice(0, MAX_REJECTED)
    : [];
  base.open_questions = toStringList(r.open_questions, MAX_OPEN_QUESTIONS, 200);
  base.next_suggestions = Array.isArray(r.next_suggestions)
    ? (r.next_suggestions.map(normalizeNext).filter(Boolean) as ProjectNextSuggestion[]).slice(0, MAX_NEXT_SUGGESTIONS)
    : [];
  base.user_working_style = toStringList(r.user_working_style, MAX_WORKING_STYLE, 200);
  base.performance_profiles = Array.isArray(r.performance_profiles)
    ? (r.performance_profiles.map(normalizeProfile).filter(Boolean) as ProjectPerformanceProfile[]).slice(0, MAX_PERFORMANCE_PROFILES)
    : [];
  base.timeline = Array.isArray(r.timeline)
    ? (r.timeline.map(normalizeTimelineNode).filter(Boolean) as ProjectTimelineNode[]).slice(0, MAX_TIMELINE)
    : [];
  return base;
}

// ── Apply update (deterministic, update-not-stack) ──

export function applyProjectMemoryUpdate(
  current: ProjectMemory,
  update: ProjectMemoryUpdate,
  now = Date.now(),
): ProjectMemory {
  // Work on a deep-ish clone so the cached object is never mutated in place.
  const next: ProjectMemory = {
    ...current,
    recent_actions: [...current.recent_actions],
    decisions: current.decisions.map((d) => ({ ...d })),
    rejected_options: current.rejected_options.map((o) => ({ ...o })),
    open_questions: [...current.open_questions],
    next_suggestions: current.next_suggestions.map((s) => ({ ...s })),
    user_working_style: [...current.user_working_style],
    performance_profiles: current.performance_profiles.map((p) => ({ ...p })),
    timeline: current.timeline.map((t) => ({ ...t })),
  };
  let changed = false;

  const projectName = clean(update.project_name, 80);
  if (projectName && projectName !== next.project_name) {
    next.project_name = projectName;
    changed = true;
  }

  if (update.north_star !== undefined) {
    const safe = guardFramingText(update.north_star, 400);
    if (safe && safe !== next.north_star) {
      next.north_star = safe;
      changed = true;
    }
  }

  if (update.current_focus !== undefined) {
    const safe = guardFramingText(update.current_focus, 400);
    if (safe && safe !== next.current_focus) {
      // current_focus is a single slot — it UPDATES, never stacks.
      next.current_focus = safe;
      changed = true;
    }
  }

  if (update.recent_actions_add?.length) {
    const incoming = toStringList(update.recent_actions_add, MAX_RECENT_ACTIONS, 160);
    const merged = dedupMerge(next.recent_actions, incoming, MAX_RECENT_ACTIONS);
    if (merged.length !== next.recent_actions.length || merged[0] !== next.recent_actions[0]) {
      next.recent_actions = merged;
      changed = true;
    }
  }

  if (update.decisions_add?.length) {
    for (const raw of update.decisions_add) {
      const d = normalizeDecision(raw);
      if (!d) continue;
      if (isIdentityOverride(d.decision)) continue; // never let identity flips in
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      const idx = next.decisions.findIndex((e) => norm(e.topic) === norm(d.topic));
      if (idx >= 0) {
        // Same topic → UPDATE in place (user changed direction), move to front.
        next.decisions.splice(idx, 1);
      }
      next.decisions.unshift({ ...d, decidedAt: d.decidedAt ?? now });
      changed = true;
    }
    next.decisions = next.decisions.slice(0, MAX_DECISIONS);
  }

  if (update.rejected_options_add?.length) {
    for (const raw of update.rejected_options_add) {
      const o = normalizeRejected(raw);
      if (!o) continue;
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      if (next.rejected_options.some((e) => norm(e.option) === norm(o.option))) continue;
      next.rejected_options.unshift(o);
      changed = true;
    }
    next.rejected_options = next.rejected_options.slice(0, MAX_REJECTED);
  }

  if (update.open_questions_resolved?.length) {
    const resolved = toStringList(update.open_questions_resolved, 20, 200).map((s) =>
      s.toLowerCase().replace(/\s+/g, ""),
    );
    const before = next.open_questions.length;
    next.open_questions = next.open_questions.filter((q) => {
      const n = q.toLowerCase().replace(/\s+/g, "");
      return !resolved.some((r) => n.includes(r) || r.includes(n));
    });
    if (next.open_questions.length !== before) changed = true;
  }

  if (update.open_questions_add?.length) {
    const incoming = toStringList(update.open_questions_add, MAX_OPEN_QUESTIONS, 200);
    const merged = dedupMerge(next.open_questions, incoming, MAX_OPEN_QUESTIONS);
    if (merged.length !== next.open_questions.length) {
      next.open_questions = merged;
      changed = true;
    }
  }

  if (update.next_suggestions !== undefined) {
    // Forward-looking list: REPLACE wholesale, then sort by priority.
    const list = Array.isArray(update.next_suggestions)
      ? (update.next_suggestions.map(normalizeNext).filter(Boolean) as ProjectNextSuggestion[])
      : [];
    if (list.length || next.next_suggestions.length) {
      next.next_suggestions = list
        .sort((a, b) => a.priority - b.priority)
        .slice(0, MAX_NEXT_SUGGESTIONS);
      changed = true;
    }
  }

  if (update.user_working_style_add?.length) {
    const incoming = toStringList(update.user_working_style_add, MAX_WORKING_STYLE, 200);
    const merged = dedupMerge(next.user_working_style, incoming, MAX_WORKING_STYLE);
    if (merged.length !== next.user_working_style.length || merged[0] !== next.user_working_style[0]) {
      next.user_working_style = merged;
      changed = true;
    }
  }

  if (update.performance_profiles_add?.length) {
    for (const raw of update.performance_profiles_add) {
      const p = normalizeProfile(raw);
      if (!p) continue;
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      const idx = next.performance_profiles.findIndex((e) => norm(e.name) === norm(p.name));
      if (idx >= 0) {
        next.performance_profiles.splice(idx, 1);
      }
      next.performance_profiles.unshift({ ...p, createdAt: p.createdAt ?? now });
      changed = true;
    }
    next.performance_profiles = next.performance_profiles.slice(0, MAX_PERFORMANCE_PROFILES);
  }

  if (update.timeline_add?.length) {
    for (const raw of update.timeline_add) {
      const node = normalizeTimelineNode(raw);
      if (!node) continue;
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      // Dedup by topic+date; if same key, update the summary/status in place.
      const idx = next.timeline.findIndex(
        (e) => norm(e.topic) === norm(node.topic) && e.date === node.date,
      );
      if (idx >= 0) {
        next.timeline.splice(idx, 1);
      }
      next.timeline.unshift(node);
      changed = true;
    }
    next.timeline = next.timeline.slice(0, MAX_TIMELINE);
  }

  if (!changed) return current;
  next.updated_at = now;
  return next;
}

// ── Recall detection ──

const PROJECT_DOMAIN_PATTERN =
  /(remi|项目|这个产品|这套|架构|设计(?:稿|方案)?|方案|需求|功能|记忆(?:层|系统)?|memory\s*v?\d|turn[\s-]?taking|tts|stt|语音链路|comfyui|生图|remi\s*world|虚拟身体|北极星|north\s*star|identity|persona|人格|\/goal|提示词|prompt|管道|pipeline|迭代|里程碑|roadmap)/iu;

// Long-term personal affairs/goals beyond software work: study, fitness,
// creation, habits, finance… ProjectMemory is a GENERAL long-term-affairs
// memory; the Remi project is just one possible affair, not the only domain.
const LONGTERM_AFFAIR_PATTERN =
  /(学(?:习|日语|英语|编程|钢琴|吉他|画画|游泳)?|日语|英语|外语|备考|考(?:试|证|级|研|公|编|N\d|雅思|托福|四六级|cpa)|刷题|论文|读(?:完|书)|健身|减肥|增肌|塑形|跑步|锻炼|练习|打卡|坚持|每天|长期|目标|计划|养成|习惯|戒(?:烟|酒|糖)?|存钱|理财|副业|创业|做(?:个)?(?:网站|视频|博客|播客|app|小程序|游戏|频道)|剪辑|创作|写作|更新|减重|增重)/iu;

const STATUS_PATTERN =
  /(最近(?:在|都)?(?:做|搞|忙|弄|推进|干)|在(?:做|忙|搞|推进|弄)什么|做了(?:哪些|什么|啥)|现在(?:到|做到)?(?:哪|什么程度)|进展|进度|到哪了|做到哪|什么情况|啥情况|状态(?:如何|怎样)?)/iu;

const NEXT_PATTERN =
  /(下一步|接下来|然后呢|下一个|该(?:做|干|弄|搞)(?:什么|啥|点啥)?|要(?:做|搞|弄)(?:什么|啥)|优先(?:做|级|搞)|先(?:做|搞|弄)(?:什么|啥|哪)|做(?:什么|啥)(?:好|呢)|怎么(?:推进|继续|往下))/iu;

const PAST_DECISION_PATTERN =
  /(我们之前|之前(?:是)?(?:怎么|咋)?(?:决定|定的|说的|商量|说|讲|提|聊|安排|计划)|之前\S{0,10}(?:安排|计划|怎么)|当初(?:决定|定的|说)?|那个(?:设计|方案|想法|决定)|上次(?:说|定|聊)的|怎么(?:决定|安排|计划|弄|搞)的?|(?:安排|计划|说|定|弄|搞)来着|为什么(?:不|没)?(?:选|用|做)|当时(?:决定|定的))/iu;

const PERFORMANCE_PATTERN =
  /(像她一点|更像她|像.{0,6}一点|那(?:个|种).{0,8}(?:风格|样子|感觉)|风格.{0,4}(?:需求|要求|设定)|performance\s*profile|表演(?:风格|侧写)|演成|演得?像)/iu;

/**
 * Decide whether a user message should pull the project memory into context,
 * and where to put the emphasis. Returns null for ordinary chat (no injection,
 * keeping the hot path clean and the prompt unpolluted).
 */
export function detectProjectRecall(userMessage: string): ProjectRecallFocus | null {
  const msg = userMessage.trim();
  if (!msg || msg.length < 2) return null;

  const mentionsDomain = mentionsProjectDomain(msg);
  const status = STATUS_PATTERN.test(msg);
  const next = NEXT_PATTERN.test(msg);
  const past = PAST_DECISION_PATTERN.test(msg);
  const performance = PERFORMANCE_PATTERN.test(msg);

  // Performance phrasing ("像她一点") is specific enough to fire on its own.
  if (performance) return "performance";
  // Past-decision recall: needs a decision/design word so it doesn't fire on
  // emotional "为什么不选他" style turns.
  if (past && (mentionsDomain || /决定|方案|设计|想法|当初|之前|上次/u.test(msg))) {
    return "past_decision";
  }
  // Status / next-step questions. Single-user dev product: a bare "我最近在做
  // 什么" / "下一步该干嘛" is about the project. STATUS already requires an
  // activity verb, so it won't fire on "我最近不太好".
  if (status) return "status";
  if (next) return "next";
  if (mentionsDomain && /[?？]/u.test(msg)) return "general";
  if (mentionsDomain && /项目|remi/iu.test(msg)) return "general";

  return null;
}

const DIRECTIVE_PATTERN =
  /(不想|不要|别(?:再)?|以后(?:都|就)?|从现在起|直接给|优先|我(?:更)?喜欢|我倾向|我习惯|下次(?:就|记得)?|记住|约定|默认(?:就)?|统一(?:用|走))/iu;

const DECISION_PATTERN =
  /(决定|改成|换成|改用|不用|放弃|否掉|砍掉|搞定|做完|完成了|上线|接好了|接进|下一步|计划|方案(?:是|改)|就用|选用|采用|走\S{0,4}方案|定了)/iu;

const PROGRESS_PATTERN =
  /(在(?:做|搞|弄|推进|写|调)|进展|进度|需求|功能|架构|设计|里程碑|迭代|bug|修(?:好|完|了))/iu;

export function mentionsProjectDomain(msg: string): boolean {
  return PROJECT_DOMAIN_PATTERN.test(msg) || LONGTERM_AFFAIR_PATTERN.test(msg);
}

export function mentionsPerformanceRequest(msg: string): boolean {
  return PERFORMANCE_PATTERN.test(msg);
}

/**
 * Heuristic gate for whether a turn likely carries reusable project info worth
 * an extraction pass. Keeps the (off-hot-path but billed) LLM call bounded:
 * only fires on project-domain turns that also carry a decision / progress /
 * directive signal, on explicit "work like this" directives about how to
 * deliver help, or on performance-style requests.
 */
export function isProjectExtractionWorthy(userMessage: string): boolean {
  const m = userMessage.trim();
  if (m.length < 6) return false;
  const domain = mentionsProjectDomain(m);
  const directive = DIRECTIVE_PATTERN.test(m);
  const decision = DECISION_PATTERN.test(m);
  const progress = PROGRESS_PATTERN.test(m);
  const performance = PERFORMANCE_PATTERN.test(m);

  if (performance) return true;
  if (domain && (directive || decision || progress || m.length >= 16)) return true;
  if (directive && /(提示词|prompt|任务|分阶段|步骤|怎么(?:给|做|安排)|\/goal|汇报|验证)/iu.test(m)) {
    return true;
  }
  return false;
}

// ── Render compact prompt block ──

function clamp(block: string): string {
  if (block.length <= MAX_RENDER_CHARS) return block;
  return block.slice(0, MAX_RENDER_CHARS - 1).replace(/\n[^\n]*$/, "") + "…";
}

function hasContent(pm: ProjectMemory): boolean {
  return Boolean(
    pm.north_star ||
      pm.current_focus ||
      pm.recent_actions.length ||
      pm.decisions.length ||
      pm.next_suggestions.length ||
      pm.timeline.length,
  );
}

/**
 * Compact, partner-voiced summary injected as background context. Adaptive: the
 * `focus` decides which section gets expanded, but the spine (north star +
 * current focus + recent actions) is always present so Remi can answer "what
 * have we been doing" coherently.
 */
export function renderProjectMemoryContext(
  pm: ProjectMemory,
  focus: ProjectRecallFocus = "general",
): string | undefined {
  if (!hasContent(pm)) return undefined;
  const lines: string[] = [];
  const name = pm.project_name || "用户的长期事务";

  lines.push(
    `【${name}·长期事务记忆】（用户长期在推进的事——学习、健身、创作、技术项目等都可能；当背景自然引用即可，你是一路同行的搭档，不是刚接手的客服。别逐条念、别说"根据记忆"，用你自己的话讲。）`,
  );
  if (pm.north_star) lines.push(`· 北极星：${pm.north_star}`);
  if (pm.current_focus) lines.push(`· 当前主线：${pm.current_focus}`);
  if (pm.recent_actions.length) {
    lines.push(`· 最近在推进：${pm.recent_actions.slice(0, 8).join("｜")}`);
  }

  // High-value, short lines emitted right after the spine so the length cap
  // trims optional focus detail rather than these.
  if (pm.performance_profiles.length) {
    const profiles = pm.performance_profiles
      .slice(0, 3)
      .map((p) => `${p.name}（${p.descriptor}${p.saved ? "，已保存" : "，临时/待确认"}）`)
      .join("；");
    lines.push(
      `· 风格侧写（Performance Profile，只是"怎么说话"的临时风格偏好，不改变你是谁；按提取风格→生成侧写→询问是否保存→临时进入处理）：${profiles}`,
    );
  }
  if (pm.user_working_style.length) {
    lines.push(`· 用户的工作方式：${pm.user_working_style.slice(0, 4).join("；")}`);
  }

  const decisionsLine = () =>
    pm.decisions.length
      ? `· 之前定下的：${pm.decisions.slice(0, 4).map((d) => `${d.topic}—${d.decision}`).join("；")}`
      : null;
  const rejectedLine = () =>
    pm.rejected_options.length
      ? `· 已经否掉的：${pm.rejected_options.slice(0, 3).map((o) => (o.reason ? `${o.option}（${o.reason}）` : o.option)).join("；")}`
      : null;
  const openLine = () =>
    pm.open_questions.length ? `· 还没定的：${pm.open_questions.slice(0, 4).join("；")}` : null;
  const nextLine = () =>
    pm.next_suggestions.length
      ? `· 下一步（按优先级）：${[...pm.next_suggestions]
          .sort((a, b) => a.priority - b.priority)
          .slice(0, 4)
          .map((s, i) => `${i + 1}) ${s.suggestion}`)
          .join("　")}`
      : null;
  const timelineLine = () =>
    pm.timeline.length
      ? `· 最近节点：${pm.timeline.slice(0, 4).map((t) => `${t.date ? t.date + " " : ""}${t.topic}(${statusLabel(t.status)})`).join("；")}`
      : null;

  const push = (v: string | null) => {
    if (v) lines.push(v);
  };

  switch (focus) {
    case "next":
      push(nextLine());
      push(openLine());
      push(decisionsLine());
      break;
    case "past_decision":
      push(decisionsLine());
      push(rejectedLine());
      push(openLine());
      break;
    case "status":
      push(timelineLine());
      push(openLine());
      push(nextLine());
      break;
    case "performance":
      // handled below via performance block; still show the spine + next
      push(nextLine());
      break;
    default:
      push(decisionsLine());
      push(openLine());
      push(nextLine());
  }

  return clamp(lines.join("\n"));
}

function statusLabel(status: ProjectTimelineStatus): string {
  switch (status) {
    case "planned":
      return "计划中";
    case "in_progress":
      return "进行中";
    case "done":
      return "已完成";
    case "blocked":
      return "卡住";
    case "decided":
      return "已定";
  }
}

// ── Load / save (module-level per-user cache) ──

const cache = new Map<string, ProjectMemory>();

export async function loadProjectMemory(
  repo: MemoryRepository | null | undefined,
  userId: string,
  opts?: { seedIfMissing?: boolean },
): Promise<ProjectMemory> {
  const cached = cache.get(userId);
  if (cached) return cached;

  let pm: ProjectMemory | null = null;
  if (repo) {
    try {
      const entry = await repo.getByKey(PROJECT_MEMORY_KEY);
      if (entry?.value) pm = normalizeProjectMemory(JSON.parse(entry.value));
    } catch (err) {
      logger.warn("failed to load project memory", { error: (err as Error).message });
    }
  }
  if (!pm) {
    // Default: start EMPTY (a generic long-term-affairs memory). The Remi-project
    // seed is OPT-IN (seedIfMissing: true), never auto-injected — so a fresh user's
    // memory reflects THEIR affairs (学日语/健身/…), not a hardcoded Remi project.
    pm = opts?.seedIfMissing === true ? seedRemiProjectMemory() : emptyProjectMemory();
  }
  cache.set(userId, pm);
  return pm;
}

export async function saveProjectMemory(
  repo: MemoryRepository | null | undefined,
  userId: string,
  pm: ProjectMemory,
): Promise<void> {
  cache.set(userId, pm);
  if (!repo) return;
  try {
    await repo.upsert(PROJECT_MEMORY_KEY, JSON.stringify(pm), 1);
  } catch (err) {
    logger.warn("failed to persist project memory", { error: (err as Error).message });
  }
}

/** Test-only: drop the in-process cache so each case starts clean. */
export function __resetProjectMemoryCacheForTest(): void {
  cache.clear();
}

// ── Seed: the Remi project as a SAMPLE long-term affair (opt-in) ──
//
// NOT auto-loaded: loadProjectMemory defaults to empty so a real user's memory
// reflects THEIR long-term affairs (学日语 / 健身 / 做网站 …). This seed is an
// opt-in sample (loadProjectMemory(..., { seedIfMissing: true })) and a test
// fixture — the Remi project is one possible affair, never the only/forced one.

export function seedRemiProjectMemory(now = Date.now()): ProjectMemory {
  return {
    version: "v1",
    project_name: "Remi（数字生命 AI 伙伴）",
    north_star:
      "数字生命——跨设备、持续在场、有人格连续性和长期记忆的实时 AI 伙伴。用户打开 Remi 是「想见见她」，不是「帮我一下」。",
    current_focus:
      "Memory V3：长期项目记忆层 + RemiSelf 连续性，让 Remi 像长期项目伙伴一样记得在推进什么；并行 Web 端「10 分钟在场感」（W-PRES）。",
    recent_actions: [
      "Memory V3：项目记忆层（ProjectMemory + Timeline + 召回注入）",
      "RemiSelf / IdentityEnvelope：持续自我主体 + 身份三层边界（Core/Disposition/Performance）",
      "角色风格走 Performance Profile：提取风格→生成侧写→询问是否保存→临时进入，不替换 Identity",
      "语音 turn-taking / TTS 连续性：full-duplex、打断、turn-end seam（shadow turn detector）",
      "ComfyUI 控制：生图链路与 NSFW 隔离",
      "Remi World / 虚拟身体：/world 体素小岛原型，空间化在场感载体",
      "STT 升级到 SenseVoice：进程内、原生情绪/事件，用户语气进 LLM",
    ],
    decisions: [
      {
        topic: "身份边界",
        decision: "外部角色风格只能进 Performance Profile / 偏好，绝不覆盖 RemiSelf 本体",
        rationale: "保持人格连续性，Remi 是一个人不是壳",
        decidedAt: now,
      },
      {
        topic: "记忆架构",
        decision: "项目记忆以结构化 JSON 存在 memories 表的 __rem_ 系统键，不新增 DB 迁移",
        rationale: "local-prod 无 pgmigrations 记账，migrate:up 会从 001 重跑撞已存在表",
        decidedAt: now,
      },
      {
        topic: "实时性",
        decision: "fast path 不塞阻塞工作（记忆检索/工具调用），慢脑 fire-and-forget",
        rationale: "感知延迟是第一优先级",
        decidedAt: now,
      },
      {
        topic: "部署与协作",
        decision: "不推 GitHub；本地 commit + prod:local:rebuild 直接在 ai.remi.run(:3000) 验证",
        rationale: "单人产品打磨，生产即测试环境",
        decidedAt: now,
      },
    ],
    rejected_options: [
      {
        option: "用角色扮演替换 Remi 身份（猫娘/主人等）",
        reason: "违反 soul guardrails，破坏人格连续性",
      },
      { option: "把每句话都写进长期记忆", reason: "污染与堆叠，只写高价值可复用信息" },
      { option: "项目记忆单独建表 + migration", reason: "local-prod 无迁移记账，易撞表失败" },
    ],
    open_questions: [
      "「10 分钟在场感」如何做数据驱动验收（W-PRES-04 评测隔离）",
      "Performance Profile 的保存 UX：何时问「要不要把这个风格记住」",
      "RemiSelf 离线漂移规则落地（DL-P1b，前置 W-PRES-01 默认人格稳定）",
    ],
    next_suggestions: [
      {
        priority: 1,
        suggestion: "把 Memory V3 项目记忆层接进慢脑抽取 + 召回注入，并在生产验证",
      },
      {
        priority: 2,
        suggestion: "W-PRES：修 emotion 标签泄漏 + 多轮复读，跑 conversation_quality_eval 拿干净基线",
      },
      { priority: 3, suggestion: "Performance Profile 的保存/退出 UX 收口" },
    ],
    user_working_style: [
      "给任务时不要分阶段，直接给可复制的中文提示词（/goal 直接出提示词）",
      "每做完一件就汇报一次：做了什么、怎么验证、全景状况变化",
      "不推 GitHub；改完直接 prod:local:rebuild 在 ai.remi.run 验证",
      "唯一活跃用户 uid=user_3CX6TXccz6frJccptLy56Y6BGDo",
    ],
    performance_profiles: [],
    timeline: [
      {
        date: "2026-06-20",
        topic: "记忆层优化",
        summary: "NSFW 隔离 / PG importance / 断连保存 / 衰减 TTL 四项修复",
        status: "done",
      },
      {
        date: "2026-06-22",
        topic: "生产上线与稳定性",
        summary: "崩溃兜底 + 成人模式 userId/Redis 恢复 + web 文本迁 SSE",
        status: "done",
      },
      {
        date: "2026-06-23",
        topic: "STT SenseVoice + 质量验收 harness",
        summary: "STT 换 SenseVoice；建 conversation_quality_eval 数据驱动验收",
        status: "done",
      },
      {
        date: "2026-06-24",
        topic: "Memory V3 项目记忆层",
        summary: "ProjectMemory 类型 / 抽取 / 召回注入 / Timeline / RemiSelf 守卫",
        status: "in_progress",
      },
    ],
    updated_at: now,
  };
}
