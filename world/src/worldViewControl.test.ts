import { describe, expect, it, vi } from "vitest";

import {
  createViewControl,
  VIEW_CONTROL_ACTIVE_CLASS,
} from "./worldViewControl";

describe("worldViewControl", () => {
  it("requests pointer lock when view control is enabled", () => {
    const canvas = createCanvasStub();
    const document = createDocumentStub();
    const onActiveChange = vi.fn();

    const control = createViewControl({
      canvas,
      document,
      onActiveChange,
    });

    control.enable();

    expect(canvas.focus).toHaveBeenCalledOnce();
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    expect(canvas.classList.add).toHaveBeenCalledWith(VIEW_CONTROL_ACTIVE_CLASS);
    expect(control.isActive()).toBe(true);
    expect(onActiveChange).toHaveBeenCalledWith(true);
  });

  it("deactivates when pointer lock is lost", () => {
    const canvas = createCanvasStub();
    const document = createDocumentStub();
    const onActiveChange = vi.fn();
    const onDeactivate = vi.fn();

    const control = createViewControl({
      canvas,
      document,
      onActiveChange,
      onDeactivate,
    });

    control.enable();
    document.setPointerLockElement(canvas);
    document.emit("pointerlockchange");
    document.setPointerLockElement(null);
    document.emit("pointerlockchange");

    expect(control.isActive()).toBe(false);
    expect(canvas.classList.remove).toHaveBeenCalledWith(VIEW_CONTROL_ACTIVE_CLASS);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
    expect(onDeactivate).toHaveBeenCalledOnce();
  });

  it("exits pointer lock when view control is disabled explicitly", () => {
    const canvas = createCanvasStub();
    const document = createDocumentStub();
    const control = createViewControl({
      canvas,
      document,
    });

    control.enable();
    document.setPointerLockElement(canvas);
    control.disable();

    expect(document.exitPointerLock).toHaveBeenCalledOnce();
    expect(control.isActive()).toBe(false);
  });
});

function createCanvasStub() {
  return {
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    focus: vi.fn(),
    requestPointerLock: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

function createDocumentStub() {
  const listeners = new Map<string, Array<() => void>>();
  let pointerLockElement: Element | null = null;
  const document = {
    get pointerLockElement() {
      return pointerLockElement;
    },
    exitPointerLock: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    }),
    emit(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
    setPointerLockElement(element: Element | null) {
      pointerLockElement = element;
    },
  };

  return document as unknown as Document & {
    emit: (type: string) => void;
    setPointerLockElement: (element: Element | null) => void;
    exitPointerLock: ReturnType<typeof vi.fn>;
  };
}
