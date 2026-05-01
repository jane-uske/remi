import "./styles.css";

import {
  createRemiWorldBridge,
  type RemiWorldBridge,
} from "./remiWorldBridge";
import { createRemiWorldScene, type RemiWorldScene } from "./worldScene";
import {
  describeWorldEventForRemi,
  type WorldEvent,
} from "./worldEvents";
import type { RemiRuntimeTransport } from "./worldRuntime";
import {
  WORLD_OBJECTS,
  getWorldObjectSelectionHint,
  type WorldObjectKind,
} from "./worldObjects";
import {
  createWorldGoalState,
  getWorldGoalLines,
  updateWorldGoalState,
  type WorldGoalState,
} from "./worldGoals";
import {
  clearLandCellsFromStorage,
  clearPlacedObjectsFromStorage,
  loadLandCellsFromStorage,
  loadPlacedObjectsFromStorage,
  saveLandCellsToStorage,
  savePlacedObjectsToStorage,
} from "./worldPersistence";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root");
}

const heroShotMode = new URLSearchParams(window.location.search).has("heroShot");
app.classList.toggle("hero-shot-mode", heroShotMode);

app.innerHTML = `
  <main class="world-shell">
    <canvas class="world-canvas" id="world-canvas" aria-label="Remi World first-person island"></canvas>
    <section class="top-hud" aria-label="World status">
      <div class="world-title">RemiWorld MVP</div>
      <div class="world-meta">
        <span>Day 12</span>
        <span>18:47</span>
        <span class="sun-icon">☀</span>
      </div>
      <div class="remi-runtime-status" id="remi-runtime-status">Remi: local</div>
      <div class="quest-card" id="quest-card">
      </div>
    </section>
    <div class="crosshair" aria-hidden="true">+</div>
    <section class="toast" id="world-toast" aria-live="polite">
      Click the island view to control camera. Esc exits.
    </section>
    <section class="chat-hint" aria-label="Chat placeholder">
      <span>▣</span>
      <span>Press Enter to chat...</span>
    </section>
    <button class="dev-clear-button" id="dev-clear-button" type="button" aria-label="Clear local island layout" title="Clear local island layout">×</button>
    <section class="hotbar" id="hotbar" aria-label="Build hotbar"></section>
  </main>
`;

const canvas = getRequiredElement<HTMLCanvasElement>("#world-canvas");
const hotbar = getRequiredElement<HTMLElement>("#hotbar");
const toast = getRequiredElement<HTMLElement>("#world-toast");
const clearButton = getRequiredElement<HTMLButtonElement>("#dev-clear-button");
const questCard = getRequiredElement<HTMLElement>("#quest-card");
const remiRuntimeStatus = getRequiredElement<HTMLElement>("#remi-runtime-status");

let selectedObject: WorldObjectKind = WORLD_OBJECTS[0].id;
let sceneApi: RemiWorldScene | null = null;
let goalState: WorldGoalState = createWorldGoalState();
const remiBridge = createOptionalRemiWorldBridge();

for (let index = 0; index < WORLD_OBJECTS.length; index += 1) {
  const object = WORLD_OBJECTS[index];
  const button = document.createElement("button");
  button.className =
    object.id === selectedObject ? "hotbar-slot hotbar-slot-active" : "hotbar-slot";
  button.type = "button";
  button.dataset.object = object.id;
  button.innerHTML = `
    <span class="slot-index">${index + 1}</span>
    <span class="slot-icon slot-icon-${object.id}" aria-hidden="true"></span>
    <span class="slot-count">${object.countLabel}</span>
    <span class="slot-label">${object.hotbarLabel}</span>
  `;
  button.addEventListener("click", () => {
    selectObject(object.id);
  });
  hotbar.append(button);
}

sceneApi = createRemiWorldScene(canvas, {
  initialObject: selectedObject,
  heroShotMode,
  initialLandCells: loadLandCellsFromStorage(window.localStorage),
  initialPlacedObjects: loadPlacedObjectsFromStorage(window.localStorage),
  onHintChange: setToast,
  onLandCellsChange: (records) => {
    saveLandCellsToStorage(window.localStorage, records);
  },
  onPlacedObjectsChange: (records) => {
    savePlacedObjectsToStorage(window.localStorage, records);
  },
  onWorldEvent: recordEvent,
});
renderGoals();

