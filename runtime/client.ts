import {
  createInitialRemiRuntimeState,
  reduceRemiRuntimeEvent,
} from "./client_state";
import type {
  RemiClientContextPayload,
  RemiRuntimeEvent,
  RemiRuntimeState,
  RemiWorldEvent,
} from "./protocol";
import { translateRemiServerMessageToRuntimeEvent } from "./server_message_translator";

export const REMI_WS_CONNECTING = 0;
export const REMI_WS_OPEN = 1;
export const REMI_WS_CLOSED = 3;

export type RemiRuntimeTransportMessage = {
  data: string | ArrayBuffer;
};

export type RemiRuntimeTransport = {
  readyState: number;
  send(data: string | ArrayBuffer): void;
  close(): void;
  onopen?: ((event?: unknown) => void) | null;
  onmessage?: ((event: RemiRuntimeTransportMessage) => void) | null;
  onclose?: ((event?: unknown) => void) | null;
  onerror?: ((event?: unknown) => void) | null;
};

export type RemiRuntimeClientOptions = {
  url: string;
  clientContext?: RemiClientContextPayload | Record<string, unknown> | null;
  createTransport: (url: string) => RemiRuntimeTransport;
  onRawMessage?: (message: Record<string, unknown>) => void;
  onRuntimeEvent?: (event: RemiRuntimeEvent, state: RemiRuntimeState) => void;
};

export class RemiRuntimeClient {
  onopen: (() => void) | null = null;
  onmessage: ((event: RemiRuntimeTransportMessage) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private readonly url: string;
  private readonly clientContext: RemiRuntimeClientOptions["clientContext"];
  private readonly createTransport: RemiRuntimeClientOptions["createTransport"];
  private readonly onRawMessage?: RemiRuntimeClientOptions["onRawMessage"];
  private readonly onRuntimeEvent?: RemiRuntimeClientOptions["onRuntimeEvent"];
  private transport: RemiRuntimeTransport | null = null;
  private state: RemiRuntimeState = createInitialRemiRuntimeState();

  constructor(options: RemiRuntimeClientOptions) {
    this.url = options.url;
    this.clientContext = options.clientContext ?? null;
    this.createTransport = options.createTransport;
    this.onRawMessage = options.onRawMessage;
    this.onRuntimeEvent = options.onRuntimeEvent;
  }

  get readyState(): number {
    return this.transport?.readyState ?? REMI_WS_CLOSED;
  }

  connect(): void {
    const transport = this.createTransport(this.url);
    this.transport = transport;
    this.recordRuntimeEvent({ type: "connection", state: "connecting" });

    transport.onopen = () => {
      this.recordRuntimeEvent({ type: "connection", state: "open" });
      if (this.clientContext) {
        this.sendJson(this.clientContext);
      }
      this.onopen?.();
    };
    transport.onmessage = (event) => {
      this.handleMessage(event);
      this.onmessage?.(event);
    };
    transport.onclose = () => {
      this.recordRuntimeEvent({ type: "connection", state: "closed" });
      this.onclose?.();
    };
    transport.onerror = () => {
      this.onerror?.();
    };
  }

  close(): void {
    this.transport?.close();
  }

  isOpen(): boolean {
    return this.readyState === REMI_WS_OPEN;
  }

  send(data: string | ArrayBuffer): void {
    this.requireOpenTransport().send(data);
  }

  sendJson(payload: Record<string, unknown>): boolean {
    if (!this.isOpen()) return false;
    this.send(JSON.stringify(payload));
    return true;
  }

  sendText(content: string): boolean {
    const text = content.trim();
    if (!text) return false;
    return this.sendJson({ type: "chat", content: text });
  }

  startDuplex(sampleRate: number): boolean {
    return this.sendJson({
      type: "duplex_start",
      sampleRate,
    });
  }

  stopDuplex(): boolean {
    return this.sendJson({ type: "duplex_stop" });
  }

  sendAudioFrame(frame: ArrayBuffer): boolean {
    if (!this.isOpen()) return false;
    this.send(frame);
    return true;
  }

  sendAudioStreamBase64(audio: string, sampleRate: number): boolean {
    return this.sendJson({
      type: "audio_stream",
      audio,
      sampleRate,
    });
  }

  notifyPlaybackStart(generationId: number | null): boolean {
    const payload: Record<string, unknown> = { type: "playback_start" };
    if (typeof generationId === "number") payload.generationId = generationId;
    const sent = this.sendJson(payload);
    if (sent) {
      this.recordRuntimeEvent({
        type: "playback_start",
        ...(typeof generationId === "number" ? { generationId } : {}),
      });
    }
    return sent;
  }

  notifyPlaybackEnd(generationId: number | null): boolean {
    const payload: Record<string, unknown> = { type: "playback_end" };
    if (typeof generationId === "number") payload.generationId = generationId;
    const sent = this.sendJson(payload);
    if (sent) {
      this.recordRuntimeEvent({
        type: "playback_end",
        ...(typeof generationId === "number" ? { generationId } : {}),
      });
    }
    return sent;
  }

  sendWorldEvent(event: RemiWorldEvent): boolean {
    return this.sendJson({
      type: "world_event",
      event,
    });
  }

  getState(): RemiRuntimeState {
    return this.state;
  }

  private requireOpenTransport(): RemiRuntimeTransport {
    if (!this.transport || this.transport.readyState !== REMI_WS_OPEN) {
      throw new Error("Remi runtime transport is not open");
    }
    return this.transport;
  }

  private handleMessage(event: RemiRuntimeTransportMessage): void {
    if (typeof event.data !== "string") return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    this.onRawMessage?.(message);
    const runtimeEvent = translateRemiServerMessageToRuntimeEvent(message);
    if (runtimeEvent) {
      this.recordRuntimeEvent(runtimeEvent);
    }
  }

  private recordRuntimeEvent(event: RemiRuntimeEvent): void {
    this.state = reduceRemiRuntimeEvent(this.state, event);
    this.onRuntimeEvent?.(event, this.state);
  }
}
