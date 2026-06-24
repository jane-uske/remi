import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "mocha";

import { RemiSessionContext } from "../../../brains/remi_session_context";
import { resetConfig } from "../../../server/config";
import {
  loadAndApplyRemiSelf,
  saveRemiSelfFromLiveState,
} from "../../../server/session/remi_self";
import {
  __resetRemiSelfRepositoryForTest,
} from "../../../storage/repositories/remi_self_repository_factory";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function setFlags(self: boolean, offlineLife: boolean): void {
  if (self) process.env.REMI_SELF_PERSISTENCE_ENABLED = "1";
  else delete process.env.REMI_SELF_PERSISTENCE_ENABLED;
  if (offlineLife) process.env.REMI_OFFLINE_LIFE_ENABLED = "1";
  else delete process.env.REMI_OFFLINE_LIFE_ENABLED;
  resetConfig();
}

// 离线居家人生 P1：loadAndApplyRemiSelf 复用 saved.lastSeenAt 确定性复算归来叙事，
// 非空时写入 brain.offlineReturnAnchor。两 flag 都开 + 离线 ≥30min 才生效。
describe("离线归来叙事 会话接线 (loadAndApplyRemiSelf → offlineReturnAnchor)", () => {
  beforeEach(() => {
    __resetRemiSelfRepositoryForTest();
  });
  afterEach(() => {
    setFlags(false, false);
    __resetRemiSelfRepositoryForTest();
  });

  it("两 flag 都 on + 离线 2h：offlineReturnAnchor 非空且含事实锚", async () => {
    setFlags(true, true);
    const brain = new RemiSessionContext("conn-ol-a");
    brain.setUserId("user-ol-a");
    brain.persona.liveState.lastTopicSummary = "你说周末要去爬山";

    await saveRemiSelfFromLiveState(brain, new Date(Date.now() - 2 * HOUR));

    const fresh = new RemiSessionContext("conn-ol-a2");
    fresh.setUserId("user-ol-a");
    await loadAndApplyRemiSelf(fresh, "user-ol-a", new Date());

    assert.ok(fresh.offlineReturnAnchor, "应算出归来叙事");
    assert.ok(fresh.offlineReturnAnchor!.includes("【离线经历·事实锚】"));
    assert.ok(fresh.offlineReturnAnchor!.includes("只能讲这些"));
  });

  it("offline-life flag off（仅 persistence on）：offlineReturnAnchor 恒 null", async () => {
    setFlags(true, false);
    const brain = new RemiSessionContext("conn-ol-b");
    brain.setUserId("user-ol-b");
    await saveRemiSelfFromLiveState(brain, new Date(Date.now() - 2 * HOUR));

    const fresh = new RemiSessionContext("conn-ol-b2");
    fresh.setUserId("user-ol-b");
    await loadAndApplyRemiSelf(fresh, "user-ol-b", new Date());

    // remiSelfFocus 可能被 persistence 路径设置，但 offline anchor 必须 null。
    assert.equal(fresh.offlineReturnAnchor, null, "offline-life off → anchor 恒 null");
  });

  it("两 flag on 但离线 <30min：offlineReturnAnchor null（不构成一段日子）", async () => {
    setFlags(true, true);
    const brain = new RemiSessionContext("conn-ol-c");
    brain.setUserId("user-ol-c");
    await saveRemiSelfFromLiveState(brain, new Date(Date.now() - 10 * MIN));

    const fresh = new RemiSessionContext("conn-ol-c2");
    fresh.setUserId("user-ol-c");
    await loadAndApplyRemiSelf(fresh, "user-ol-c", new Date());

    assert.equal(fresh.offlineReturnAnchor, null, "<30min → 不注入");
  });

  it("persistence flag off：整条路径短路（offline-life on 也不生效）", async () => {
    // 先在两 flag on 下写一条记录。
    setFlags(true, true);
    const brain = new RemiSessionContext("conn-ol-d");
    brain.setUserId("user-ol-d");
    await saveRemiSelfFromLiveState(brain, new Date(Date.now() - 2 * HOUR));

    // 关掉 persistence（offline-life 仍 on）→ loadAndApplyRemiSelf 在 :62 直接 return。
    setFlags(false, true);
    const fresh = new RemiSessionContext("conn-ol-d2");
    fresh.setUserId("user-ol-d");
    await loadAndApplyRemiSelf(fresh, "user-ol-d", new Date());

    assert.equal(fresh.offlineReturnAnchor, null, "persistence off → 不读不算");
  });

  it("无记录（首次见用户）：anchor null，不报错", async () => {
    setFlags(true, true);
    const fresh = new RemiSessionContext("conn-ol-e");
    fresh.setUserId("brand-new-offline-user");
    await loadAndApplyRemiSelf(fresh, "brand-new-offline-user", new Date());
    assert.equal(fresh.offlineReturnAnchor, null);
  });
});
