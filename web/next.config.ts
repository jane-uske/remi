import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "path";

/**
 * `npm run dev:web:standalone` 的 cwd 实际落在 `web/`，Next 默认只加载 `web/.env*`。
 * 单体仓库里常见把 `NEXT_PUBLIC_*` 写在仓库根 `.env`，导致不生效 —— 这里补读上一级。
 */
loadEnvConfig(path.join(__dirname, ".."));

const nextConfig: NextConfig = {
  turbopack: {
    /** Use `web/` as root when multiple lockfiles exist in the monorepo. */
    root: path.join(__dirname),
  },
};

export default nextConfig;
