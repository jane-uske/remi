import type {
  RemiServerMessage,
  RemiServerMessageType,
} from "../../avatar/types";

export type ServerMessage = RemiServerMessage;
export type ServerMessageType = RemiServerMessageType;

/**
 * Transport-agnostic message delivery interface.
 * Both WebSocket and SseResponseSink implement this,
 * allowing the pipeline, text-chat, and continuity modules
 * to work over either transport.
 */
export interface MessageSink {
  readonly readyState: number;
  send(data: string): void;
}
