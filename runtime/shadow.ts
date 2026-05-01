import {
  createInitialRemiRuntimeState,
  reduceRemiRuntimeEvent,
} from "./client_state";
import type { RemiRuntimeEvent, RemiRuntimeState } from "./protocol";
import { translateRemiServerMessageToRuntimeEvent } from "./server_message_translator";

export type RemiRuntimeShadowOptions = {
  enabled: boolean;
  onUpdate?: (event: RemiRuntimeEvent, state: RemiRuntimeState) => void;
};

export class RemiRuntimeShadow {
  private readonly enabled: boolean;
  private readonly onUpdate?: (event: RemiRuntimeEvent, state: RemiRuntimeState) => void;
  private state: RemiRuntimeState | null;

  constructor(options: RemiRuntimeShadowOptions) {
    this.enabled = options.enabled;
    this.onUpdate = options.onUpdate;
    this.state = options.enabled ? createInitialRemiRuntimeState() : null;
  }

  recordRuntimeEvent(event: RemiRuntimeEvent): RemiRuntimeState | null {
    if (!this.enabled) return null;
    const current = this.state ?? createInitialRemiRuntimeState();
    const next = reduceRemiRuntimeEvent(current, event);
    this.state = next;
    this.onUpdate?.(event, next);
    return next;
  }

  recordRawMessage(raw: unknown): RemiRuntimeState | null {
    if (!this.enabled) return null;
    const event = translateRemiServerMessageToRuntimeEvent(raw);
    if (!event) return this.state;
    return this.recordRuntimeEvent(event);
  }

  getState(): RemiRuntimeState | null {
    return this.state;
  }
}
