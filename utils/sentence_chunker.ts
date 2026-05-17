import { getConfig } from "../server/config";

export const SENTENCE_END = /[。！？.!?\n]/;
export const SOFT_BREAK_RE = /[，,、；;：:~～…]/;

export type SentenceChunkBoundaryType =
  | "hard_end"
  | "soft_break"
  | "max_chunk"
  | "flush_end";

export interface SentenceChunk {
  text: string;
  boundaryType: SentenceChunkBoundaryType;
}

export interface SentenceChunkerOptions {
  /**
   * Eager mode: start looking for a soft boundary once this many characters
   * are buffered and no hard sentence end has appeared yet.
   */
  eagerCharThreshold?: number;
  /**
   * While eager mode is on, allow a shorter minimum chunk so the first audio
   * can start earlier. Falls back to minTtsChars when not provided.
   */
  eagerMinTtsChars?: number;
  /**
   * After eager is off: if text has no sentence-ending punctuation, force a
   * chunk at this length so TTS does not wait forever.
   */
  maxChunkChars?: number;
  /**
   * Do not send a TTS chunk shorter than this (e.g. "哇！" alone), except at
   * stream end. Short pieces are held and prepended to the next chunk.
   * Set to 0 to disable. Default from env TTS_MIN_CHARS or 16.
   */
  minTtsChars?: number;
  /** In eager mode, allow a small lookahead for a softer boundary after the threshold. */
  eagerLookaheadChars?: number;
  /** In eager mode, only soft-break once the buffered segment is at least this long. */
  eagerSoftBreakMinChars?: number;
}

/**
 * Stateful chunker: feed tokens via push(), get back chunks for TTS.
 * Call flush() after the stream ends to get any remaining text.
 *
 * Splits on sentence-ending punctuation first. In eager mode it may emit the
 * first segment on a nearby soft break, but it never hard-cuts a Han clause
 * purely because a character threshold was reached.
 */
export class SentenceChunker {
  private buffer = "";
  /** Leftover too short to TTS alone; prepended to the next emitted chunk. */
  private hold = "";
  private _eager = false;
  private readonly eagerCharThreshold: number;
  private readonly eagerMinTtsChars: number;
  private readonly maxChunkChars: number;
  private readonly minTtsChars: number;
  private readonly eagerLookaheadChars: number;
  private readonly eagerSoftBreakMinChars: number;

