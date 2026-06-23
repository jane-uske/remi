"use client";

import {
  dedupeChatMessagesById,
  mergeChatMessageLists,
} from "@/lib/chat/mergeChatMessages";
import { getRemWsUrl } from "../lib/wsUrl";
import type { ChatMessage } from "../types/chat";
import {
  DEFAULT_DEV_USER_ID,
  LEGACY_MESSAGE_STORAGE_KEY,
  MESSAGE_STORAGE_KEY,
  resolveAuthCapabilities as resolveAuthCapabilitiesBase,
  resolveCurrentUserId as resolveCurrentUserIdBase,
  resolveIsDefaultDevUser as resolveIsDefaultDevUserBase,
  resolveMessageStorageKey as resolveMessageStorageKeyBase,
} from "../lib/browserIdentity";

export { dedupeChatMessagesById, mergeChatMessageLists };

function normalizeTranscriptForMerge(text: string): string {
  return text.replace(/\s+/g, "").replace(/[，。！？,.!?、；;:“”"'`~·\-]/g, "");
}

export function uid() {
  return crypto.randomUUID();
}

const AUDIO_FRAME_HEADER_BYTES = 16;
const STT_FALLBACK_PREFIX = "录音中";

export const MESSAGE_STORAGE_MAX = 200;
export const REM_WS_RECONNECT_DELAY_MS = 1500;
const WS_RECONNECT_MAX_DELAY_MS = 15_000;
const WS_RECONNECT_JITTER_MS = 500;

export function computeReconnectDelay(attempt: number): number {
  const exponential = REM_WS_RECONNECT_DELAY_MS * Math.pow(2, Math.min(attempt, 4));
  const jitter = Math.random() * WS_RECONNECT_JITTER_MS;
  return Math.min(exponential + jitter, WS_RECONNECT_MAX_DELAY_MS);
}
export { DEFAULT_DEV_USER_ID };

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

export const REMI_TTS_ENABLED_STORAGE_KEY = "remi_tts_enabled";

export function readStoredTtsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(REMI_TTS_ENABLED_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeStoredTtsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMI_TTS_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* noop */
  }
}

// ── Voice style persistence ──────────────────────────────────────────

export const REMI_VOICE_STYLE_STORAGE_KEY = "remi_voice_style_preset";
export const REMI_VOICE_SPEED_STORAGE_KEY = "remi_voice_speed";
export const REMI_VOICE_PITCH_STORAGE_KEY = "remi_voice_pitch";

export function readStoredVoiceStyle(): string {
  if (typeof window === "undefined") return "default";
  try {
    return window.localStorage.getItem(REMI_VOICE_STYLE_STORAGE_KEY) || "default";
  } catch {
    return "default";
  }
}

export function writeStoredVoiceStyle(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMI_VOICE_STYLE_STORAGE_KEY, id);
  } catch { /* noop */ }
}

export function readStoredVoiceSpeed(): number {
  if (typeof window === "undefined") return 0;
  try {
    const v = window.localStorage.getItem(REMI_VOICE_SPEED_STORAGE_KEY);
    return v != null ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function writeStoredVoiceSpeed(idx: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMI_VOICE_SPEED_STORAGE_KEY, String(idx));
  } catch { /* noop */ }
}

export function readStoredVoicePitch(): number {
  if (typeof window === "undefined") return 0;
  try {
    const v = window.localStorage.getItem(REMI_VOICE_PITCH_STORAGE_KEY);
    return v != null ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function writeStoredVoicePitch(idx: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REMI_VOICE_PITCH_STORAGE_KEY, String(idx));
  } catch { /* noop */ }
}

export function buildClientContextPayload(): {
  type: "client_context";
  timeZone?: string;
  locale?: string;
  ttsTransport: "pcm_stream_v1";
} {
  const payload: {
    type: "client_context";
    timeZone?: string;
    locale?: string;
    ttsTransport: "pcm_stream_v1";
  } = {
    type: "client_context",
    ttsTransport: "pcm_stream_v1",
  };

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
  if (timeZone) {
    payload.timeZone = timeZone;
  }

  const locale =
    (typeof navigator !== "undefined" ? navigator.languages?.[0] ?? navigator.language : "")
      .trim();
  if (locale) {
    payload.locale = locale;
  }

  return payload;
}

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

export function mergeSttPartialText(prev: string, next: string): string {
  const partial = next.trim();
  if (!partial) return prev;

  if (isListeningFallbackText(partial)) {
    return isListeningFallbackText(prev) ? "" : prev;
  }

  const current = prev.trim();
  if (!current || isListeningFallbackText(current)) {
    return partial;
  }

  const merged = mergeTranscriptTexts(current, partial);
  if (merged) return merged;

  const currentNormalized = normalizeTranscriptForMerge(current);
  const partialNormalized = normalizeTranscriptForMerge(partial);
  if (
    currentNormalized &&
    partialNormalized &&
    currentNormalized.includes(partialNormalized) &&
    partialNormalized.length < currentNormalized.length
  ) {
    return current;
  }

  return partial;
}

export function getQueryTokenFromWindow(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("token");
}

export function resolveLegacyMessageStorageKey(storageKey: string): string {
  if (!storageKey.startsWith(MESSAGE_STORAGE_KEY)) return LEGACY_MESSAGE_STORAGE_KEY;
  return LEGACY_MESSAGE_STORAGE_KEY + storageKey.slice(MESSAGE_STORAGE_KEY.length);
}

function sanitizePersistedMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return dedupeChatMessagesById(
    raw.filter(
      (m): m is ChatMessage =>
        m != null &&
        typeof m === "object" &&
        typeof (m as ChatMessage).id === "string" &&
        typeof (m as ChatMessage).text === "string" &&
        typeof (m as ChatMessage).role === "string",
    ),
  ).slice(-MESSAGE_STORAGE_MAX);
}

export function resolveMessageStorageKey(input?: {
  clerkUserId?: string | null;
  legacyToken?: string | null;
  currentUserId?: string | null;
  isDefaultDevUser?: boolean;
}): string {
  return resolveMessageStorageKeyBase({
    ...input,
    legacyToken: input?.legacyToken ?? getQueryTokenFromWindow(),
  });
}

export function resolveIsDefaultDevUser(input?: {
  clerkUserId?: string | null;
  legacyToken?: string | null;
}): boolean {
  return resolveIsDefaultDevUserBase({
    ...input,
    legacyToken: input?.legacyToken ?? getQueryTokenFromWindow(),
  });
}

export function resolveCurrentUserId(input?: {
  clerkUserId?: string | null;
  legacyToken?: string | null;
}): string {
  return resolveCurrentUserIdBase({
    ...input,
    legacyToken: input?.legacyToken ?? getQueryTokenFromWindow(),
  });
}

export function resolveAuthCapabilities(input?: {
  clerkEnabled?: boolean;
  clerkSignedIn?: boolean;
  legacyToken?: string | null;
}) {
  return resolveAuthCapabilitiesBase({
    ...input,
    legacyToken: input?.legacyToken ?? getQueryTokenFromWindow(),
  });
}

export function resolveWsTargetLabel(wsUrlInput?: string): string {
  if (typeof window === "undefined" && !wsUrlInput) return "";
  const wsUrl = wsUrlInput ?? getRemWsUrl();
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
