import { useEffect } from 'react';
import { controller } from './controller';
import { setState, useAppState } from './state/store';
import { TopBar } from './components/TopBar';
import { MediaPanel } from './components/MediaPanel';
import { ExportPanel } from './components/ExportPanel';
import { Stage } from './components/Stage';
import { Transport } from './components/Transport';
import { ParamsPanel } from './components/ParamsPanel';
import { PresetsPanel } from './components/PresetsPanel';
import { Toasts } from './components/Toasts';

export default function App() {
  const s = useAppState();

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setState({ dragOver: true });
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setState({ dragOver: false });
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setState({ dragOver: false });
      if (e.dataTransfer?.files.length) void controller.handleFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) return;
      e.preventDefault();
      void controller.togglePlay();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="layout">
        <aside className="side">
          <MediaPanel />
          <ExportPanel />
        </aside>
        <main className="stage-col">
          <Stage />
          <Transport />
        </main>
        <aside className="side">
          <ParamsPanel />
          <PresetsPanel />
        </aside>
      </div>
      {s.dragOver && (
        <div className="drop-overlay">
          <div className="drop-inner">
            <div className="drop-icon">⬇</div>
            <div>Drop an image or audio file to load it</div>
            <div className="drop-sub">JPG · PNG · WebP · MP3 · WAV · OGG · M4A · FLAC</div>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
