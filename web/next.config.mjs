import nextEnv from "@next/env";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

/**
 * `npm run dev:web:standalone` runs with cwd at `web/`, so Next would only load
 * `web/.env*` by default. Also load the repo-root env file for shared NEXT_PUBLIC_* vars.
 */
const webDir = path.dirname(fileURLToPath(import.meta.url));
const { loadEnvConfig } = nextEnv;
const activeEnvFile = process.env.REMI_ACTIVE_ENV_FILE?.trim();

if (activeEnvFile) {
  dotenv.config({
    path: activeEnvFile,
    override: true,
    quiet: true,
  });
}

loadEnvConfig(path.join(webDir, ".."));

/** @type {import("next").NextConfig} */
const nextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : undefined,
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: webDir,
  },
};

export default nextConfig;
