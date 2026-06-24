/**
 * Scroll-target abstraction so ChatWindow can drive either its own inner
 * scroller (desktop / NSFW) or the document/window (mobile immersive chat)
 * through one set of operations. See web/src/components/ChatWindow.tsx.
 */
export type ScrollTarget = {
  getScrollTop(): number;
  getScrollHeight(): number;
  getClientHeight(): number;
  scrollToBottom(behavior: ScrollBehavior): void;
  setScrollTop(value: number): void;
  addScrollListener(fn: () => void): () => void;
};

/**
 * Pure distance-to-bottom test, extracted so it can be unit-tested without a
 * DOM. `< threshold` means "close enough to stick to the bottom".
 */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 72,
): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

export function elementScrollTarget(el: HTMLElement): ScrollTarget {
  return {
    getScrollTop: () => el.scrollTop,
    getScrollHeight: () => el.scrollHeight,
    getClientHeight: () => el.clientHeight,
    scrollToBottom: (behavior) => el.scrollTo({ top: el.scrollHeight, behavior }),
    setScrollTop: (value) => {
      el.scrollTop = value;
    },
    addScrollListener: (fn) => {
      el.addEventListener("scroll", fn, { passive: true });
      return () => el.removeEventListener("scroll", fn);
    },
  };
}

/**
 * Document/window scroll target. clientHeight uses the visual viewport height
 * when available so the stick-to-bottom check stays correct while the iOS
 * keyboard is open; scrollHeight stays the layout height for prepend math.
 */
export function documentScrollTarget(): ScrollTarget {
  const doc = () => document.documentElement;
  return {
    getScrollTop: () => window.scrollY,
    getScrollHeight: () => doc().scrollHeight,
    getClientHeight: () => window.visualViewport?.height ?? window.innerHeight,
    scrollToBottom: (behavior) =>
      window.scrollTo({ top: doc().scrollHeight, behavior }),
    setScrollTop: (value) => window.scrollTo({ top: value }),
    addScrollListener: (fn) => {
      window.addEventListener("scroll", fn, { passive: true });
      return () => window.removeEventListener("scroll", fn);
    },
  };
}

export function scrollDocumentToBottom(behavior: ScrollBehavior = "auto"): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
}