window.addEventListener("keydown", (event) => {
  const hotbarIndex = Number.parseInt(event.key, 10);
  if (hotbarIndex >= 1 && hotbarIndex <= WORLD_OBJECTS.length) {
    selectObject(WORLD_OBJECTS[hotbarIndex - 1].id);
    return;
  }

  if (event.key.toLowerCase() === "r") {
    const removed = sceneApi?.removeTargetObject() ?? null;
    if (removed) {
      recordEvent(removed);
    }
    return;
  }

  if (event.key === "Backspace") {
    const removed = sceneApi?.removeLatestObject() ?? null;
    if (removed) {
      recordEvent(removed);
    }
  }
});

clearButton.addEventListener("click", () => {
  sceneApi?.clearLandCells();
  sceneApi?.clearPlacedObjects();
  clearLandCellsFromStorage(window.localStorage);
  clearPlacedObjectsFromStorage(window.localStorage);
  goalState = createWorldGoalState();
  renderGoals();
  setToast("Local island layout cleared.");
});

window.addEventListener("beforeunload", () => {
  sceneApi?.dispose();
  remiBridge?.close();
});

function selectObject(kind: WorldObjectKind) {
  selectedObject = kind;
  sceneApi?.selectObject(kind);

  for (const child of hotbar.querySelectorAll<HTMLButtonElement>(".hotbar-slot")) {
    child.classList.toggle("hotbar-slot-active", child.dataset.object === kind);
  }

  setToast(getWorldObjectSelectionHint(kind));
}

function recordEvent(event: WorldEvent) {
  goalState = updateWorldGoalState(goalState, event);
  renderGoals();
  remiBridge?.reportWorldEvent(event);
  setToast(describeWorldEventForRemi(event));
}

function renderGoals() {
  const lines = getWorldGoalLines(goalState);
  questCard.replaceChildren(
    createQuestLine("◇", "Shape the shoreline evening"),
    ...lines.map((line) =>
      createQuestLine(line.complete ? "✓" : "•", line.text, line.complete),
    ),
  );
}

function createQuestLine(
  marker: string,
  text: string,
  complete = false,
) {
  const line = document.createElement("div");
  line.className = complete ? "quest-line quest-line-complete" : "quest-line";
  line.textContent = `${marker} ${text}`;
  return line;
}

function setToast(message: string) {
  toast.textContent = message;
}

function createOptionalRemiWorldBridge(): RemiWorldBridge | null {
  const url = getRemiWorldWsUrl();
  if (!url) {
    setRemiRuntimeStatus("Remi: local");
    return null;
  }

  const bridge = createRemiWorldBridge({
    url,
    createTransport: (targetUrl) =>
      new WebSocket(targetUrl) as unknown as RemiRuntimeTransport,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    sendWorldEvents: getEnvFlag("VITE_REMI_WORLD_EVENT_SEND"),
    onOpen: () => setRemiRuntimeStatus("Remi: online"),
    onClose: () => setRemiRuntimeStatus("Remi: offline"),
    onError: () => setRemiRuntimeStatus("Remi: connection error"),
    onStateChange: (state) => {
      const preview = state.assistant.streamingText || state.assistant.finalText;
      if (preview) {
        setRemiRuntimeStatus(`Remi: ${preview.slice(0, 28)}`);
      }
    },
  });

  setRemiRuntimeStatus("Remi: connecting");
  bridge.connect();
  return bridge;
}

function getRemiWorldWsUrl(): string {
  const value = getViteEnv("VITE_REMI_WS_URL");
  return value.trim();
}

function getEnvFlag(name: string): boolean {
  return getViteEnv(name) === "1";
}

function getViteEnv(name: string): string {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  };
  return meta.env?.[name] ?? "";
}

function setRemiRuntimeStatus(message: string) {
  remiRuntimeStatus.textContent = message;
}

function getRequiredElement<TElement extends Element>(
  selector: string,
): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Remi World DOM boot failed: missing ${selector}`);
  }

  return element;
}
