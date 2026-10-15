import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface Entry {
  fetchedAt: number;
  data: unknown;
}

/** JSON response cache: always in memory, optionally persisted to a directory. */
export class ResponseCache {
  private readonly memory = new Map<string, Entry>();

  constructor(
    private readonly dir: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, ttlMs: number): Promise<unknown | undefined> {
    let entry = this.memory.get(key);
    if (!entry && this.dir) {
      try {
        entry = JSON.parse(await readFile(this.path(key), "utf8")) as Entry;
        this.memory.set(key, entry);
      } catch {
        return undefined;
      }
    }
    if (!entry || this.now() - entry.fetchedAt > ttlMs) return undefined;
    return entry.data;
  }

  async set(key: string, data: unknown): Promise<void> {
    const entry: Entry = { fetchedAt: this.now(), data };
    this.memory.set(key, entry);
    if (!this.dir) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.path(key)}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(entry));
      await rename(tmp, this.path(key));
    } catch {
      // A read-only or full disk must not break the tool call; memory cache still works.
    }
  }

  private path(key: string): string {
    return join(this.dir!, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
  }
}

export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.HN_HIRING_MCP_CACHE_DIR === "off") return null;
  if (env.HN_HIRING_MCP_CACHE_DIR) return env.HN_HIRING_MCP_CACHE_DIR;
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "hn-hiring-mcp");
}
