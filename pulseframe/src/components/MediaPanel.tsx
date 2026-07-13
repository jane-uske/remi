import { useRef } from 'react';
import { controller } from '../controller';
import { useAppState } from '../state/store';

function fmtDuration(sec: number): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MediaPanel() {
  const s = useAppState();
  const imageInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const locked = s.exportStatus !== 'idle';

  return (
    <section className="panel">
      <h2 className="panel-title">Source Media</h2>

      <button
        className="media-card"
        onClick={() => imageInput.current?.click()}
        disabled={locked || s.loadingImage}
        data-loading={s.loadingImage || undefined}
        title="Replace the cover image"
      >
        <span className="media-thumb">
          {s.imageThumb ? <img src={s.imageThumb} alt="" /> : <span className="media-thumb-ph">IMG</span>}
        </span>
        <span className="media-meta">
          <span className="media-kind">Image</span>
          <span className="media-name">{s.imageName}</span>
          <span className="media-sub">{s.imageDims}</span>
        </span>
        <span className="media-action">{s.loadingImage ? <span className="spinner" /> : 'Replace'}</span>
      </button>
      <input
        ref={imageInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void controller.loadImageFile(f);
          e.target.value = '';
        }}
      />

      <button
        className="media-card"
        onClick={() => audioInput.current?.click()}
        disabled={locked || s.loadingAudio}
        data-loading={s.loadingAudio || undefined}
        title="Replace the audio track"
      >
        <span className="media-thumb media-thumb--audio">
          <span className="eq" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
        </span>
        <span className="media-meta">
          <span className="media-kind">Audio</span>
          <span className="media-name">{s.audioName}</span>
          <span className="media-sub">{s.audioDuration ? fmtDuration(s.audioDuration) : 'preparing…'}</span>
        </span>
        <span className="media-action">{s.loadingAudio ? <span className="spinner" /> : 'Replace'}</span>
      </button>
      <input
        ref={audioInput}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.opus"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void controller.loadAudioFile(f);
          e.target.value = '';
        }}
      />

      <p className="panel-hint">Drag &amp; drop files anywhere in the window. Everything stays in your browser.</p>
    </section>
  );
}
