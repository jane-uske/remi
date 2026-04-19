export type SafariFocusZoomPatchInput = {
  userAgent: string;
};

const IOS_SAFARI_PHONE_RE = /\b(iPhone|iPod)\b/i;
const SAFARI_RE = /\bSafari\b/i;
const EXCLUDED_IOS_BROWSERS_RE =
  /\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|DuckDuckGo|YaBrowser|GSA)\b/i;

export function shouldApplySafariFocusZoomPatch(
  input: SafariFocusZoomPatchInput,
): boolean {
  const userAgent = input.userAgent ?? "";
  return (
    IOS_SAFARI_PHONE_RE.test(userAgent) &&
    SAFARI_RE.test(userAgent) &&
    !EXCLUDED_IOS_BROWSERS_RE.test(userAgent)
  );
}

export function buildRemiViewportContent(maximumScale: number): string {
  return `width=device-width, initial-scale=1, maximum-scale=${maximumScale}, user-scalable=yes, viewport-fit=cover`;
}

export const defaultRemiViewportContent = buildRemiViewportContent(5);
export const safariFocusViewportContent = buildRemiViewportContent(1);

export function buildSafariFocusZoomPatchScript(): string {
  return `
    (function () {
      try {
        var userAgent = navigator.userAgent || "";
        var isIPhone = /\\b(iPhone|iPod)\\b/i.test(userAgent);
        var isSafari = /\\bSafari\\b/i.test(userAgent);
        var isOtherIOSBrowser = /\\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|DuckDuckGo|YaBrowser|GSA)\\b/i.test(userAgent);
        var isIPhoneSafari = isIPhone && isSafari && !isOtherIOSBrowser;
        if (!isIPhoneSafari) return;
        var root = document.documentElement;
        root.dataset.iosSafari = "true";
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        meta.setAttribute('content', '${safariFocusViewportContent}');
      } catch (_) {}
    })();
  `;
}
