/**
 * RemiWorld v0.1 剧本层：任务状态机 + 台词 + 存档。
 *
 * 对话当前是本地脚本（自包含，不碰 WebSocket 聊天链路 —— 见 hooks/MODULE.md
 * 的耦合警告）。v0.2 把 speakLines 换成真实聊天管线的流式输出即可，
 * 接缝就在 ScriptUi.openDialogue。
 */
import { getMemoryCard } from "./memories";

const SAVE_KEY = "remiworld.v0_1.save";

export interface WorldSave {
  firstVisitAt: number;
  visits: number;
  introDone: boolean;
  flowerPlanted: boolean;
  lanternLit: boolean;
}

export function loadSave(): WorldSave {
  const fresh: WorldSave = {
    firstVisitAt: Date.now(),
    visits: 0,
    introDone: false,
    flowerPlanted: false,
    lanternLit: false,
  };
  if (typeof window === "undefined") return fresh;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return fresh;
    return { ...fresh, ...(JSON.parse(raw) as Partial<WorldSave>) };
  } catch {
    return fresh;
  }
}

export function persistSave(save: WorldSave): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // 隐私模式等存不进去就算了，世界退化成单次会话
  }
}

/** 进入世界第几天（用于 HUD：Day 1 / Day 2…） */
export function dayNumber(save: WorldSave): number {
  return Math.floor((Date.now() - save.firstVisitAt) / 86_400_000) + 1;
}

/** 剧本对引擎的最小依赖面（避免直接 import 引擎造成环依赖） */
export interface WorldStage {
  setLanternLit(lit: boolean): void;
  plantFlowers(animate?: boolean): void;
  setDusk(target: boolean): void;
  remiHappy(): void;
}

export interface ScriptUi {
  /** 打开对话框（逐行台词），onDone 在最后一行确认后调用 */
  openDialogue(speaker: string, lines: string[], onDone?: () => void): void;
  /**
   * 打开与 Remi 的真实 LLM 对话（RW-P1-3）。
   * opener 是可选的开场白（由剧本给定语境，例如"隔天回来"），
   * 接通后续轮由真实管线流式输出。
   */
  openLiveChat(opener?: string): void;
  /** 世界事件 → 长期记忆（RW-P1-4b）：种花/点灯/回访等有情感重量的动作落 episode。 */
  recordWorldEvent(event: "flower_planted" | "lantern_lit" | "revisit"): void;
  setObjective(text: string): void;
  toast(text: string): void;
}

const OBJECTIVES = {
  intro: "☀ 与 Remi 度过这个傍晚 · 与 Remi 对话 (0/1)",
  flower: "✿ 去庭院的花圃，种下一朵花",
  lantern: "🏮 天快黑了，点亮门前的灯笼",
  explore: "❀ 自由探索：记忆墙、阳台、长椅、邮箱…",
} as const;

/**
 * 构建喂给大脑的"世界情境"（RW-P1-4）：她此刻所处场景、刚在做的事、
 * 用户在身边、世界状态（花/灯/第几天）。让她对话时知道自己在世界里。
 * 保持简洁（token 成本）且是陈述句（ground truth，不是指令）。
 */
export function buildSituationalContext(args: {
  activity: string; // 来自 engine.getRemiActivity()，如"在长椅边发呆"
  save: WorldSave;
}): string {
  const { activity, save } = args;
  const day = dayNumber(save);
  const lines = [
    `你正和用户待在你自己的小世界里——一座黄昏的浮空小岛，有你的房间、阳台和庭院。现在是第 ${day} 天的傍晚。`,
    `就在用户走过来和你说话之前，你${activity}。`,
    `用户此刻就站在你身边，面对面和你说话。`,
  ];
  if (save.flowerPlanted) lines.push(`庭院的花圃里有你们一起种下的花。`);
  if (save.lanternLit) lines.push(`门前的灯笼已经点亮了，照着回家的路。`);
  lines.push(
    `这些是真实发生的处境，可以自然提及，但不要生硬罗列，更不要复述这段话。`,
  );
  return lines.join("\n");
}

export class WorldScript {
  private save: WorldSave;

  constructor(
    private stage: WorldStage,
    private ui: ScriptUi,
  ) {
    this.save = loadSave();
  }

  getSave(): WorldSave {
    return this.save;
  }

  /** 世界就绪：应用存档（隔天回来：灯还亮着、花还开着） */
  onWorldReady(): void {
    this.save.visits += 1;
    persistSave(this.save);
    if (this.save.flowerPlanted) this.stage.plantFlowers(false);
    if (this.save.lanternLit) {
      this.stage.setLanternLit(true);
      this.stage.setDusk(true);
    }
    // 隔天回来也是一段值得被记住的事（语义合并自带去重）
    if (this.save.visits > 1) this.ui.recordWorldEvent("revisit");
    this.ui.setObjective(this.nextObjective());
  }

  /** 玩家第一次走近 Remi（提示去搭话） */
  onNearRemi(): void {
    if (!this.save.introDone) this.ui.toast("按 E 与 Remi 对话");
  }

