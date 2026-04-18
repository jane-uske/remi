import fs from "fs";
import path from "path";

import { getPool } from "./database";

let schemaPromise: Promise<void> | null = null;

function resolveSchemaSqlPath(): string {
  const candidates = [
    path.resolve(__dirname, "schema.sql"),
    path.resolve(__dirname, "../../storage/schema.sql"),
    path.resolve(process.cwd(), "storage/schema.sql"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `storage schema not found; checked: ${candidates.join(", ")}`,
  );
}

function loadSchemaSql(): string {
  return fs.readFileSync(resolveSchemaSqlPath(), "utf8");
}

export async function ensureStorageSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = getPool()
      .query(loadSchemaSql())
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
  }

  await schemaPromise;
}
