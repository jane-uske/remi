import { controller } from '../controller';
import { useAppState } from '../state/store';
import { AspectId, SCENE_LABELS, SceneId } from '../types';

const SCENES: SceneId[] = ['rift', 'chrome', 'particles'];
const ASPECTS: AspectId[] = ['16:9', '1:1', '9:16'];

export function TopBar() {
  const s = useAppState();
  const exporting = s.exportStatus !== 'idle';
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ◆
        </span>
        <span className="brand-name">
          PulseFrame
          <em>Music Cover Studio</em>
        </span>
      </div>

      <nav className="scene-tabs" aria-label="Scene">
        {SCENES.map((id) => (
          <button
            key={id}
            className={`scene-tab${s.scene === id ? ' is-active' : ''}`}
            onClick={() => controller.setScene(id)}
            disabled={!!s.webglError}
          >
            {SCENE_LABELS[id]}
          </button>
        ))}
      </nav>

      <div className="aspect-switch" role="group" aria-label="Canvas ratio">
        {ASPECTS.map((a) => (
          <button
            key={a}
            className={`aspect-btn${s.aspect === a ? ' is-active' : ''}`}
            onClick={() => controller.setAspect(a)}
            disabled={exporting || !!s.webglError}
            title={exporting ? 'Locked while exporting' : `Switch canvas to ${a}`}
          >
            <span className={`aspect-glyph ar-${a.replace(':', '-')}`} aria-hidden />
            {a}
          </button>
        ))}
      </div>
    </header>
  );
}
