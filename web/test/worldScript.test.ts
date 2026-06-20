import type {} from "mocha";

const assert = require("node:assert/strict");

import {
  WorldScript,
  buildSituationalContext,
  loadSave,
  type ScriptUi,
  type WorldStage,
} from "@/lib/world/script";
import { MEMORY_WALL_CARDS } from "@/lib/world/memories";
import { worldTimeProfileAt } from "@/lib/world/worldTime";

interface Recorded {
  dialogues: Array<{ speaker: string; lines: string[] }>;
  objectives: string[];
  toasts: string[];
  stageCalls: string[];
  liveChats: Array<string | null>;
  worldEvents: string[];
}

function makeHarness(): { script: WorldScript; rec: Recorded } {
  const rec: Recorded = {
    dialogues: [],
    objectives: [],
    toasts: [],
    stageCalls: [],
    liveChats: [],
    worldEvents: [],
  };
  const stage: WorldStage = {
    setLanternLit: (lit) => rec.stageCalls.push(`lantern:${lit}`),
    plantFlowers: (animate) => rec.stageCalls.push(`flowers:${animate ?? true}`),
    setDusk: (t) => rec.stageCalls.push(`dusk:${t}`),
    remiHappy: () => rec.stageCalls.push("happy"),
  };
  const ui: ScriptUi = {
    // 对话立即走完（模拟玩家按 E 跳完台词）
    openDialogue: (speaker, lines, onDone) => {
      rec.dialogues.push({ speaker, lines });
      onDone?.();
    },
    openLiveChat: (opener) => rec.liveChats.push(opener ?? null),
    recordWorldEvent: (event) => rec.worldEvents.push(event),
    setObjective: (text) => rec.objectives.push(text),
    toast: (text) => rec.toasts.push(text),
  };
  return { script: new WorldScript(stage, ui), rec };
}

describe("RemiWorld v0.1 剧本状态机", () => {
  it("开场目标是与 Remi 对话，对话后推进到种花", () => {
    const { script, rec } = makeHarness();
    script.onWorldReady();
    assert.ok(rec.objectives.at(-1)!.includes("与 Remi 对话"));

    script.handleInteract("remi");
    assert.equal(script.getSave().introDone, true);
    assert.ok(rec.objectives.at(-1)!.includes("种下一朵花"));
  });

  it("开场目标跟随当前时间段，不固定成傍晚", () => {
    const { script, rec } = makeHarness();
    script.onWorldReady(new Date(2026, 5, 14, 23, 30).getTime());
    assert.ok(rec.objectives.at(-1)!.includes("深夜"));
    assert.ok(!rec.objectives.at(-1)!.includes("傍晚"));
  });

  it("开场白之后再和 Remi 说话 → 进入真实对话（openLiveChat），不再走脚本台词", () => {
    const { script, rec } = makeHarness();
    script.onWorldReady();
    script.handleInteract("remi"); // 开场白（脚本）
    const dialoguesAfterIntro = rec.dialogues.length;

    script.handleInteract("remi"); // 第二次：真实对话
    assert.equal(rec.liveChats.length, 1, "应打开一次真实对话");
    assert.equal(
      rec.dialogues.length,
      dialoguesAfterIntro,
      "不应再追加脚本台词",
    );
  });

  it("隔天回来（已点灯+多次到访）把问候作为开场语境带进真实对话", () => {
    const { script, rec } = makeHarness();
    const save = script.getSave();
    save.introDone = true;
    save.lanternLit = true;
    save.flowerPlanted = true;
    save.visits = 1; // onWorldReady 会 +1 → 2
    script.onWorldReady();

    script.handleInteract("remi");
    assert.equal(rec.liveChats.length, 1);
    assert.ok(
      (rec.liveChats[0] ?? "").includes("你回来啦"),
      "开场语境应是隔天回来的问候",
    );
    assert.ok(rec.stageCalls.includes("happy"));
  });

  it("离线几个小时后回来，把日常推演开场带进真实对话", () => {
    const { script, rec } = makeHarness();
    const now = new Date(2026, 5, 14, 23, 30).getTime();
    const save = script.getSave();
    save.introDone = true;
    save.lanternLit = true;
    save.flowerPlanted = true;
    save.visits = 1; // onWorldReady 会 +1 → 2
    save.lastSeenAt = now - 9 * 60 * 60_000;
    script.onWorldReady(now);

    script.handleInteract("remi");
    assert.equal(rec.liveChats.length, 1);
    assert.match(rec.liveChats[0] ?? "", /你不在/);
    assert.match(rec.liveChats[0] ?? "", /深夜/);
    assert.match(rec.liveChats[0] ?? "", /花|灯/);
  });

  it("种花触发开花、开心与目标推进；重复交互只有台词", () => {
    const { script, rec } = makeHarness();
    script.onWorldReady();
    script.handleInteract("remi");

    script.handleInteract("flowerbed");
    assert.equal(script.getSave().flowerPlanted, true);
    assert.ok(rec.stageCalls.includes("flowers:true"));
    assert.ok(rec.stageCalls.includes("happy"));
    assert.ok(rec.objectives.at(-1)!.includes("灯笼"));

    const callsBefore = rec.stageCalls.length;
    script.handleInteract("flowerbed");
    assert.equal(rec.stageCalls.length, callsBefore, "重复种花不应再触发舞台效果");
  });

  it("点灯切换世界为暮色并进入自由探索", () => {
    const { script, rec } = makeHarness();
    script.onWorldReady();
    script.handleInteract("remi");
    script.handleInteract("flowerbed");

    script.handleInteract("lantern");
    assert.equal(script.getSave().lanternLit, true);
    assert.ok(rec.stageCalls.includes("lantern:true"));
    assert.ok(rec.stageCalls.includes("dusk:true"));
    assert.ok(rec.objectives.at(-1)!.includes("自由探索"));
  });

  it("没打招呼就点灯会被 Remi 拦下来", () => {
    const { script, rec } = makeHarness();
    script.onWorldReady();
    script.handleInteract("lantern");
    assert.equal(script.getSave().lanternLit, false);
    assert.ok(!rec.stageCalls.includes("lantern:true"));
    assert.ok(rec.dialogues.at(-1)!.lines.join("").includes("打个招呼"));
  });

  it("记忆墙六张卡都能让 Remi 讲述对应记忆", () => {
    const { script, rec } = makeHarness();
    script.onWorldReady();
    for (const card of MEMORY_WALL_CARDS) {
      script.handleInteract(card.id);
      assert.deepEqual(rec.dialogues.at(-1)!.lines, card.lines);
      assert.ok(rec.toasts.at(-1)!.includes(card.title));
    }
  });

  it("世界就绪时按存档恢复：灯亮过就直接亮、花种过就直接开", () => {
    const { script, rec } = makeHarness();
    const save = script.getSave();
    save.introDone = true;
    save.flowerPlanted = true;
    save.lanternLit = true;
    script.onWorldReady(new Date(2026, 5, 14, 13, 30).getTime());
    assert.ok(rec.stageCalls.includes("flowers:false"));
    assert.ok(rec.stageCalls.includes("lantern:true"));
    assert.ok(rec.stageCalls.includes("dusk:false"));
    assert.ok(rec.objectives.at(-1)!.includes("自由探索"));
  });
});

