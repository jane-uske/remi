"use client";

import { useEffect, useRef } from "react";
import { AuroraField } from "@/lib/aurora/auroraField";

interface AuroraBackgroundProps {
  /** Emotion tint as a hex color, e.g. "#a855f7". Animates smoothly on change. */
  tint?: string;
  className?: string;
}

/**
 * Full-viewport, mouse-reactive aurora rendered on a fixed WebGL canvas.
 * Sits behind page content (z-0). Falls back to a static CSS gradient if
 * WebGL is unavailable. Pauses automatically when the tab is hidden
 * (requestAnimationFrame is throttled by the browser).
 */
export function AuroraBackground({ tint = "#a855f7", className }: AuroraBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<AuroraField | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let field: AuroraField | null = null;
    try {
      field = new AuroraField(canvas);
      field.setTint(tint);
      field.start();
      fieldRef.current = field;
    } catch (err) {
      // WebGL unavailable — the CSS gradient fallback on the canvas stays visible.
      console.warn("[AuroraBackground] WebGL init failed, using static fallback.", err);
    }
    return () => {
      field?.dispose();
      fieldRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fieldRef.current?.setTint(tint);
  }, [tint]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        display: "block",
        width: "100%",
        height: "100%",
        // Explicit backgroundColor for iOS Safari 26+ Liquid Glass tinting —
        // Safari samples background-color from fixed elements; without this
        // the toolbar falls back to white/black instead of our page color.
        backgroundColor: "var(--remi-body-bg)",
        // static fallback if WebGL never initializes
        backgroundImage:
          "radial-gradient(120% 100% at 50% 120%, #0d2b33 0%, #050a10 60%)",
      }}
    />
  );
}
