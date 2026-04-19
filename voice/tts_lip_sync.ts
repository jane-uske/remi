import type { TtsLipCue, Viseme } from "../avatar/types";

export type EdgeWordBoundary = {
  offsetMs: number;
  durationMs: number;
  token: string;
  boundaryType: string | null;
  charStart: number | null;
  charEnd: number | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPunctuationToken(token: string, boundaryType: string | null): boolean {
  if ((boundaryType ?? "").toLowerCase() === "punctuation") return true;
  return /^[\s.,!?;:，。！？、；：“”"'‘’（）()…-]+$/u.test(token);
}

function shouldIncludeBoundary(entryType: string | null, boundaryType: string | null): boolean {
  const normalizedEntryType = (entryType ?? "").trim().toLowerCase();
  const normalizedBoundaryType = (boundaryType ?? "").trim().toLowerCase();

  if (normalizedBoundaryType === "sentence" || normalizedEntryType === "sentenceboundary") {
    return false;
  }

  if (normalizedBoundaryType === "word" || normalizedBoundaryType === "punctuation") {
    return true;
  }

  if (normalizedEntryType === "wordboundary") {
    return normalizedBoundaryType !== "sentence";
  }

  return false;
}

function findTokenSpan(
  sourceText: string,
  token: string,
  searchFrom: number,
): { start: number | null; end: number | null; nextSearchFrom: number } {
  if (!sourceText || !token) {
    return { start: null, end: null, nextSearchFrom: searchFrom };
  }

  const index = sourceText.indexOf(token, searchFrom);
  if (index < 0) {
    return { start: null, end: null, nextSearchFrom: searchFrom };
  }

  return {
    start: index,
    end: index + token.length,
    nextSearchFrom: index + token.length,
  };
}

function resolveViseme(token: string, boundaryType: string | null): Viseme {
  if (isPunctuationToken(token, boundaryType)) return "sil";

  const lower = token.toLowerCase();
  if (/(^|[^a-z])(sh|zh)([^a-z]|$)/.test(lower)) return "sh";
  if (/(^|[^a-z])ch([^a-z]|$)/.test(lower)) return "ch";
  if (/(^|[^a-z])th([^a-z]|$)/.test(lower)) return "th";
  if (/[fv]/.test(lower)) return "ff";
  if (/[szx]/.test(lower)) return "ss";
  if (/r/.test(lower)) return "rr";
  if (/[bmp]/.test(lower)) return "pp";
  if (/(oo|ou|uo|wu|wo|[uw])/.test(lower)) return "oo";
  if (/(oh|ong|eng|[oe])/.test(lower)) return "oh";
  if (/(ee|ei|ie|yi|[iy])/.test(lower)) return "ee";

  if (/[哦喔欧额鹅噢]/u.test(token)) return "oh";
  if (/[乌呜屋]/u.test(token)) return "oo";
  if (/[伊衣依一]/u.test(token)) return "ee";
  return "aa";
}

function resolveWeight(token: string, durationMs: number, viseme: Viseme): number {
  if (viseme === "sil") return 0;
  const spokenLength = token.replace(/\s+/g, "").length;
  const base = 0.48 + Math.min(0.24, durationMs / 1000);
  const lengthBoost = Math.min(0.07, spokenLength * 0.035);
  return round2(clamp(base + lengthBoost, 0.45, 0.95));
}

export function parseEdgeAudioMetadataMessage(
  message: string,
  sourceText = "",
): EdgeWordBoundary[] {
  if (!message.includes("Path:audio.metadata")) return [];

  const bodyStart = message.lastIndexOf("\r\n\r\n");
  const body = bodyStart >= 0 ? message.slice(bodyStart + 4).trim() : message.trim();
  if (!body) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }

  const metadata = Array.isArray((payload as { Metadata?: unknown[] }).Metadata)
    ? (payload as { Metadata: unknown[] }).Metadata
    : [];

  let searchFrom = 0;
  const boundaries: EdgeWordBoundary[] = [];
  for (const entry of metadata) {
    const typed = entry as {
      Type?: unknown;
      Data?: {
        Offset?: unknown;
        Duration?: unknown;
        TextOffset?: unknown;
        text?: {
          Text?: unknown;
          Length?: unknown;
          BoundaryType?: unknown;
        };
        BoundaryType?: unknown;
      };
    };
    const token = String(typed?.Data?.text?.Text ?? "").trim();
    if (!token) continue;

    const parsedOffset = Number(typed?.Data?.Offset ?? 0);
    const parsedDuration = Number(typed?.Data?.Duration ?? 0);
    const entryTypeRaw = typed?.Type ?? null;
    const boundaryTypeRaw =
      typed?.Data?.text?.BoundaryType ?? typed?.Data?.BoundaryType ?? typed?.Type ?? null;
    const entryType = entryTypeRaw == null ? null : String(entryTypeRaw);
    const boundaryType = boundaryTypeRaw == null ? null : String(boundaryTypeRaw);
    if (!shouldIncludeBoundary(entryType, boundaryType)) continue;
    const directCharStart = Number(typed?.Data?.TextOffset);
    const directLength = Number(typed?.Data?.text?.Length ?? token.length);

    let charStart: number | null = Number.isFinite(directCharStart)
      ? directCharStart
      : null;
    let charEnd: number | null =
      charStart != null && Number.isFinite(directLength) ? charStart + directLength : null;

    if (charStart == null || charEnd == null) {
      const found = findTokenSpan(sourceText, token, searchFrom);
      charStart = found.start;
      charEnd = found.end;
      searchFrom = found.nextSearchFrom;
    } else {
      searchFrom = charEnd;
    }

    boundaries.push({
      offsetMs: Math.max(0, Math.round(parsedOffset / 10_000)),
      durationMs: Math.max(0, Math.round(parsedDuration / 10_000)),
      token,
      boundaryType,
      charStart,
      charEnd,
    });
  }

  return boundaries;
}

export function deriveCanonicalLipCuesFromWordBoundaries(
  boundaries: EdgeWordBoundary[],
): TtsLipCue[] {
  return boundaries
    .map((boundary) => {
      const durationMs = Math.max(60, boundary.durationMs || 0);
      const viseme = resolveViseme(boundary.token, boundary.boundaryType);
      const cue: TtsLipCue = {
        offsetMs: Math.max(0, boundary.offsetMs),
        durationMs,
        viseme,
        weight: resolveWeight(boundary.token, durationMs, viseme),
      };
      if (boundary.charStart != null) cue.charStart = boundary.charStart;
      if (boundary.charEnd != null) cue.charEnd = boundary.charEnd;
      if (boundary.token) cue.token = boundary.token;
      return cue;
    })
    .sort((a, b) => a.offsetMs - b.offsetMs);
}
