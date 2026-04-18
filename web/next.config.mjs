import nextEnv from "@next/env";
import { fileURLToPath } from "url";
import path from "path";

/**
 * `npm run dev:web:standalone` runs with cwd at `web/`, so Next would only load
 * `web/.env*` by default. Also load the repo-root env file for shared NEXT_PUBLIC_* vars.
 */
const webDir = path.dirname(fileURLToPath(import.meta.url));
const { loadEnvConfig } = nextEnv;

loadEnvConfig(path.join(webDir, ".."));

/** @type {import("next").NextConfig} */
const nextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  turbopack: {
    root: webDir,
  },
};

export default nextConfig;
