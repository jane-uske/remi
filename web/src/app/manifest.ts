import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Remi AI",
    short_name: "Remi",
    description: "实时 AI 陪伴 — 对话、记忆与情绪",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0f0a18",
    theme_color: "#0f0a18",
    lang: "zh-CN",
    icons: [
      {
        src: "/assets/remi/brand/remi-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/assets/remi/brand/remi-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}