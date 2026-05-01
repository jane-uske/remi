import {
  RemiRuntimeClient,
  selectRemiAvatarRuntimeModel,
  toClientContextPayload,
  type RemiClientContextPayload,
  type RemiAvatarRuntimeModel,
  type RemiRuntimeEvent,
  type RemiRuntimeState,
  type RemiRuntimeTransport,
  type RemiWorldEvent,
  type RemiWorldEventType,
} from "./worldRuntime";
import {
  describeWorldEventForRemi,
  type WorldEvent,
} from "./worldEvents";

export interface RemiWorldBridgeOptions {
  url: string;
  createTransport: (url: string) => RemiRuntimeTransport;
  timeZone?: string;
  locale?: string;
  sendWorldEvents?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  onRuntimeEvent?: (event: RemiRuntimeEvent, state: RemiRuntimeState) => void;
  onStateChange?: (state: RemiRuntimeState) => void;
}

export interface RemiWorldBridgeReport {
  event: RemiWorldEvent;
  sent: boolean;
}

export interface RemiWorldBridge {
  connect(): void;
  close(): void;
  isOpen(): boolean;
  getState(): RemiRuntimeState;
  getAvatarRuntimeModel(): RemiAvatarRuntimeModel;
  getClientContext(): RemiClientContextPayload;
  sendText(content: string): boolean;
  reportWorldEvent(event: WorldEvent): RemiWorldBridgeReport;
}

export function createRemiWorldBridge(
  options: RemiWorldBridgeOptions,
): RemiWorldBridge {
  const clientContext = toClientContextPayload({
    surface: "world",
    timeZone: options.timeZone,
    locale: options.locale,
    capabilities: {
      textInput: true,
      audioInput: false,
      audioOutput: true,
      streamingAudio: true,
      avatar2d: false,
      avatar3d: true,
      lipSync: true,
      worldEvents: true,
      backgroundPresence: false,
      notifications: false,
    },
  });

  const client = new RemiRuntimeClient({
    url: options.url,
    clientContext,
    createTransport: options.createTransport,
    onRuntimeEvent: (event, state) => {
      options.onRuntimeEvent?.(event, state);
      options.onStateChange?.(state);
    },
  });

  client.onopen = () => options.onOpen?.();
  client.onclose = () => options.onClose?.();
  client.onerror = () => options.onError?.();

  return {
    connect: () => client.connect(),
    close: () => client.close(),
    isOpen: () => client.isOpen(),
    getState: () => client.getState(),
    getAvatarRuntimeModel: () => selectRemiAvatarRuntimeModel(client.getState()),
    getClientContext: () => clientContext,
    sendText: (content) => client.sendText(content),
    reportWorldEvent: (event) => {
      const runtimeEvent = toRemiWorldEvent(event);
      return {
        event: runtimeEvent,
        sent: options.sendWorldEvents === true
          ? client.sendWorldEvent(runtimeEvent)
          : false,
      };
    },
  };
}

export function toRemiWorldEvent(event: WorldEvent): RemiWorldEvent {
  const runtimeEvent: RemiWorldEvent = {
    id: event.id,
    type: toRuntimeWorldEventType(event),
    occurredAt: event.occurredAt,
    surface: "world",
    actorId: event.actorId,
    locationLabel: event.locationLabel,
    emotionalWeightHint: event.emotionalWeight,
    memoryHint: event.memoryCandidate ? "candidate" : "none",
    description: describeWorldEventForRemi(event),
  };

  if (event.objectKind) {
    runtimeEvent.objectKind = event.objectKind;
  }

  return runtimeEvent;
}

function toRuntimeWorldEventType(event: WorldEvent): RemiWorldEventType {
  if (event.type === "player_expanded_land" || event.type === "player_removed_land") {
    return "player_changed_area";
  }

  return event.type;
}
