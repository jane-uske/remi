import { dismissToast, useAppState } from '../state/store';

export function Toasts() {
  const s = useAppState();
  if (s.toasts.length === 0) return null;
  return (
    <div className="toasts" role="status">
      {s.toasts.map((t) => (
        <button key={t.id} className={`toast toast--${t.kind}`} onClick={() => dismissToast(t.id)} title="Dismiss">
          {t.text}
        </button>
      ))}
    </div>
  );
}
