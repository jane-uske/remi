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
});
