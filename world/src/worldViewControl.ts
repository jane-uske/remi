export const VIEW_CONTROL_ACTIVE_CLASS = "world-canvas-control-active";

export interface ViewControlOptions {
  canvas: HTMLCanvasElement;
  document: Document;
  onActiveChange?: (active: boolean) => void;
  onDeactivate?: () => void;
}

export interface ViewControl {
  enable: () => void;
  disable: () => void;
  dispose: () => void;
  isActive: () => boolean;
}

export function createViewControl(options: ViewControlOptions): ViewControl {
  let active = false;
  let disposed = false;

  const onPointerLockChange = () => {
    if (options.document.pointerLockElement === options.canvas) {
      setActive(true);
      return;
    }

    if (active) {
      setActive(false);
      options.onDeactivate?.();
    }
  };

  options.document.addEventListener("pointerlockchange", onPointerLockChange);

  return {
    enable() {
      if (disposed) {
        return;
      }

      setActive(true);
      if (options.canvas.tabIndex < 0) {
        options.canvas.tabIndex = 0;
      }
      options.canvas.focus();

      const requestResult = options.canvas.requestPointerLock?.();
      if (isPromiseLike(requestResult)) {
        void requestResult.catch(() => {
          // Pointer lock is best-effort; the scene can still use normal mousemove fallback.
        });
      }
    },
    disable() {
      if (disposed) {
        return;
      }

      const wasActive = active;
      setActive(false);
      if (wasActive) {
        options.onDeactivate?.();
      }
      if (options.document.pointerLockElement === options.canvas) {
        options.document.exitPointerLock?.();
      }
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      options.document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (options.document.pointerLockElement === options.canvas) {
        options.document.exitPointerLock?.();
      }
    },
    isActive() {
      return active;
    },
  };

  function setActive(nextActive: boolean) {
    if (active === nextActive) {
      return;
    }

    active = nextActive;
    if (active) {
      options.canvas.classList.add(VIEW_CONTROL_ACTIVE_CLASS);
    } else {
      options.canvas.classList.remove(VIEW_CONTROL_ACTIVE_CLASS);
    }
    options.onActiveChange?.(active);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    "catch" in value &&
    typeof (value as { catch?: unknown }).catch === "function"
  );
}
