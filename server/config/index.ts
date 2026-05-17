import { validateEnv, type RemiEnv } from "./schema";

let _config: RemiEnv | null = null;

export function resetConfig(): void {
  _config = null;
}

export function getConfig(): RemiEnv {
  if (!_config) _config = validateEnv();
  return _config;
}

export const config: RemiEnv = new Proxy({} as RemiEnv, {
  get(_, key: string) {
    return getConfig()[key as keyof RemiEnv];
  },
});

export type { RemiEnv };