  constructor(opts: SentenceChunkerOptions = {}) {
    const cfg = getConfig();
    const envMin = cfg.TTS_CHUNK_MIN_CHARS ?? NaN;
    const envEagerMin = cfg.TTS_EAGER_MIN_CHARS ?? NaN;
    const envEagerChunk = cfg.TTS_EAGER_CHUNK_CHARS ?? NaN;
    const envEagerThreshold = cfg.TTS_EAGER_THRESHOLD ?? NaN;
    const envMax = cfg.TTS_CHUNK_MAX_CHARS ?? NaN;
    const envTtsMin = cfg.TTS_MIN_CHARS ?? NaN;
    const envEagerLookahead = cfg.TTS_EAGER_LOOKAHEAD_CHARS ?? NaN;
    const envEagerSoftBreakMin = cfg.TTS_EAGER_SOFT_BREAK_MIN_CHARS ?? NaN;

    // 优先使用显式传入的 eagerCharThreshold，否则检查 envEagerChunk，再用默认 24
    const desiredThreshold = opts.eagerCharThreshold ??
      (Number.isFinite(envEagerChunk) && envEagerChunk > 0 ? envEagerChunk : envEagerThreshold);
    this.eagerCharThreshold = parsePositiveInt(desiredThreshold, 24);

    this.maxChunkChars =
      opts.maxChunkChars ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : 120);
    if (opts.minTtsChars !== undefined) {
      this.minTtsChars = opts.minTtsChars;
    } else if (Number.isFinite(envTtsMin) && envTtsMin >= 0) {
      this.minTtsChars = envTtsMin;
    } else {
      this.minTtsChars = 16;
    }
    if (opts.eagerMinTtsChars !== undefined) {
      this.eagerMinTtsChars = opts.eagerMinTtsChars;
    } else if (Number.isFinite(envEagerMin) && envEagerMin >= 0) {
      this.eagerMinTtsChars = envEagerMin;
    } else {
      this.eagerMinTtsChars = 8;
    }
    this.eagerLookaheadChars =
      opts.eagerLookaheadChars ??
      (Number.isFinite(envEagerLookahead) && envEagerLookahead >= 0 ? envEagerLookahead : 10);
    this.eagerSoftBreakMinChars =
      opts.eagerSoftBreakMinChars ??
      (Number.isFinite(envEagerSoftBreakMin) && envEagerSoftBreakMin > 0
        ? envEagerSoftBreakMin
        : 24);
  }

  /**
   * When eager is true, the first chunk may flush at a sufficiently long soft
   * boundary once the eager threshold has been reached. Call setEager(false)
   * after the first chunk for normal
   * sentence-end + maxChunkChars behavior.
   */
  setEager(eager: boolean): void {
    this._eager = eager;
  }

  pushDetailed(token: string): SentenceChunk[] {
    this.buffer += token;
    const sentences: SentenceChunk[] = [];

    while (true) {
      if (this._eager && sentences.length === 0 && this.buffer.length >= this.eagerCharThreshold) {
        const eagerChunk = this.takeEagerChunk();
        if (eagerChunk) {
          sentences.push(eagerChunk);
          continue;
        }
      }

      const hardEndMatch = SENTENCE_END.exec(this.buffer);
      SENTENCE_END.lastIndex = 0;
      if (hardEndMatch) {
        const hardEndIdx = hardEndMatch.index + hardEndMatch[0].length;
        if (hardEndIdx > this.maxChunkChars) {
          const overflowChunk = this.takeOverflowChunk();
          if (overflowChunk) {
            sentences.push(overflowChunk);
            continue;
          }
        }

        const sentence = this.buffer.slice(0, hardEndIdx).trim();
        this.buffer = this.buffer.slice(hardEndIdx);
        if (sentence) {
          sentences.push({
            text: sentence,
            boundaryType: "hard_end",
          });
        }
        continue;
      }

      const overflowChunk = this.takeOverflowChunk();
      if (overflowChunk) {
        sentences.push(overflowChunk);
        continue;
      }

      break;
    }

    return this.applyMinTtsLength(sentences);
  }

  push(token: string): string[] {
    return this.pushDetailed(token).map((chunk) => chunk.text);
  }

  private takeEagerChunk(): SentenceChunk | null {
    if (this.buffer.length < this.eagerCharThreshold) return null;

    const softBreakIdx = this.findSoftBreakAfterThreshold();
    if (softBreakIdx >= 0) {
      const chunk = this.buffer.slice(0, softBreakIdx + 1).trim();
      this.buffer = this.buffer.slice(softBreakIdx + 1);
      return {
        text: chunk,
        boundaryType: "soft_break",
      };
    }

    return null;
  }

  private takeOverflowChunk(): SentenceChunk | null {
    if (this.buffer.length < this.maxChunkChars) return null;
    const softBreakIdx = this.findSoftBreakBefore(this.maxChunkChars);
    const splitIdx = softBreakIdx >= 0 ? softBreakIdx + 1 : this.maxChunkChars;
    const chunk = this.buffer.slice(0, splitIdx).trim();
    this.buffer = this.buffer.slice(splitIdx);
    if (!chunk) return null;
    return {
      text: chunk,
      boundaryType: softBreakIdx >= 0 ? "soft_break" : "max_chunk",
    };
  }

  private findSoftBreakBefore(limit: number): number {
    const searchLimit = Math.min(this.buffer.length, limit);
    const minIndex = Math.max(0, this.minTtsChars - 1);
    let candidate = -1;
    for (let i = minIndex; i < searchLimit; i++) {
      if (SOFT_BREAK_RE.test(this.buffer[i] || "")) {
        candidate = i;
      }
    }
    return candidate;
  }

  private findSoftBreakAfterThreshold(): number {
    const searchLimit = Math.min(
      this.buffer.length,
      this.eagerCharThreshold + this.eagerLookaheadChars,
    );
    const start = Math.max(0, this.eagerSoftBreakMinChars - 1);
    if (searchLimit <= start) return -1;

    let candidate = -1;
    for (let i = start; i < searchLimit; i++) {
      if (SOFT_BREAK_RE.test(this.buffer[i] || "")) {
        candidate = i;
      }
    }
    return candidate;
  }

  /** Merge held text with outgoing chunks; hold fragments shorter than minTtsChars. */
  private applyMinTtsLength(chunks: SentenceChunk[]): SentenceChunk[] {
    const minChars = this._eager ? this.eagerMinTtsChars : this.minTtsChars;
    if (minChars <= 0) return chunks;

    const out: SentenceChunk[] = [];
    for (const c of chunks) {
      if (!c?.text) continue;
      const piece = this.hold + c.text;
      if (piece.length >= minChars) {
        out.push({
          text: piece,
          boundaryType: c.boundaryType,
        });
        this.hold = "";
      } else {
        this.hold = piece;
      }
    }
    return out;
  }

  flushDetailed(): SentenceChunk | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    const merged = (this.hold + rest).trim();
    this.hold = "";
    if (!merged) return null;
    return {
      text: merged,
      boundaryType: "flush_end",
    };
  }

  flush(): string {
    return this.flushDetailed()?.text ?? "";
  }

  /** Discard buffered text (used on interrupt). */
  reset(): void {
    this.buffer = "";
    this.hold = "";
    this._eager = false;
  }
}

/**
 * Async generator: pipe a token stream through and receive complete sentences.
 */
export async function* chunkSentences(
  tokens: AsyncIterable<string>,
): AsyncGenerator<string> {
  const chunker = new SentenceChunker();

  for await (const token of tokens) {
    for (const sentence of chunker.pushDetailed(token)) {
      yield sentence.text;
    }
  }

  const rest = chunker.flushDetailed()?.text ?? "";
  if (rest) yield rest;
}

function parsePositiveInt(raw: number | undefined, fallback: number): number {
  if (!Number.isFinite(raw) || (raw as number) <= 0) return fallback;
  return Math.floor(raw as number);
}
