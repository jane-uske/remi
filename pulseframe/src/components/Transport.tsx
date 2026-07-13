import { useEffect, useRef, useState } from 'react';
import { controller } from '../controller';
import { useAppState } from '../state/store';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Playback controls. Time/seek/meters update via direct DOM writes from the
 * engine's frame callback — no per-frame React state.
 */
export function Transport() {
  const s = useAppState();
  const [volume, setVolume] = useState(0.9);
  const seeking = useRef(false);
  const seekRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const ledRef = useRef<HTMLSpanElement>(null);
  const lowRef = useRef<HTMLSpanElement>(null);
  const midRef = useRef<HTMLSpanElement>(null);
  const highRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!s.booted || s.webglError) return;
    const engine = controller.engine;
    if (!engine) return;
    const off = engine.onFrame((audio) => {
      if (timeRef.current) timeRef.current.textContent = fmt(controller.getTime());
      if (seekRef.current && !seeking.current) {
        seekRef.current.value = String(controller.getTime());
      }
      if (ledRef.current) ledRef.current.style.opacity = String(0.15 + audio.beat * 0.85);
      if (lowRef.current) lowRef.current.style.transform = `scaleY(${Math.max(0.05, audio.low)})`;
      if (midRef.current) midRef.current.style.transform = `scaleY(${Math.max(0.05, audio.mid)})`;
      if (highRef.current) highRef.current.style.transform = `scaleY(${Math.max(0.05, audio.high)})`;
    });
    return off;
  }, [s.booted, s.webglError]);

  const disabled = !s.booted || !!s.webglError;
  const locked = s.exportStatus !== 'idle';

  return (
    <div className="transport">
      <button
        className={`play-btn${s.playing ? ' is-playing' : ''}`}
        onClick={() => void controller.togglePlay()}
        disabled={disabled || locked}
        title={locked ? 'Locked while exporting' : s.playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={s.playing ? 'Pause' : 'Play'}
      >
        {s.playing ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        )}
      </button>

      <span className="transport-time">
        <span ref={timeRef}>0:00</span>
        <span className="transport-time-total"> / {fmt(s.audioDuration)}</span>
      </span>

      <input
        ref={seekRef}
        className="seek"
        type="range"
        min={0}
        max={Math.max(0.1, s.audioDuration)}
        step={0.05}
        defaultValue={0}
        disabled={disabled || locked || !s.audioDuration}
        onPointerDown={() => (seeking.current = true)}
        onPointerUp={(e) => {
          seeking.current = false;
          controller.seek(Number((e.target as HTMLInputElement).value));
        }}
        onChange={() => {
          /* value applied on pointer-up */
        }}
        aria-label="Seek"
      />

      <div className="meters" title="Low / Mid / High energy" aria-hidden>
        <span className="meter">
          <span ref={lowRef} className="meter-fill" />
        </span>
        <span className="meter">
          <span ref={midRef} className="meter-fill meter-fill--mid" />
        </span>
        <span className="meter">
          <span ref={highRef} className="meter-fill meter-fill--high" />
        </span>
      </div>
      <span ref={ledRef} className="beat-led" title="Beat" aria-hidden />

      <div className="volume">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
          <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a3.5 3.5 0 0 0-2-3.15v6.3a3.5 3.5 0 0 0 2-3.15z" />
        </svg>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setVolume(v);
            controller.setVolume(v);
          }}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
