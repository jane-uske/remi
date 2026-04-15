"use client";

import { getRemWsUrl } from "@/lib/wsUrl";
import type { ChatMessage } from "@/types/chat";

function normalizeTranscriptForMerge(text: string): string {
  return text.replace(/\s+/g, "").replace(/[，。！？,.!?、；;:“”"'`~·\-]/g, "");
}

export function uid() {
  return crypto.randomUUID();
}

const AUDIO_FRAME_HEADER_BYTES = 16;
const MESSAGE_STORAGE_KEY = "remi-chat-messages-v1";
const LEGACY_MESSAGE_STORAGE_KEY = "rem-chat-messages-v1";
const STT_FALLBACK_PREFIX = "录音中";

export const MESSAGE_STORAGE_MAX = 200;
export const REM_WS_RECONNECT_DELAY_MS = 3000;
export const DEFAULT_DEV_USER_ID = "00000000-0000-4000-8000-000000000001";

export type BrowserIdentityState = {
  isDefaultDevUser: boolean;
  currentUserId: string;
  wsTargetLabel: string;
};

export const INITIAL_BROWSER_IDENTITY: BrowserIdentityState = {
  isDefaultDevUser: true,
  currentUserId: DEFAULT_DEV_USER_ID,
  wsTargetLabel: "",
};

export function encodePcmAudioFrame(pcm16: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const payload = new Uint8Array(pcm16);
  const frame = new ArrayBuffer(AUDIO_FRAME_HEADER_BYTES + payload.byteLength);
  const out = new Uint8Array(frame);
  const view = new DataView(frame);

  // Magic: "RAUD" (Remi audio), version 1, codec 1=pcm16le mono
  out[0] = 0x52;
  out[1] = 0x41;
  out[2] = 0x55;
  out[3] = 0x44;
  out[4] = 1;
  out[5] = 1;
  out[6] = 0;
  out[7] = 0;
  view.setUint32(8, sampleRate, true);
  view.setUint32(12, payload.byteLength, true);
  out.set(payload, AUDIO_FRAME_HEADER_BYTES);
  return frame;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function measurePcmFrame(buf: ArrayBuffer): { rms: number; peak: number } {
  const view = new DataView(buf);
  const sampleCount = Math.floor(buf.byteLength / 2);
  if (sampleCount <= 0) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = view.getInt16(i * 2, true) / 32768;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
    sum += sample * sample;
  }
  return {
    rms: Math.sqrt(sum / sampleCount),
    peak,
  };
}

export function isListeningFallbackText(text: string): boolean {
  return text.startsWith(STT_FALLBACK_PREFIX);
}

export function mergeTranscriptTexts(prev: string, next: string): string | null {
  const a = prev.trim();
  const b = next.trim();
  if (!a || !b) return null;
  if (a === b) return a;

  const na = normalizeTranscriptForMerge(a);
  const nb = normalizeTranscriptForMerge(b);
  if (!na || !nb) return null;
  if (na === nb) return b.length >= a.length ? b : a;
  if (nb.startsWith(na)) return b;
  if (na.startsWith(nb)) return a;
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveLegacyMessageStorageKey(storageKey: string): string {
  if (!storageKey.startsWith(MESSAGE_STORAGE_KEY)) return LEGACY_MESSAGE_STORAGE_KEY;
  return LEGACY_MESSAGE_STORAGE_KEY + storageKey.slice(MESSAGE_STORAGE_KEY.length);
}

function sanitizePersistedMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatMessage =>
        m != null &&
        typeof m === "object" &&
        typeof (m as ChatMessage).id === "string" &&
        typeof (m as ChatMessage).text === "string" &&
        typeof (m as ChatMessage).role === "string",
    )
    .slice(-MESSAGE_STORAGE_MAX);
}

export function resolveMessageStorageKey(): string {
  if (typeof window === "undefined") return MESSAGE_STORAGE_KEY;
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) return MESSAGE_STORAGE_KEY;
  const payload = decodeJwtPayload(token);
  const userId = typeof payload?.id === "string" ? payload.id.trim() : "";
  if (!userId) return MESSAGE_STORAGE_KEY;
  return `${MESSAGE_STORAGE_KEY}:${userId}`;
}

export function resolveIsDefaultDevUser(): boolean {
  if (typeof window === "undefined") return true;
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  const userId = typeof payload?.id === "string" ? payload.id.trim() : "";
  if (!userId) return true;
  return userId === DEFAULT_DEV_USER_ID;
}

export function resolveCurrentUserId(): string {
  if (typeof window === "undefined") return DEFAULT_DEV_USER_ID;
  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) return DEFAULT_DEV_USER_ID;
  const payload = decodeJwtPayload(token);
  const userId = typeof payload?.id === "string" ? payload.id.trim() : "";
  return userId || DEFAULT_DEV_USER_ID;
}

export function resolveWsTargetLabel(): string {
  if (typeof window === "undefined") return "";
  const wsUrl = getRemWsUrl();
  if (!wsUrl) return "";
  try {
    const url = new URL(wsUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return wsUrl;
  }
}

export function loadPersistedMessages(storageKey: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const primaryRaw = localStorage.getItem(storageKey);
    if (primaryRaw) {
      return sanitizePersistedMessages(JSON.parse(primaryRaw) as unknown);
    }
    const legacyKey = resolveLegacyMessageStorageKey(storageKey);
    const legacyRaw = localStorage.getItem(legacyKey);
    if (!legacyRaw) return [];
    const messages = sanitizePersistedMessages(JSON.parse(legacyRaw) as unknown);
    if (messages.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
    return messages;
  } catch {
    return [];
  }
}