describe("RW-P1-4 世界情境注入（buildSituationalContext）", () => {
  it("包含她刚在做的事、用户在身边、第几天", () => {
    const save = { ...loadSave(), flowerPlanted: false, lanternLit: false };
    const ctx = buildSituationalContext({ activity: "在长椅边发呆", save });
    assert.ok(ctx.includes("在长椅边发呆"), "应含当前活动");
    assert.ok(ctx.includes("身边"), "应说明用户在身边");
    assert.ok(/第 \d+ 天/.test(ctx), "应含天数");
  });

  it("按当前时间段写入世界情境，而不是固定傍晚", () => {
    const save = { ...loadSave(), flowerPlanted: false, lanternLit: false };
    const ctx = buildSituationalContext({
      activity: "在电脑前听音乐",
      save,
      time: worldTimeProfileAt(new Date(2026, 5, 14, 23, 30).getTime()),
    });
    assert.ok(ctx.includes("深夜"), "应包含当前时间段");
    assert.ok(ctx.includes("灯和屏幕光"), "应包含该时间段的场景事实");
    assert.ok(!ctx.includes("傍晚"), "不应再固定写死傍晚");
  });

  it("花/灯状态按存档条件出现", () => {
    const base = loadSave();
    const none = buildSituationalContext({
      activity: "在窗边看海",
      save: { ...base, flowerPlanted: false, lanternLit: false },
    });
    assert.ok(!none.includes("花圃"), "没种花不应提花");
    assert.ok(!none.includes("灯笼"), "没点灯不应提灯");

    const both = buildSituationalContext({
      activity: "在窗边看海",
      save: { ...base, flowerPlanted: true, lanternLit: true },
    });
    assert.ok(both.includes("花"), "种了花应提到");
    assert.ok(both.includes("灯笼"), "点了灯应提到");
  });

  it("是陈述句、提醒不要复述（ground truth 而非指令）", () => {
    const ctx = buildSituationalContext({
      activity: "在书架边看书",
      save: loadSave(),
    });
    assert.ok(ctx.includes("不要") && ctx.includes("复述"), "应提示不要复述");
  });
});
