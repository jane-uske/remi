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
        const closeIdx = this.buffer.indexOf(TAG_CLOSE);
        if (closeIdx >= 0) {
          this.tagContent += this.buffer.slice(0, closeIdx);
          this.buffer = this.buffer.slice(closeIdx + TAG_CLOSE.length);
          this.tagStarted = false;
          const candidate = this.tagContent.trim().toLowerCase();
          if (isValidEmotion(candidate)) {
            this.detectedEmotion = candidate;
          }
          this.tagContent = "";
        } else {
          // Tag close not yet in buffer — might be split across chunks
          // Keep buffering, but if buffer is too long it's probably not a real tag
          if (this.buffer.length > 50) {
            // False positive — flush as regular text
            cleanText += TAG_OPEN + this.tagContent + this.buffer;
            this.buffer = "";
            this.tagContent = "";
            this.tagStarted = false;
          } else {
            this.tagContent += this.buffer;
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
