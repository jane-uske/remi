import { controller } from '../controller';
import { setState, useAppState } from '../state/store';

export function ExportPanel() {
  const s = useAppState();
  const recording = s.exportStatus !== 'idle';
  const canExport = s.booted && !s.webglError && !recording;

  return (
    <section className="panel">
      <h2 className="panel-title">Export</h2>

      <div className="field-row">
        <span className="field-label">Clip length</span>
        <div className="seg" role="group" aria-label="Clip length">
          {([5, 10] as const).map((sec) => (
            <button
              key={sec}
              className={`seg-btn${s.exportSeconds === sec ? ' is-active' : ''}`}
              disabled={recording}
              onClick={() => setState({ exportSeconds: sec })}
            >
              {sec}s
            </button>
          ))}
        </div>
      </div>

      {!recording ? (
        <button className="btn btn-primary btn-block" disabled={!canExport} onClick={() => void controller.startExport()}>
          Export WebM video
        </button>
      ) : (
        <div className="export-progress">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.round(s.exportProgress * 100)}%` }} />
          </div>
          <div className="export-progress-row">
            <span className="export-progress-label">Recording… {Math.round(s.exportProgress * 100)}%</span>
            <button className="btn btn-ghost btn-small" onClick={() => controller.cancelExport()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="panel-hint">Records the live canvas in real time — the clip includes the original audio from the top of the track.</p>

      {s.lastExport ? (
        <div className="export-result">
          <video className="export-preview" src={s.lastExport.url} controls playsInline />
          <div className="export-result-row">
            <span className="export-result-meta">
              {s.lastExport.seconds}s · {(s.lastExport.sizeBytes / (1024 * 1024)).toFixed(1)} MB
            </span>
            <a className="btn btn-small" href={s.lastExport.url} download={`pulseframe-${s.aspect.replace(':', 'x')}-${s.lastExport.seconds}s.webm`}>
              Download
            </a>
          </div>
        </div>
      ) : (
        <div className="export-empty">No exports yet — your last clip will preview here.</div>
      )}
    </section>
  );
}