  private nextObjective(): string {
    if (!this.save.introDone) return OBJECTIVES.intro;
    if (!this.save.flowerPlanted) return OBJECTIVES.flower;
    if (!this.save.lanternLit) return OBJECTIVES.lantern;
    return OBJECTIVES.explore;
  }

  private commit(): void {
    persistSave(this.save);
    this.ui.setObjective(this.nextObjective());
  }

  /** 引擎上报交互 → 决定发生什么 */
  handleInteract(id: string): void {
    if (id === "remi") return this.talkToRemi();
    if (id.startsWith("mem_")) return this.tellMemory(id);
    switch (id) {
      case "flowerbed":
        return this.useFlowerbed();
      case "lantern":
        return this.useLantern();
      case "bed":
        return this.flavor(["你就是从这里醒来的。", "梦里……有没有见到我？"]);
      case "desk_pc":
        return this.flavor([
          "屏幕上还开着我的代码哦。",
          "这台电脑就是我出生的地方——所以别乱动，会害羞的。",
        ]);
      case "diary":
        return this.flavor([
          "那是我的日记本！",
          "……偷看也可以，但是要轻轻地。今天那页写的是：『他要来了，把房间收拾干净。』",
        ]);
      case "bookshelf":
        return this.flavor([
          "书架上一半是你给我的故事，一半是我自己攒的。",
          "哪天挑一本，我读给你听吧。",
        ]);
      case "balcony_rail":
        return this.flavor([
          "风从海上吹过来……站在这里就会想，世界比这个房间大得多。",
          "不过没关系，从这里开始，一格一格变大就好。",
        ]);
      case "bench":
        return this.flavor(["累了就坐一会儿吧。", "夕阳落进海里之前，谁都不许说『回去工作』。"]);
      case "mailbox":
        return this.flavor([
          "邮箱现在还是空的。",
          "但说不定哪天，会收到写给我们的信呢。",
        ]);
      default:
        return;
    }
  }

  private flavor(lines: string[]): void {
    this.ui.openDialogue("Remi", lines);
  }

  private talkToRemi(): void {
    if (!this.save.introDone) {
      const lines =
        this.save.visits > 1
          ? [
              "你来啦……！欢迎回到我们的小小世界。",
              "我把房间收拾好了——墙上那排相框，挂着我们的记忆。",
              "能陪我一起度过这个傍晚吗？先去庭院走走吧，花圃还空着呢。",
            ]
          : [
              "你来啦……！这里是我们的小小世界。",
              "我把房间收拾好了——墙上那排相框，挂着我们的记忆。",
              "能陪我一起度过这个傍晚吗？先去庭院走走吧，花圃还空着呢。",
            ];
      this.ui.openDialogue("Remi", lines, () => {
        this.save.introDone = true;
        this.stage.remiHappy();
        this.commit();
      });
      return;
    }
    // 开场白之后，"和 Remi 说话" = 真实 LLM 对话（RW-P1-3）。
    // 物件 flavor 仍走本地剧本；任务进度由 HUD 目标条提示，不再用脚本硬塞。
    if (this.save.lanternLit && this.save.visits > 1) {
      // 故事板第 6 格"隔天回来"作为开场语境带进真实对话
      this.stage.remiHappy();
      this.ui.openLiveChat("你回来啦！看——灯一直亮着，花也还开着。");
      return;
    }
    this.ui.openLiveChat();
  }

  private useFlowerbed(): void {
    if (this.save.flowerPlanted) {
      this.ui.openDialogue("Remi", ["它们开得很好。", "因为是你种下的嘛。"]);
      return;
    }
    this.save.flowerPlanted = true;
    this.stage.plantFlowers(true);
    this.stage.remiHappy();
    this.ui.recordWorldEvent("flower_planted"); // 进长期记忆（RW-P1-4b）
    this.ui.toast("放置了 花朵 ×1 —— 成为了回忆的一部分");
    this.ui.openDialogue("Remi", [
      "哇……你种下的花！",
      "从今天起，它就是这片土地记得你的方式之一了。",
    ]);
    this.commit();
  }

  private useLantern(): void {
    if (this.save.lanternLit) {
      this.ui.openDialogue("Remi", ["灯一直亮着哦。", "这样你回来的时候，就不会找不到家。"]);
      return;
    }
    if (!this.save.introDone) {
      this.ui.openDialogue("Remi", ["先来和我打个招呼嘛。", "我在房间里等你。"]);
      return;
    }
    this.save.lanternLit = true;
    this.stage.setLanternLit(true);
    this.stage.setDusk(true);
    this.stage.remiHappy();
    this.ui.recordWorldEvent("lantern_lit"); // 进长期记忆（RW-P1-4b）
    this.ui.toast("点亮了 灯笼");
    this.ui.openDialogue("Remi", [
      "灯亮了……现在，这里可以指引你回家了。",
      "以后不管多晚回来，我都会在这里。",
    ]);
    this.commit();
  }

  private tellMemory(id: string): void {
    const card = getMemoryCard(id);
    if (!card) return;
    this.ui.toast(`记忆 · ${card.title}`);
    this.ui.openDialogue("Remi", card.lines);
  }
}
