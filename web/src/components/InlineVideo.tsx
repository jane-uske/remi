"use client";

import { useState, useRef } from "react";

/**
 * Inline video player for generated storyboard videos.
 * Aurora Glass style — dark glass container, rounded corners, subtle glow.
 */
export function InlineVideo({
  src,
  poster,
  label,
}: {
  src: string;
  poster?: string;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <>
      {/* Inline thumbnail/player */}
      <div
        className="relative mt-2 mb-1 rounded-2xl overflow-hidden border border-white/10
          bg-black/30 backdrop-blur-sm shadow-lg cursor-pointer max-w-[320px]"
        onClick={() => setExpanded(true)}
      >
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          className="w-full rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        />
        {label && (
          <div className="absolute bottom-0 left-0 right-0 px-3 py-1.5
            bg-gradient-to-t from-black/60 to-transparent text-white/80 text-xs truncate">
            🎬 {label}
          </div>
        )}
      </div>

      {/* Fullscreen lightbox */}
      {expanded && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center
            bg-black/80 backdrop-blur-md"
          onClick={() => setExpanded(false)}
        >
          <video
            src={src}
            poster={poster}
            controls
            autoPlay
            playsInline
            className="max-w-[90vw] max-h-[85vh] rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl
              w-10 h-10 flex items-center justify-center rounded-full bg-white/10
              backdrop-blur-sm border border-white/10"
            onClick={() => setExpanded(false)}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
