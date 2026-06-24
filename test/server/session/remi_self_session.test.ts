import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "mocha";

import { RemiSessionContext } from "../../../brains/remi_session_context";
import { resetConfig } from "../../../server/config";
import {
  loadAndApplyRemiSelf,
  saveRemiSelfFromLiveState,
  deriveRemiSelfFocus,
  remiSelfPersistenceEnabled,
} from "../../../server/session/remi_self";
import {
  getRemiSelfRepository,
  __resetRemiSelfRepositoryForTest,
} from "../../../storage/repositories/remi_self_repository_factory";

const HOUR = 60 * 60 * 1000;

function enableFlag(on: boolean): void {
  if (on) process.env.REMI_SELF_PERSISTENCE_ENABLED = "1";
  else delete process.env.REMI_SELF_PERSISTENCE_ENABLED;
  resetConfig();
}

// DL-P1b: 会话级加载 / 漂移 / soft-patch / 写回（无 DB → 工厂走内存单例）。
describe("RemiSelf session wiring (load + drift + soft-patch + save)", () => {
  beforeEach(() => {
    __resetRemiSelfRepositoryForTest();
    enableFlag(true);
  });
  afterEach(() => {
    enableFlag(false);
    __resetRemiSelfRepositoryForTest();
  });

  it("flag on：写回后再加载（隔天），mood 收敛/energy 满/topicPull 清空/currentFocus 保留", async () => {
    const brain = new RemiSessionContext("conn-a");
    brain.setUserId("user-a");
    // 模拟一段会话后的 live state
    brain.persona.liveState.mood = "开心";
    brain.persona.liveState.energy = "low";
    brain.persona.liveState.topicPull = "周末爬山";
    brain.persona.liveState.lastTopicSummary = "你说周末要去爬山";

    // disconnect 写回（lastSeenAt = 昨天）
    const yesterday = new Date(Date.now() - 30 * HOUR);
    await saveRemiSelfFromLiveState(brain, yesterday);

    // 新会话：默认 live state，加载 + 漂移 soft-patch
    const fresh = new RemiSessionContext("conn-b");
    fresh.setUserId("user-a");
    await loadAndApplyRemiSelf(fresh, "user-a", new Date());

    assert.equal(fresh.persona.liveState.mood, "平静", ">24h mood 收敛中性");
    assert.equal(fresh.persona.liveState.energy, "high", ">24h energy 满");
    assert.equal(fresh.persona.liveState.topicPull, "", ">24h topicPull 清空");
    assert.ok(fresh.remiSelfFocus && fresh.remiSelfFocus.includes("爬山"), "currentFocus 保留（还记着上次）");
  });

  it("flag on + 短暂离线（<30min）：mood/energy 原样恢复", async () => {
    const brain = new RemiSessionContext("conn-c");
    brain.setUserId("user-c");
    brain.persona.liveState.mood = "好奇";
    brain.persona.liveState.energy = "low";
    brain.persona.liveState.topicPull = "换工作";

    const recent = new Date(Date.now() - 5 * 60 * 1000);
    await saveRemiSelfFromLiveState(brain, recent);

    const fresh = new RemiSessionContext("conn-d");
    fresh.setUserId("user-c");
    await loadAndApplyRemiSelf(fresh, "user-c", new Date());

    assert.equal(fresh.persona.liveState.mood, "好奇");
    assert.equal(fresh.persona.liveState.energy, "low");
    assert.equal(fresh.persona.liveState.topicPull, "换工作");
  });

  it("无记录（首次见这个用户）：保持默认，不报错", async () => {
    const fresh = new RemiSessionContext("conn-e");
    fresh.setUserId("brand-new-user");
    const defaultMood = fresh.persona.liveState.mood;
    const defaultEnergy = fresh.persona.liveState.energy;
    await loadAndApplyRemiSelf(fresh, "brand-new-user", new Date());
    assert.equal(fresh.persona.liveState.mood, defaultMood);
    assert.equal(fresh.persona.liveState.energy, defaultEnergy);
    assert.equal(fresh.remiSelfFocus, null);
  });

  it("flag off：load/save 全短路（写回不落、加载不改默认）", async () => {
    enableFlag(false);
    assert.equal(remiSelfPersistenceEnabled(), false);

    const brain = new RemiSessionContext("conn-f");
    brain.setUserId("user-f");
    brain.persona.liveState.mood = "委屈";
    // saveRemiSelfFromLiveState 本身不查 flag（continuity.persistRemiSelfState 查）；
    // loadAndApplyRemiSelf 查 flag → off 时直接 no-op，即便仓库里有记录也不读。
    await saveRemiSelfFromLiveState(brain, new Date(Date.now() - 30 * HOUR));

    const fresh = new RemiSessionContext("conn-g");
    fresh.setUserId("user-f");
    const defaultMood = fresh.persona.liveState.mood;
    await loadAndApplyRemiSelf(fresh, "user-f", new Date());
    assert.equal(fresh.persona.liveState.mood, defaultMood, "flag off：加载短路，default 不变");
    assert.equal(fresh.remiSelfFocus, null);
  });

  it("无 userId：load/save no-op，不报错", async () => {
    const brain = new RemiSessionContext("conn-h");
    // 未 setUserId → userId = ""
    await saveRemiSelfFromLiveState(brain, new Date());
    await loadAndApplyRemiSelf(brain, "", new Date());
    // 仓库里不应有空 key 记录
    const repo = getRemiSelfRepository();
    assert.equal(await repo.load(""), null);
  });

  it("deriveRemiSelfFocus 从慢脑/liveState 派生焦点（截断封顶）", async () => {
    const brain = new RemiSessionContext("conn-i");
    brain.setUserId("user-i");
    brain.persona.liveState.lastTopicSummary = "你提到下周要搬家";
    const focus = deriveRemiSelfFocus(brain);
    assert.ok(focus && focus.includes("搬家"));
    assert.ok(focus.length <= 80);
  });

  it("deriveRemiSelfFocus 无任何线索 → null", () => {
    const brain = new RemiSessionContext("conn-j");
    brain.setUserId("user-j");
    brain.persona.liveState.lastTopicSummary = "无最近话题";
    assert.equal(deriveRemiSelfFocus(brain), null);
  });
});
