import { join, resolve } from "node:path";

// download cache (gitignored): deleting it refetches everything
export const cacheDir = (...parts: string[]) =>
  join(
    process.env.HOMELAB_CACHE ?? resolve(import.meta.dirname, "../../.cache"),
    ...parts,
  );
