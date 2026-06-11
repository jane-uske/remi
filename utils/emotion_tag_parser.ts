import { isValidEmotion } from "../emotion/emotion_state";
import type { Emotion } from "../emotion/emotion_state";

export type EmotionTagResult = {
  cleanText: string;
  detectedEmotion: Emotion | null;
};

const TAG_OPEN = "<emotion>";
const TAG_CLOSE = "</emotion>";

/**
 * Streaming parser that detects and strips <emotion>xxx</emotion> tags
 * from LLM output. Handles tags split across multiple chunks.
 */
export class EmotionTagParser {
  private buffer = "";
  private detectedEmotion: Emotion | null = null;
  private tagStarted = false;
  private tagContent = "";

  feed(chunk: string): EmotionTagResult {
    let cleanText = "";
    this.buffer += chunk;

    while (this.buffer.length > 0) {
      if (this.tagStarted) {
        // TAG_CLOSE itself is usually split across streamed tokens ("</" +
        // "emotion" + ">"), so search the accumulated content, not just the
        // freshly arrived chunk.
        const combined = this.tagContent + this.buffer;
        const closeIdx = combined.indexOf(TAG_CLOSE);
        if (closeIdx >= 0) {
          const candidate = combined.slice(0, closeIdx).trim().toLowerCase();
          if (isValidEmotion(candidate)) {
            this.detectedEmotion = candidate;
          }
          this.buffer = combined.slice(closeIdx + TAG_CLOSE.length);
          this.tagStarted = false;
          this.tagContent = "";
        } else {
          // Tag close not seen yet — keep buffering, but a real tag body is
          // short; past 50 chars it's almost certainly a false positive
          if (combined.length > 50) {
            cleanText += TAG_OPEN + combined;
            this.buffer = "";
            this.tagContent = "";
            this.tagStarted = false;
          } else {
            this.tagContent = combined;
            this.buffer = "";
          }
          break;
        }
      } else {
        const openIdx = this.buffer.indexOf(TAG_OPEN);
        if (openIdx >= 0) {
          cleanText += this.buffer.slice(0, openIdx);
          this.buffer = this.buffer.slice(openIdx + TAG_OPEN.length);
          this.tagStarted = true;
          this.tagContent = "";
        } else {
          // Check for partial tag start at end of buffer
          const partialMatch = this.findPartialTagStart(this.buffer);
          if (partialMatch >= 0) {
            cleanText += this.buffer.slice(0, partialMatch);
            this.buffer = this.buffer.slice(partialMatch);
            break;
          } else {
            cleanText += this.buffer;
            this.buffer = "";
          }
        }
      }
    }

    return { cleanText, detectedEmotion: this.detectedEmotion };
  }

  flush(): EmotionTagResult {
    let cleanText = "";
    if (this.tagStarted) {
      // Unclosed tag — treat as regular text
      cleanText = TAG_OPEN + this.tagContent + this.buffer;
    } else {
      cleanText = this.buffer;
    }
    this.buffer = "";
    this.tagContent = "";
    this.tagStarted = false;
    return { cleanText, detectedEmotion: this.detectedEmotion };
  }

  getDetectedEmotion(): Emotion | null {
    return this.detectedEmotion;
  }

  private findPartialTagStart(text: string): number {
    // Check if end of text could be start of "<emotion>"
    for (let i = Math.max(0, text.length - TAG_OPEN.length + 1); i < text.length; i++) {
      const tail = text.slice(i);
      if (TAG_OPEN.startsWith(tail)) {
        return i;
      }
    }
    return -1;
  }
}
