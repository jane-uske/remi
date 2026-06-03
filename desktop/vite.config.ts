import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  publicDir: path.resolve(__dirname, "../web/public"),

  resolve: {
    alias: {
      // Redirect Clerk-dependent auth provider to desktop stub
      "@/components/RemiAuthProvider": path.resolve(
        __dirname,
        "src/shared/DesktopAuthProvider.tsx",
      ),
      "@": path.resolve(__dirname, "../web/src"),
    },
  },

  define: {
    "process.env.NEXT_PUBLIC_WS_URL": JSON.stringify(
      process.env.VITE_WS_URL ?? "",
    ),
    "process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL": JSON.stringify(
      process.env.VITE_LIVE2D_MODEL_URL ?? "",
    ),
    "process.env.NEXT_PUBLIC_LIVE2D_MODEL_ID": JSON.stringify(
      process.env.VITE_LIVE2D_MODEL_ID ?? "",
    ),
    "process.env.NEXT_PUBLIC_LIVE2D_CUBISM_CORE_URL": JSON.stringify(
      process.env.VITE_LIVE2D_CUBISM_CORE_URL ?? "",
    ),
    "process.env.NEXT_PUBLIC_VRM_URL": JSON.stringify(
      process.env.VITE_VRM_URL ?? "",
    ),
    "process.env.NEXT_PUBLIC_REMI_AUTH_MODE": JSON.stringify("disabled"),
    "process.env.NEXT_PUBLIC_REM_DEVTOOLS": JSON.stringify("0"),
    "process.env.NEXT_PUBLIC_REMI_CLIENT_MIC_PRE_GATE": JSON.stringify("0"),
    "process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY": JSON.stringify(""),
    "process.env.NEXT_PUBLIC_VRM_YAW": JSON.stringify(""),
    "process.env.NEXT_PUBLIC_VRM_FRAMING": JSON.stringify(""),
    "process.env.NEXT_PUBLIC_VRM_DISABLE_NODE_CONSTRAINT": JSON.stringify(""),
  },

  build: {
    rollupOptions: {
      input: {
        character: path.resolve(__dirname, "index.html"),
        chat: path.resolve(__dirname, "chat.html"),
      },
    },
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
  },

  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
});
