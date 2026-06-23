// ── M3-P1 Core Memory 差分编辑块 ───────────────────────────────────
// 把 SlowBrainStore 里散落的用户知识（facts, interests, personality,
// relationship, workingMemory）重构为结构化、有界、缓存友好的 Tier1 块。
// 慢脑每轮做差分编辑（add/update/remove），不整块重写。
// 设计见 docs/design/MEMORY_V3_DESIGN.md §3。

import type { SlowBrainSnapshot, WorkingMemoryV2 } from "./background_analysis_store";

// ── 类型 ──────────────────────────────────────────────────────────

export type CoreSection = "aboutYou" | "aboutUs" | "rightNow";

export interface CoreSlot {
  key: string;
  value: string;
  salience: number;       // 0–1
  updatedTurn: number;
  source?: "user" | "assistant" | "system";
}

export type CoreMemoryEdit =
  | { op: "add"; section: CoreSection; key: string; value: string; salience?: number }
  | { op: "update"; section: CoreSection; key: string; value: string }
  | { op: "remove"; section: CoreSection; key: string };

export interface CoreMemoryBlock {
  aboutYou: CoreSlot[];
  aboutUs: CoreSlot[];
  rightNow: CoreSlot[];
}

// ── 容量 ──────────────────────────────────────────────────────────

/** 每个 section 的 slot 数上限。超限按 salience 最低淘汰。 */
export const SECTION_LIMITS: Record<CoreSection, number> = {
  aboutYou: 20,
  aboutUs: 10,
  rightNow: 6,
};

const SECTION_HEADINGS: Record<CoreSection, string> = {
  aboutYou: "关于你",
  aboutUs: "关于我们",
  rightNow: "此刻",
};

const SECTION_ORDER: CoreSection[] = ["aboutYou", "aboutUs", "rightNow"];

// ── 工具 ──────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function stableSort(slots: CoreSlot[]): CoreSlot[] {
  return [...slots].sort((a, b) => a.key.localeCompare(b.key, "zh-CN"));
}

function evictLowest(slots: CoreSlot[], limit: number): { kept: CoreSlot[]; evicted: CoreSlot[] } {
  if (slots.length <= limit) return { kept: slots, evicted: [] };
  const sorted = [...slots].sort((a, b) =>
    a.salience - b.salience || a.updatedTurn - b.updatedTurn,
  );
  const evicted = sorted.slice(0, sorted.length - limit);
  const evictedKeys = new Set(evicted.map((s) => s.key));
  const kept = slots.filter((s) => !evictedKeys.has(s.key));
  return { kept, evicted };
}

// ── CoreMemoryStore ──────────────────────────────────────────────

export class CoreMemoryStore {
  private block: CoreMemoryBlock;

  /** 淘汰回调：P2 接入后可用于把淘汰的 slot 写入 temporal_facts。 */
  onEvict?: (slot: CoreSlot, section: CoreSection) => void;

  private constructor(block: CoreMemoryBlock) {
    this.block = block;
  }

  // ── 从 SlowBrainSnapshot 构建 ──

