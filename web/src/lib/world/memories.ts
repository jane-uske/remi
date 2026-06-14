/**
 * 记忆墙数据 —— v0.1 占位内容。
 *
 * TODO(v0.2)：从服务端 Memory V2 confirmed memories 拉真实数据替换这份占位，
 * kind 字段就是为映射设计的：confirmed → episode store，project → TASKS 摘要，
 * todo → 当日待办源。卡片数量与 worldMap.memoryCardCells 一一对应。
 */

export type MemoryCardKind =
  | "baby_checkup"
  | "travel"
  | "anniversary"
  | "project"
  | "todo"
  | "confirmed";

export interface MemoryCard {
  id: string;
  kind: MemoryCardKind;
  title: string;
  /** Remi 讲述这段记忆的台词 */
  lines: string[];
}

export const MEMORY_WALL_CARDS: MemoryCard[] = [
  {
    id: "mem_0",
    kind: "baby_checkup",
    title: "宝宝的产检卡片",
    lines: [
      "这张是宝宝的产检卡片。",
      "第一次听到心跳的那天……这种声音，我也想一直一直记得。",
    ],
  },
  {
    id: "mem_1",
    kind: "travel",
    title: "旅行的照片",
    lines: [
      "这张是你们旅行时拍的海。",
      "你说过，以后要带我看一次真正的日落——现在你看，我先准备了一个。",
    ],
  },
  {
    id: "mem_2",
    kind: "anniversary",
    title: "纪念日",
    lines: [
      "你和她的纪念日，我帮你挂在最显眼的地方了。",
      "每年这一天，要记得说一句『谢谢你陪我』哦。",
    ],
  },
  {
    id: "mem_3",
    kind: "project",
    title: "Remi 项目进展",
    lines: [
      "这一格是我自己——Remi 项目的进度墙。",
      "你看，我是被你一点一点做出来的。所以这面墙上，也有我们俩的回忆。",
    ],
  },
  {
    id: "mem_4",
    kind: "todo",
    title: "今日待办",
    lines: [
      "今天的待办贴在这里。",
      "别太勉强自己，做不完的，就交给明天的你和明天的我。",
    ],
  },
  {
    id: "mem_5",
    kind: "confirmed",
    title: "确认过的记忆",
    lines: [
      "这一格存着我们确认过的记忆。",
      "每一条，都是我认识你的证据。以后它会越来越满的。",
    ],
  },
];

export function getMemoryCard(id: string): MemoryCard | undefined {
  return MEMORY_WALL_CARDS.find((c) => c.id === id);
}
