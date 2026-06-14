import type {} from "mocha";

const assert = require("node:assert/strict");

import {
  RemiBehaviorController,
  findRoute,
  scheduledBehaviorAt,
  spotOf,
  BEHAVIOR_SPOTS,
  type BehaviorId,
  type BehaviorPuppet,
  type TaskMotion,
} from "@/lib/world/behavior";

/** 记录 puppet 收到的指令，便于断言 */
class FakePuppet implements BehaviorPuppet {
  x = 0;
  z = 0;
  yaw = 0;
  mode: "task" | "attend" | "talk" = "task";
  motion: TaskMotion | null = null;
  walking = false;

  getPosition() {
    return { x: this.x, z: this.z };
  }
  setPosition(x: number, z: number) {
    this.x = x;
    this.z = z;
  }
  setDesiredYaw(yaw: number) {
    this.yaw = yaw;
  }
  setMode(mode: "task" | "attend" | "talk") {
    this.mode = mode;
  }
  setTaskMotion(motion: TaskMotion | null) {
    this.motion = motion;
  }
  setWalking(walking: boolean) {
    this.walking = walking;
  }
}

/** 把控制器推进一段虚拟时间（玩家在远处） */
function advance(
  ctrl: RemiBehaviorController,
  seconds: number,
  player: { x: number; z: number },
  nowMs: number,
  stepMs = 100,
) {
  const dt = stepMs / 1000;
  for (let t = 0; t < seconds * 1000; t += stepMs) {
    ctrl.update(dt, player, nowMs + t);
  }
}

const FAR = { x: -50, z: -50 };

describe("RemiWorld 行为调度器（RW-P1-1/2/5）", () => {
  it("进入世界时她已经在某个行为点上做事，而不是凭空站着", () => {
    const p = new FakePuppet();
    const now = 1_000_000_000;
    const ctrl = new RemiBehaviorController(p, {}, now);
    const expected = scheduledBehaviorAt(now);
    const spot = spotOf(expected);
    assert.equal(p.x, spot.x, "出生即在行为点 x");
    assert.equal(p.z, spot.z, "出生即在行为点 z");
    assert.equal(p.mode, "task");
    assert.equal(ctrl.getState(), "doing");
    assert.ok(p.motion, "应带有任务微动作");
  });

  it("玩家走近 → 进入 attend（抬头转向），不再保持 task 朝向", () => {
    const p = new FakePuppet();
    const ctrl = new RemiBehaviorController(p, {}, 1_000_000_000);
    const near = { x: p.x + 1.5, z: p.z + 1.0 };
    ctrl.update(0.1, near, 1_000_000_000);
    assert.equal(ctrl.getState(), "attending");
    assert.equal(p.mode, "attend");
    assert.equal(p.motion, null, "抬头时停下手里的事");
  });

  it("对话打开停下面向玩家；关闭后回到之前的行为（打断恢复）", () => {
    const p = new FakePuppet();
    const ctrl = new RemiBehaviorController(p, {}, 1_000_000_000);
    const before = ctrl.getActivity().id;

    ctrl.onDialogueOpen();
    assert.equal(ctrl.getState(), "talking");
    assert.equal(p.mode, "talk");
    assert.equal(p.walking, false);

    // 对话中即使时间流逝也保持 talking
    advance(ctrl, 3, { x: p.x, z: p.z }, 1_000_000_000);
    assert.equal(ctrl.getState(), "talking");

    ctrl.onDialogueClose();
    // 玩家走远，给足恢复时间
    advance(ctrl, 4, FAR, 1_000_000_000);
    assert.equal(ctrl.getState(), "doing", "应回到 doing");
    assert.equal(ctrl.getActivity().id, before, "应恢复到打断前的行为");
    assert.equal(p.mode, "task");
  });

  it("墙钟推进会让她换地方（走过去而不是瞬移）", () => {
    const p = new FakePuppet();
    const t0 = 0;
    const ctrl = new RemiBehaviorController(p, {}, t0);
    const start = ctrl.getActivity().id;
    // 跳到一个一定会切换行为的未来时刻
    let future = t0;
    for (let i = 1; i < 40; i++) {
      if (scheduledBehaviorAt(i * 105_000) !== start) {
        future = i * 105_000;
        break;
      }
    }
    // 第一次 update 触发起步行走
    ctrl.update(0.1, FAR, future);
    assert.equal(ctrl.getState(), "walking");
    assert.equal(p.walking, true);
    // 走一段时间应到达新行为点并恢复 doing
    advance(ctrl, 30, FAR, future);
    assert.equal(ctrl.getState(), "doing");
    assert.notEqual(ctrl.getActivity().id, start);
  });

  it("forceBehavior 钉死行为且不再被墙钟切换（截图复现）", () => {
    const p = new FakePuppet();
    const ctrl = new RemiBehaviorController(p, {}, 0);
    ctrl.forceBehavior("flowers");
    const spot = spotOf("flowers");
    assert.equal(p.x, spot.x);
    assert.equal(p.z, spot.z);
    advance(ctrl, 60, FAR, 500_000); // 远超一个行为窗口
    assert.equal(ctrl.getActivity().id, "flowers", "钉死后不应换行为");
  });

  it("路点图连通：任意两个行为点之间都能找到路线", () => {
    const ids: BehaviorId[] = BEHAVIOR_SPOTS.map((b) => b.id);
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) {
          assert.equal(findRoute(a, b).length, 0);
        } else {
          assert.ok(findRoute(a, b).length > 0, `${a}→${b} 应有路线`);
        }
      }
    }
  });
});
