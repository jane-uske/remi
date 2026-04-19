const assert = require("assert").strict;

const {
  parseEdgeAudioMetadataMessage,
  deriveCanonicalLipCuesFromWordBoundaries,
} = require("../../voice/tts_lip_sync");

describe("tts lip sync helpers", () => {
  it("parses edge audio metadata messages into word boundaries", () => {
    const message =
      "Path:audio.metadata\r\n\r\n" +
      JSON.stringify({
        Metadata: [
          {
            Type: "WordBoundary",
            Data: {
              Offset: 1_000_000,
              Duration: 2_400_000,
              text: {
                Text: "你好",
                Length: 2,
                BoundaryType: "Word",
              },
            },
          },
          {
            Type: "WordBoundary",
            Data: {
              Offset: 3_800_000,
              Duration: 1_200_000,
              text: {
                Text: "！",
                Length: 1,
                BoundaryType: "Punctuation",
              },
            },
          },
        ],
      });

    const boundaries = parseEdgeAudioMetadataMessage(message, "你好！");
    assert.equal(boundaries.length, 2);
    assert.deepEqual(boundaries[0], {
      offsetMs: 100,
      durationMs: 240,
      token: "你好",
      boundaryType: "Word",
      charStart: 0,
      charEnd: 2,
    });
    assert.deepEqual(boundaries[1], {
      offsetMs: 380,
      durationMs: 120,
      token: "！",
      boundaryType: "Punctuation",
      charStart: 2,
      charEnd: 3,
    });
  });

  it("ignores sentence-level metadata so word cues do not get flattened by full-utterance spans", () => {
    const message =
      "Path:audio.metadata\r\n\r\n" +
      JSON.stringify({
        Metadata: [
          {
            Type: "SentenceBoundary",
            Data: {
              Offset: 1_000_000,
              Duration: 12_000_000,
              text: {
                Text: "你好呀",
                Length: 3,
                BoundaryType: "Sentence",
              },
            },
          },
          {
            Type: "WordBoundary",
            Data: {
              Offset: 1_000_000,
              Duration: 2_400_000,
              text: {
                Text: "你好",
                Length: 2,
                BoundaryType: "Word",
              },
            },
          },
          {
            Type: "WordBoundary",
            Data: {
              Offset: 3_800_000,
              Duration: 1_200_000,
              text: {
                Text: "呀",
                Length: 1,
                BoundaryType: "Word",
              },
            },
          },
        ],
      });

    const boundaries = parseEdgeAudioMetadataMessage(message, "你好呀");
    assert.equal(boundaries.length, 2);
    assert.deepEqual(
      boundaries.map((boundary) => ({
        token: boundary.token,
        boundaryType: boundary.boundaryType,
      })),
      [
        { token: "你好", boundaryType: "Word" },
        { token: "呀", boundaryType: "Word" },
      ],
    );
  });

  it("derives canonical lip cues from word boundaries", () => {
    const cues = deriveCanonicalLipCuesFromWordBoundaries([
      {
        offsetMs: 100,
        durationMs: 220,
        token: "你好",
        boundaryType: "Word",
        charStart: 0,
        charEnd: 2,
      },
      {
        offsetMs: 340,
        durationMs: 100,
        token: "哦",
        boundaryType: "Word",
        charStart: 2,
        charEnd: 3,
      },
      {
        offsetMs: 470,
        durationMs: 80,
        token: "！",
        boundaryType: "Punctuation",
        charStart: 3,
        charEnd: 4,
      },
    ]);

    assert.equal(cues.length, 3);
    assert.deepEqual(cues[0], {
      offsetMs: 100,
      durationMs: 220,
      viseme: "aa",
      weight: 0.77,
      charStart: 0,
      charEnd: 2,
      token: "你好",
    });
    assert.deepEqual(cues[1], {
      offsetMs: 340,
      durationMs: 100,
      viseme: "oh",
      weight: 0.62,
      charStart: 2,
      charEnd: 3,
      token: "哦",
    });
    assert.deepEqual(cues[2], {
      offsetMs: 470,
      durationMs: 80,
      viseme: "sil",
      weight: 0,
      charStart: 3,
      charEnd: 4,
      token: "！",
    });
  });
});
