import { useEffect, useRef } from 'react';
import { controller } from '../controller';
import { useAppState } from '../state/store';

const AR_CSS: Record<string, string> = { '16:9': '16 / 9', '1:1': '1 / 1', '9:16': '9 / 16' };

export function Stage() {
  const s = useAppState();
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    controller.boot(holder);
    return () => controller.shutdown(holder);
  }, []);

  return (
    <div className="stage">
      <div className="canvas-holder" style={{ aspectRatio: AR_CSS[s.aspect] }} ref={holderRef}>
        {!s.booted && !s.webglError && (
          <div className="stage-overlay">
            <span className="spinner spinner-lg" />
            <span>Preparing the studio…</span>
          </div>
        )}
        {s.webglError && (
          <div className="stage-overlay stage-overlay--error">
            <strong>Graphics unavailable</strong>
            <p>{s.webglError}</p>
          </div>
        )}
        {s.booted && !s.webglError && s.needsGesture && (
          <button className="play-overlay" onClick={() => void controller.unlockAndPlay()}>
            <span className="play-overlay-btn" aria-hidden>
              <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor">
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
            <span className="play-overlay-title">Play the demo</span>
            <span className="play-overlay-sub">Built-in track &amp; artwork — or drop in your own</span>
          </button>
        )}
        {s.exportStatus !== 'idle' && (
          <div className="rec-badge">
            <span className="rec-dot" /> REC
          </div>
        )}
      </div>
    </div>
  );
}
