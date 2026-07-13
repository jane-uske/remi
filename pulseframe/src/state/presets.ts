import { Preset, SceneId, VisualParams } from '../types';

const KEY = 'pulseframe.presets.v1';

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Preset =>
        p && typeof p.id === 'string' && typeof p.name === 'string' && p.params && typeof p.scene === 'string',
    );
  } catch {
    return [];
  }
}

function persist(presets: Preset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets));
  } catch {
    // storage full / unavailable — presets just won't survive reload
  }
}

export function savePreset(presets: Preset[], name: string, scene: SceneId, params: VisualParams): Preset[] {
  const preset: Preset = {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'Untitled preset',
    scene,
    params: { ...params },
    createdAt: Date.now(),
  };
  const next = [preset, ...presets].slice(0, 24);
  persist(next);
  return next;
}

export function deletePreset(presets: Preset[], id: string): Preset[] {
  const next = presets.filter((p) => p.id !== id);
  persist(next);
  return next;
}