  static fromSlowBrainSnapshot(snapshot: SlowBrainSnapshot, currentTurn?: number): CoreMemoryStore {
    const turn = currentTurn ?? snapshot.relationship.turnCount;

    // aboutYou: facts + interests + personalityNotes
    const aboutYou: CoreSlot[] = [];
    for (const [key, value] of snapshot.userProfile.facts) {
      aboutYou.push({ key, value, salience: 0.7, updatedTurn: turn, source: "user" });
    }
    for (const interest of snapshot.userProfile.interests) {
      aboutYou.push({ key: `兴趣:${interest}`, value: interest, salience: 0.5, updatedTurn: turn, source: "user" });
    }
    for (const note of snapshot.userProfile.personalityNotes) {
      aboutYou.push({ key: `性格:${note.slice(0, 20)}`, value: note, salience: 0.4, updatedTurn: turn, source: "assistant" });
    }

    // aboutUs: relationship + conversationSummary + sharedMoments (top 2)
    const aboutUs: CoreSlot[] = [];
    const rel = snapshot.relationship;
    if (rel.turnCount > 0) {
      aboutUs.push({ key: "聊天轮数", value: String(rel.turnCount), salience: 0.3, updatedTurn: turn, source: "system" });
    }
    if (rel.familiarity > 0) {
      const level = rel.familiarity > 0.6 ? "很熟" : rel.familiarity > 0.3 ? "逐渐熟悉" : "刚认识";
      aboutUs.push({ key: "熟悉度", value: level, salience: 0.6, updatedTurn: turn, source: "system" });
    }
    if (snapshot.conversationSummary) {
      aboutUs.push({ key: "对话摘要", value: snapshot.conversationSummary, salience: 0.8, updatedTurn: turn, source: "system" });
    }
    const topMoments = (snapshot.sharedMoments ?? [])
      .slice()
      .sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0))
      .slice(0, 2);
    for (const m of topMoments) {
      aboutUs.push({ key: `经历:${m.topic || m.summary.slice(0, 15)}`, value: m.summary, salience: m.salience ?? 0.5, updatedTurn: m.turn ?? turn, source: "user" });
    }

    // rightNow: workingMemory + repairState + recent mood
    const rightNow: CoreSlot[] = [];
    const wm = snapshot.workingMemory;
    if (wm) {
      if (wm.activeThread) rightNow.push({ key: "活跃线程", value: wm.activeThread, salience: 0.8, updatedTurn: wm.lastUpdatedTurn, source: "system" });
      if (wm.currentNeed) rightNow.push({ key: "当前需求", value: wm.currentNeed, salience: 0.7, updatedTurn: wm.lastUpdatedTurn, source: "system" });
      if (wm.openLoop) rightNow.push({ key: "未完事项", value: wm.openLoop, salience: 0.6, updatedTurn: wm.lastUpdatedTurn, source: "system" });
    }
    if (snapshot.repairState && snapshot.repairState.level !== "none") {
      rightNow.push({ key: "关系修复", value: `${snapshot.repairState.level}: ${snapshot.repairState.reason}`, salience: 0.9, updatedTurn: snapshot.repairState.lastUpdatedTurn, source: "system" });
    }
    const recentMood = snapshot.moodTrajectory.slice(-1)[0];
    if (recentMood) {
      rightNow.push({ key: "最近情绪", value: recentMood.mood, salience: 0.4, updatedTurn: recentMood.turn, source: "system" });
    }

    return new CoreMemoryStore({ aboutYou, aboutUs, rightNow });
  }

  // ── 空构建（测试用） ──

  static empty(): CoreMemoryStore {
    return new CoreMemoryStore({ aboutYou: [], aboutUs: [], rightNow: [] });
  }

  // ── 差分写入 ──

  /**
   * 应用编辑列表。返回实际生效的编辑（跳过无效的）。
   * 超容量时按 salience 最低淘汰，触发 onEvict 回调。
   */
  apply(edits: CoreMemoryEdit[]): CoreMemoryEdit[] {
    const applied: CoreMemoryEdit[] = [];
    for (const edit of edits) {
      const section = this.block[edit.section];
      if (!section) continue;

      switch (edit.op) {
        case "add": {
          // 若 key 已存在，升级为 update
          const existing = section.find((s) => s.key === edit.key);
          if (existing) {
            existing.value = edit.value;
            if (edit.salience !== undefined) existing.salience = clamp01(edit.salience);
            existing.updatedTurn = (existing.updatedTurn ?? 0) + 1;
            applied.push(edit);
          } else {
            section.push({
              key: edit.key,
              value: edit.value,
              salience: clamp01(edit.salience ?? 0.5),
              updatedTurn: 0,
              source: "assistant",
            });
            applied.push(edit);
          }
          break;
        }
        case "update": {
          const slot = section.find((s) => s.key === edit.key);
          if (slot) {
            slot.value = edit.value;
            slot.updatedTurn = (slot.updatedTurn ?? 0) + 1;
            applied.push(edit);
          }
          // update 找不到 key 时静默跳过（不 add）
          break;
        }
        case "remove": {
          const idx = section.findIndex((s) => s.key === edit.key);
          if (idx >= 0) {
            section.splice(idx, 1);
            applied.push(edit);
          }
          break;
        }
      }
    }

    // 每个 section 检查容量
    for (const sec of SECTION_ORDER) {
      const limit = SECTION_LIMITS[sec];
      const { kept, evicted } = evictLowest(this.block[sec], limit);
      this.block[sec] = kept;
      for (const slot of evicted) {
        this.onEvict?.(slot, sec);
      }
    }

    return applied;
  }

  // ── Tier1 渲染 ──

  /**
   * 输出稳定排序的 Tier1 文本块。相同数据 → 相同输出（缓存友好）。
   * 格式与现有 synthesizeContext 的 `【用户画像】` 兼容。
   */
  render(): string {
    const sections: string[] = [];
    for (const sec of SECTION_ORDER) {
      const slots = stableSort(this.block[sec]);
      if (slots.length === 0) continue;
      const heading = SECTION_HEADINGS[sec];
      const lines = slots.map((s) => `- ${s.key}：${s.value}`);
      sections.push(`【${heading}】\n${lines.join("\n")}`);
    }
    return sections.join("\n\n");
  }

  // ── 快照 ──

  snapshot(): CoreMemoryBlock {
    return {
      aboutYou: this.block.aboutYou.map((s) => ({ ...s })),
      aboutUs: this.block.aboutUs.map((s) => ({ ...s })),
      rightNow: this.block.rightNow.map((s) => ({ ...s })),
    };
  }

  // ── 按 section 获取 slots ──

  getSection(section: CoreSection): readonly CoreSlot[] {
    return this.block[section];
  }

  // ── 按 key 查找 ──

  findSlot(section: CoreSection, key: string): CoreSlot | undefined {
    return this.block[section].find((s) => s.key === key);
  }

  // ── 写回 SlowBrainStore 的映射（addFact 等） ──

  /**
   * 把当前 aboutYou 的 facts（排除兴趣/性格前缀）导出为 Map<string, string>。
   * 用于 exportPersistentState 同步。
   */
  exportFacts(): Map<string, string> {
    const map = new Map<string, string>();
    for (const slot of this.block.aboutYou) {
      if (slot.key.startsWith("兴趣:") || slot.key.startsWith("性格:")) continue;
      map.set(slot.key, slot.value);
    }
    return map;
  }

  exportInterests(): string[] {
    return this.block.aboutYou
      .filter((s) => s.key.startsWith("兴趣:"))
      .map((s) => s.value);
  }

  exportPersonalityNotes(): string[] {
    return this.block.aboutYou
      .filter((s) => s.key.startsWith("性格:"))
      .map((s) => s.value);
  }
}
