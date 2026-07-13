import { controller } from '../controller';
import { useAppState } from '../state/store';
import { PARAM_DEFS } from '../types';

export function ParamsPanel() {
  const s = useAppState();
  const disabled = !!s.webglError;

  return (
    <section className="panel">
      <div className="panel-title-row">
        <h2 className="panel-title">Parameters</h2>
        <div className="panel-title-actions">
          <button className="btn btn-ghost btn-small" onClick={() => controller.resetParams()} disabled={disabled}>
            Reset
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => controller.randomizeParams()} disabled={disabled}>
            Randomize
          </button>
        </div>
      </div>

      {PARAM_DEFS.map((def) => {
        const value = s.params[def.key];
        return (
          <div className="param" key={def.key}>
            <div className="param-head">
              <label htmlFor={`param-${def.key}`} title={def.hint}>
                {def.label}
              </label>
              <span className="param-value">{Math.round(value * 100)}</span>
            </div>
            <input
              id={`param-${def.key}`}
              type="range"
              min={0}
              max={100}
              value={Math.round(value * 100)}
              disabled={disabled}
              onChange={(e) => controller.setParam(def.key, Number(e.target.value) / 100)}
            />
          </div>
        );
      })}
    </section>
  );
}
