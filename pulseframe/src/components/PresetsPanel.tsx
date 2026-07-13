import { useState } from 'react';
import { controller } from '../controller';
import { useAppState } from '../state/store';
import { SCENE_LABELS } from '../types';

export function PresetsPanel() {
  const s = useAppState();
  const [name, setName] = useState('');

  const save = () => {
    controller.savePreset(name || `Preset ${s.presets.length + 1}`);
    setName('');
  };

  return (
    <section className="panel">
      <h2 className="panel-title">Presets</h2>
      <div className="preset-save">
        <input
          className="text-input"
          type="text"
          placeholder="Preset name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
        <button className="btn btn-small" onClick={save} disabled={!!s.webglError}>
          Save
        </button>
      </div>

      {s.presets.length === 0 ? (
        <div className="preset-empty">No presets yet — dial in a look and save it. Presets live in this browser.</div>
      ) : (
        <ul className="preset-list">
          {s.presets.map((p) => (
            <li key={p.id} className="preset-item">
              <button className="preset-load" onClick={() => controller.applyPreset(p.id)} title="Apply this preset">
                <span className="preset-name">{p.name}</span>
                <span className="preset-scene">{SCENE_LABELS[p.scene]}</span>
              </button>
              <button
                className="preset-delete"
                onClick={() => controller.deletePreset(p.id)}
                title={`Delete “${p.name}”`}
                aria-label={`Delete preset ${p.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
