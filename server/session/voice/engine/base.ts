/**
 * BaseVoiceEngine — shared listener registry + the brain-only event guard.
 *
 * Both engines share:
 *   - a tiny type-keyed listener registry (`on` / `emit`),
 *   - the item-12 guard: brain-only events carrying `origin: "shell"` are dropped,
 *   - hard safety: `emit`/listener dispatch never throws upward.
 *
 * Subclasses implement `observe()` (legacy = no-op, shadow = map + emit + log).
 */
import { createLogger } from "../../../../infra/logger";
import {
  isAllowedEventOrigin,
  type VoiceEngine,
  type VoiceEngineCapabilities,
  type VoiceEngineEvent,
  type VoiceEngineEventListener,
  type VoiceEngineEventType,
  type VoiceEngineId,
  type VoiceEngineObservation,
  type VoiceEngineSnapshot,
} from "./types";
import type { SpeechRuntime } from "../speech_runtime";

const logger = createLogger("voice_engine");

export abstract class BaseVoiceEngine implements VoiceEngine {
  abstract readonly id: VoiceEngineId;
  abstract readonly capabilities: VoiceEngineCapabilities;
  protected abstract readonly mode: "passthrough" | "shadow";

  private readonly listeners = new Map<VoiceEngineEventType, VoiceEngineEventListener[]>();
  protected emittedEventCount = 0;
  protected rejectedEventCount = 0;

  constructor(
    protected readonly connId: string,
    readonly speechRuntime: SpeechRuntime,
  ) {}

  abstract observe(obs: VoiceEngineObservation): void;

  on(type: VoiceEngineEventType, cb: VoiceEngineEventListener): void {
    const list = this.listeners.get(type);
    if (list) list.push(cb);
    else this.listeners.set(type, [cb]);
  }

  snapshot(): VoiceEngineSnapshot {
    return {
      id: this.id,
      mode: this.mode,
      capabilities: this.capabilities,
      emittedEventCount: this.emittedEventCount,
      rejectedEventCount: this.rejectedEventCount,
    };
  }

  /**
   * Emit a unified event to subscribers. Enforces the item-12 origin guard:
   * a brain-only event with `origin: "shell"` is rejected (counted + warned)
   * and never delivered. Listener errors are swallowed (shell must not break
   * the live session).
   */
  protected emit(event: VoiceEngineEvent): boolean {
    if (!isAllowedEventOrigin(event.type, event.origin)) {
      this.rejectedEventCount += 1;
      logger.warn("[VoiceEngine] rejected brain-only event from voice shell", {
        connId: this.connId,
        engine: this.id,
        type: event.type,
        origin: event.origin,
      });
      return false;
    }
    this.emittedEventCount += 1;
    const list = this.listeners.get(event.type);
    if (list) {
      for (const cb of list) {
        try {
          cb(event);
        } catch (err) {
          logger.debug("[VoiceEngine] listener threw (ignored)", {
            connId: this.connId,
            engine: this.id,
            error: (err as Error)?.message,
          });
        }
      }
    }
    return true;
  }

  /** Run a body that must never break the live call. */
  protected safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      logger.debug("[VoiceEngine] observe error (ignored)", {
        connId: this.connId,
        engine: this.id,
        error: (err as Error)?.message,
      });
    }
  }
}
