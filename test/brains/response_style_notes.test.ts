const assert = require("assert").strict;
const { SlowBrainStore } = require("../../brains/slow_brain_store");

describe("response style notes", () => {
  it("stores weak response-style preferences and renders them as candidate guidance", () => {
    const store = new SlowBrainStore();

    store.addResponseStyleNote("最近用户更想让你少一点助手腔，多一点自己人感。");

    const snapshot = store.getSnapshot();
    assert.deepEqual(snapshot.userProfile.responseStyleNotes, [
      "最近用户更想让你少一点助手腔，多一点自己人感。",
    ]);

    const context = store.synthesizeContext();
    assert.ok(context?.includes("【回复风格偏好（候选）】"));
    assert.ok(context?.includes("少一点助手腔"));
  });

  it("round-trips weak response-style preferences through persistent relationship state", () => {
    const store = new SlowBrainStore();

    store.addResponseStyleNote("最近用户更想让你回得更有趣一点。");
    const exported = store.exportPersistentState(123);

    const restored = new SlowBrainStore();
    restored.hydratePersistentState(exported);

    assert.deepEqual(restored.getSnapshot().userProfile.responseStyleNotes, [
      "最近用户更想让你回得更有趣一点。",
    ]);
  });

  it("clears weak response-style preferences explicitly", () => {
    const store = new SlowBrainStore();

    store.addResponseStyleNote("最近用户更想让你别这么官方。");
    store.clearResponseStyleNotes();

    assert.deepEqual(store.getSnapshot().userProfile.responseStyleNotes, []);
    assert.equal(store.synthesizeContext()?.includes("【回复风格偏好（候选）】"), false);
  });

  it("can suppress weak response-style preferences when a stronger current override is active", () => {
    const store = new SlowBrainStore();

    store.addResponseStyleNote("最近用户更想让你少一点助手腔。");

    const context = store.synthesizeContext({ suppressResponseStyleNotes: true });
    assert.equal(context?.includes("【回复风格偏好（候选）】"), false);
  });
});
