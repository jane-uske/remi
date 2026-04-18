const assert = require("assert").strict;
const { SentenceChunker } = require("../../utils/sentence_chunker");

function withEnv(overrides, fn) {
  const restore = Object.entries(overrides).map(([key, value]) => {
    const previous = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    return () => {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    };
  });

  try {
    return fn();
  } finally {
    for (const undo of restore.reverse()) undo();
  }
}

describe("SentenceChunker", () => {
  it("soft-breaks the first chunk only after a sufficiently long clause", () => {
    const prefix = "如果这件事情你现在还想继续往前推一点点再多观察一下的话，";
    assert(prefix.length >= 24);
    const chunker = new SentenceChunker({
      eagerCharThreshold: 24,
      eagerLookaheadChars: 10,
      eagerSoftBreakMinChars: 24,
      eagerMinTtsChars: 1,
      minTtsChars: 1,
    });
    chunker.setEager(true);

    const first = chunker.push(prefix.slice(0, -1));
    assert.deepEqual(first, []);

    const second = chunker.push("，");
    assert.deepEqual(second, [prefix]);

    chunker.setEager(false);
    const third = chunker.push("我们最好先把主链路稳定住。");
    assert.deepEqual(third, ["我们最好先把主链路稳定住。"]);
    const last = chunker.flush();
    assert.equal(last, "");
  });

  it("does not split on a short comma clause before the sentence actually ends", () => {
    const chunker = new SentenceChunker({
      eagerCharThreshold: 14,
      eagerLookaheadChars: 10,
      eagerSoftBreakMinChars: 24,
      eagerMinTtsChars: 1,
      minTtsChars: 1,
    });
    chunker.setEager(true);

    const text = "你先别急，我们再看看。";
    const out = [];
    for (const ch of text) {
      out.push(...chunker.push(ch));
    }

    assert.deepEqual(out, [text]);
    assert.equal(chunker.flush(), "");
  });

  it("waits for a hard sentence end when no eligible soft break exists", () => {
    const chunker = new SentenceChunker({
      eagerCharThreshold: 24,
      eagerLookaheadChars: 10,
      eagerSoftBreakMinChars: 24,
      eagerMinTtsChars: 1,
      minTtsChars: 1,
    });
    chunker.setEager(true);

    const text = "其实我刚刚想说的是如果你愿意的话我们可以先把最关键的那一段跑通然后再慢慢补细节。";
    const out = [];
    for (const ch of text) {
      out.push(...chunker.push(ch));
    }

    assert.deepEqual(out, [text]);
    assert.equal(chunker.flush(), "");
  });

  it("accepts non-12/14/16 eager thresholds from env", () => {
    withEnv(
      {
        TTS_EAGER_THRESHOLD: "28",
        TTS_EAGER_LOOKAHEAD_CHARS: "6",
        TTS_EAGER_SOFT_BREAK_MIN_CHARS: "28",
      },
      () => {
        const prefix = "如果这件事情你现在还想继续往前推一点点再多观察一下的话，";
        assert(prefix.length >= 28);
        const chunker = new SentenceChunker({
          eagerMinTtsChars: 1,
          minTtsChars: 1,
        });
        chunker.setEager(true);

        const first = chunker.push(prefix.slice(0, -1));
        assert.deepEqual(first, []);

        const second = chunker.push("，");
        assert.deepEqual(second, [prefix]);
      },
    );
  });

  it("prefers a soft break before max chunk overflow instead of flushing a huge remainder", () => {
    const chunker = new SentenceChunker({
      eagerCharThreshold: 24,
      eagerLookaheadChars: 10,
      eagerSoftBreakMinChars: 24,
      eagerMinTtsChars: 1,
      minTtsChars: 1,
      maxChunkChars: 120,
    });
    chunker.setEager(true);

    const text =
      "呜呜主人……好主人……我这骚逼早就胀得发疼了，屄水不停往下淌把内裤都浸透了呀……求求主人狠狠掰开我骚屄操我，用粗东西把我骚逼撑得满满的……就算把我牵去广场当着来往的人操，我也跪着给主人谢赏呀……我就是主人下贱的公共母狗，求求主人把我玩到出水、玩到瘫软，狠狠羞辱我这个欠操的骚货好不好嗯啊～对了，那条老是反复回来烦你的工作线最近怎么样呀，没又闹得你心痒吧？";

    const firstPush = chunker.pushDetailed(text);

    assert.equal(firstPush.length, 2);
    assert.equal(firstPush[0]?.boundaryType, "soft_break");
    assert.equal(firstPush[0]?.text.endsWith("公共母狗，"), true);
    assert.equal(firstPush[1]?.boundaryType, "hard_end");
    assert.equal(firstPush[1]?.text.startsWith("求求主人把我玩到出水"), true);
    assert.equal(firstPush[1]?.text.includes("那条老是反复回来烦你的工作线"), true);
    assert.equal(chunker.flush(), "");
  });
});
