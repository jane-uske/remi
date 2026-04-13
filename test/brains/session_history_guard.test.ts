const assert = require("assert").strict;

const { RemiSessionContext } = require("../../brains/remi_session_context");

describe("session history guard", () => {
  it("filters fallback assistant replies when hydrating history from db", () => {
    const ctx = new RemiSessionContext("history-guard");
    ctx.hydrateHistoryFromDb([
      {
        id: "1",
        session_id: "s1",
        role: "user",
        content: "111",
        created_at: new Date(),
      },
      {
        id: "2",
        session_id: "s1",
        role: "assistant",
        content: "啊…出了点问题，等我缓缓再试试…",
        created_at: new Date(),
      },
      {
        id: "3",
        session_id: "s1",
        role: "assistant",
        content: "正常回复",
        created_at: new Date(),
      },
    ]);

    assert.deepEqual(
      ctx.history.map((item) => item.content),
      ["111", "正常回复"],
    );
    assert.equal(
      ctx.persona.liveState.recentInteractions.includes("你：啊…出了点问题，等我缓缓再试试…"),
      false,
    );
  });
});
