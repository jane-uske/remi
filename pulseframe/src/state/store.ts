import { useSyncExternalStore } from 'react';
import { AppState, DEFAULT_PARAMS, Toast } from '../types';
import { loadPresets } from './presets';

const initialState: AppState = {
  booted: false,
  webglError: null,
  scene: 'rift',
  aspect: '16:9',
  params: { ...DEFAULT_PARAMS },
  playing: false,
  needsGesture: true,
  imageName: 'Neon Horizon (built-in)',
  imageDims: '1024 × 1024',
  imageThumb: null,
  audioName: 'Midnight Circuit (built-in)',
  audioDuration: 0,
  loadingImage: false,
  loadingAudio: false,
  exportStatus: 'idle',
  exportProgress: 0,
  exportSeconds: 5,
  lastExport: null,
  presets: loadPresets(),
  toasts: [],
  dragOver: false,
};

type Listener = () => void;

let state: AppState = initialState;
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

let toastSeq = 1;
const TOAST_TTL = 5200;

export function pushToast(kind: Toast['kind'], text: string): void {
  const id = toastSeq++;
  setState({ toasts: [...state.toasts, { id, kind, text }] });
  window.setTimeout(() => {
    setState({ toasts: getState().toasts.filter((t) => t.id !== id) });
  }, TOAST_TTL);
}

export function dismissToast(id: number): void {
  setState({ toasts: state.toasts.filter((t) => t.id !== id) });
}
