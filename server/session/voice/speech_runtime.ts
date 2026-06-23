/**
 * SpeechRuntime (SHADOW ONLY) — Phase 1 observability skeleton.
 *
 * Purpose: give the voice runtime a single, named state machine + event stream
 * that mirrors what is already happening, WITHOUT taking over any control flow.
 *
 * Hard guarantees (see docs/voice/FULL_DUPLEX_SPEECH_RUNTIME_PLAN.md):
 *   - It never sends to the client, never mutates ConnectionSession state,
 *     never aborts/triggers anything.
 *   - `observe*` methods never throw — a shadow bug must not break a live call.
 *   - Removing all `observe*` call sites yields byte-identical runtime behavior.
 *
 * It derives a coarse SpeechRuntimeState from observed events and keeps a small
 * ring buffer of recent events for inspection (tests / future telemetry).
 *
 * States `thinking_while_listening` and `repairing` are part of the designed
 * surface but are intentionally NOT reached in Phase 1 (no wiring yet).
 */
import type {
  RemiTurnState,
  RemiTurnStateReason,
} from "../../../avatar/types";
import { createLogger } from "../../../infra/logger";

const logger = createLogger("speech_runtime");

export type SpeechRuntimeState =
  | "idle"
  | "listening"
  | "user_speaking"
  | "thinking_while_listening"
  | "responding"
  | "speaking"
  | "interrupted"
  | "repairing";

export type SpeechEventType =
  | "audio.frame"
  | "vad.speech_start"
  | "vad.speech_end"
  | "transcript.partial"
  | "transcript.final"
  | "turn.maybe_complete"
  | "turn.complete"
  | "response.token"
  | "tts.chunk_start"
  | "tts.chunk_end"
  | "user.barge_in"
  | "tts.stop"
  | "repair.requested";

export interface SpeechEvent {
  type: SpeechEventType;
  atMs: number;
  state: SpeechRuntimeState;
  data?: Record<string, unknown>;
}

export interface SpeechRuntimeSnapshot {
  mode: "shadow";
  state: SpeechRuntimeState;
  stateSince: number;
  duplexActive: boolean;
  eventCount: number;
  lastBargeInLatencyMs: number | null;
  recentEvents: SpeechEvent[];
}

const MAX_EVENTS = 64;

export class SpeechRuntime {
  readonly mode = "shadow" as const;

  private state: SpeechRuntimeState = "idle";
  private stateSince = Date.now();
  private duplexActive = false;
  private eventCount = 0;
  private lastBargeInLatencyMs: number | null = null;
  private readonly events: SpeechEvent[] = [];
  private readonly verbose: boolean;

  constructor(private readonly connId: string) {
    this.verbose = process.env.REMI_SPEECH_RUNTIME_SHADOW_LOG === "1";
  }

  getState(): SpeechRuntimeState {
    return this.state;
  }

  getEvents(): SpeechEvent[] {
    return [...this.events];
  }

  getLastBargeInLatencyMs(): number | null {
    return this.lastBargeInLatencyMs;
  }

  snapshot(): SpeechRuntimeSnapshot {
    return {
      mode: this.mode,
      state: this.state,
      stateSince: this.stateSince,
      duplexActive: this.duplexActive,
      eventCount: this.eventCount,
      lastBargeInLatencyMs: this.lastBargeInLatencyMs,
      recentEvents: [...this.events],
    };
  }

  /** Duplex session opened. */
  observeDuplexStart(): void {
    this.safe(() => {
      this.duplexActive = true;
      this.transition("listening", { type: "audio.frame", reason: "duplex_start" });
    });
  }

  /** Duplex session closed. */
  observeDuplexStop(): void {
    this.safe(() => {
      this.duplexActive = false;
      this.transition("idle", { type: "tts.stop", reason: "duplex_stop" });
    });
  }

  observeEvent(type: SpeechEventType, data?: Record<string, unknown>): void {
    this.safe(() => {
      switch (type) {
        case "vad.speech_start":
          this.transition("user_speaking", { type, ...data });
          break;
        case "vad.speech_end":
          this.record(type, data);
          break;
        case "turn.maybe_complete":
          this.record(type, data);
          break;
        case "turn.complete":
          this.record(type, data);
          break;
        case "user.barge_in":
          if (typeof data?.bargeInLatencyMs === "number") {
            this.lastBargeInLatencyMs = data.bargeInLatencyMs;
          }
          this.transition("interrupted", { type, ...data });
          break;
        case "tts.stop":
          this.transition(this.duplexActive ? "listening" : "idle", { type, ...data });
          break;
        default:
          this.record(type, data);
          break;
      }
    });
  }

  /**
   * Derive shadow state from the authoritative RemiTurnState transitions that
   * already flow through ConnectionSession.publishTurnState. This is the main
   * non-invasive feed: one tap, all turn-state transitions.
   */
  observeTurnState(
    state: RemiTurnState,
    reason: RemiTurnStateReason,
    data?: Record<string, unknown>,
  ): void {
    this.safe(() => {
      const mapped = mapTurnState(state, this.duplexActive);
      if (!mapped) {
        return;
      }
      const eventType: SpeechEventType =
        state === "assistant_speaking"
          ? "tts.chunk_start"
          : state === "interrupted_by_user"
            ? "user.barge_in"
            : state === "assistant_entering"
              ? "turn.complete"
              : "audio.frame";
      this.transition(mapped, { type: eventType, turnState: state, reason, ...data });
    });
  }

  private transition(
    next: SpeechRuntimeState,
    meta: { type: SpeechEventType } & Record<string, unknown>,
  ): void {
    const { type, ...rest } = meta;
    if (next !== this.state) {
      const prev = this.state;
      this.state = next;
      this.stateSince = Date.now();
      if (this.verbose) {
        logger.debug("[shadow] state", { connId: this.connId, from: prev, to: next, type });
      }
    }
    this.record(type, rest);
  }

  private record(type: SpeechEventType, data?: Record<string, unknown>): void {
    this.eventCount += 1;
    const event: SpeechEvent = {
      type,
      atMs: Date.now(),
      state: this.state,
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      // Shadow must never break the live session.
      logger.debug("[shadow] observe error (ignored)", {
        connId: this.connId,
        error: (err as Error)?.message,
      });
    }
  }
}

function mapTurnState(
  state: RemiTurnState,
  duplexActive: boolean,
): SpeechRuntimeState | null {
  switch (state) {
    case "listening_active":
      return "listening";
    case "assistant_entering":
      return "responding";
    case "assistant_speaking":
      return "speaking";
    case "interrupted_by_user":
      return "interrupted";
    case "confirmed_end":
      return duplexActive ? "listening" : "idle";
    default:
      return null;
  }
}
