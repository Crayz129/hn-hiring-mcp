import { ResponseCache } from "./cache.ts";
import { HnHiringError } from "./errors.ts";
import { parseHiringThreadTitle, parseJobPost, type JobPost, type RawComment } from "./parse.ts";

export const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";
const USER_AGENT = "hn-hiring-mcp (+https://github.com/Crayz129/hn-hiring-mcp)";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Threads keep getting posts for a few weeks; after that they are effectively frozen. */
const THREAD_FROZEN_AFTER = 45 * DAY;

export interface HiringThread {
  id: number;
  month: string;
  title: string;
  postedAt: string;
  commentCount: number;
}

export interface Thread extends HiringThread {
  posts: JobPost[];
}

interface AlgoliaHit {
  objectID: string;
  title: string;
  created_at: string;
  created_at_i: number;
  num_comments?: number;
}

interface AlgoliaItem extends RawComment {
  type: string;
  title: string | null;
  author: string | null;
  parent_id: number | null;
  story_id: number | null;
  children?: AlgoliaItem[];
}

export interface HnClientOptions {
  fetch?: typeof fetch;
  cache?: ResponseCache;
  /** Minimum delay between two network requests. */
  minIntervalMs?: number;
  /** Pause before the single retry after a 429/5xx or network error. */
  retryDelayMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

export class HnClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cache: ResponseCache;
  private readonly minIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: HnClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.cache = options.cache ?? new ResponseCache(null);
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.retryDelayMs = options.retryDelayMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.now = options.now ?? Date.now;
  }

  /** Most recent "Who is hiring?" threads, newest first. */
  async listThreads(limit: number): Promise<HiringThread[]> {
    // whoishiring posts three stories a month; ask for enough to cover `limit` hiring threads.
    const hits = await this.searchStories({ hitsPerPage: String(Math.min(limit * 3 + 3, 200)) }, HOUR);
    return hits.slice(0, limit);
  }

  async findThread(month: string): Promise<HiringThread> {
    const [year, mon] = month.split("-").map(Number) as [number, number];
    const start = Date.UTC(year, mon - 1, 1) / 1000;
    const end = Date.UTC(year, mon, 1) / 1000;
    const hits = await this.searchStories(
      { numericFilters: `created_at_i>=${start},created_at_i<${end}`, hitsPerPage: "10" },
      end * 1000 < this.now() - DAY ? 30 * DAY : HOUR,
    );
    const thread = hits.find((t) => t.month === month);
    if (!thread) {
      throw new HnHiringError("NOT_FOUND", `No "Ask HN: Who is hiring?" thread found for ${month}. Threads exist from 2011-04 up to the current month.`);
    }
    return thread;
  }

  async getThread(id: number): Promise<Thread> {
    const url = `${ALGOLIA_BASE}/items/${id}`;
    let item = (await this.cache.get(url, Infinity)) as AlgoliaItem | undefined;
    const isFrozen = (i: AlgoliaItem) => this.now() - Date.parse(i.created_at) > THREAD_FROZEN_AFTER;
    if (!item || (!isFrozen(item) && !(await this.cache.get(url, HOUR)))) {
      const fetched = await this.fetchJson<AlgoliaItem>(url, `thread ${id}`);
      // Replies to job posts are not job posts; drop them before caching (roughly halves the size).
      item = { ...fetched, children: fetched.children?.map((c) => ({ ...c, children: [] })) };
      await this.cache.set(url, item);
    }
    const month = item.type === "story" && item.author === "whoishiring" ? parseHiringThreadTitle(item.title ?? "") : null;
    if (!month) {
      throw new HnHiringError("NOT_FOUND", `HN item ${id} is not an "Ask HN: Who is hiring?" thread.`);
    }
    const children = item.children ?? [];
    const posts = children.map((c) => parseJobPost(c, item.id, month)).filter((p): p is JobPost => p !== null);
    return {
      id: item.id,
      month,
      title: item.title ?? "",
      postedAt: item.created_at,
      commentCount: children.length,
      posts,
    };
  }

  async getPost(id: number): Promise<JobPost> {
    const url = `${ALGOLIA_BASE}/items/${id}`;
    let item = (await this.cache.get(url, DAY)) as AlgoliaItem | undefined;
    if (!item) {
      item = await this.fetchJson<AlgoliaItem>(url, `item ${id}`);
      // Only cache the lightweight metadata; the post itself comes from the thread.
      await this.cache.set(url, { ...item, children: [] });
    }
    if (item.type !== "comment" || item.parent_id === null || item.parent_id !== item.story_id) {
      throw new HnHiringError("NOT_FOUND", `HN item ${id} is not a top-level job post in a "Who is hiring?" thread.`);
    }
    const thread = await this.getThread(item.story_id);
    const post = thread.posts.find((p) => p.id === id);
    if (!post) throw new HnHiringError("NOT_FOUND", `Job post ${id} was deleted or is empty.`);
    return post;
  }

  private async searchStories(params: Record<string, string>, ttlMs: number): Promise<HiringThread[]> {
    const query = new URLSearchParams({ tags: "story,author_whoishiring", ...params });
    const url = `${ALGOLIA_BASE}/search_by_date?${query}`;
    let body = (await this.cache.get(url, ttlMs)) as { hits: AlgoliaHit[] } | undefined;
    if (!body) {
      body = await this.fetchJson<{ hits: AlgoliaHit[] }>(url, "thread list");
      body = { hits: body.hits.map(({ objectID, title, created_at, created_at_i, num_comments }) => ({ objectID, title, created_at, created_at_i, num_comments })) };
      await this.cache.set(url, body);
    }
    return body.hits.flatMap((hit) => {
      const month = parseHiringThreadTitle(hit.title);
      return month
        ? [{ id: Number(hit.objectID), month, title: hit.title, postedAt: hit.created_at, commentCount: hit.num_comments ?? 0 }]
        : [];
    });
  }

  /** Serialised, rate-limited GET with one retry on 429/5xx. */
  private fetchJson<T>(url: string, what: string): Promise<T> {
    const run = async (): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        this.lastRequestAt = Date.now();
        let res: Response;
        try {
          res = await this.fetchImpl(url, {
            headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch (err) {
          if (attempt === 0) {
            await sleep(this.retryDelayMs);
            continue;
          }
          throw new HnHiringError("UPSTREAM_ERROR", `Could not reach the HN API while loading ${what}: ${(err as Error).message}`);
        }
        if (res.status === 404) throw new HnHiringError("NOT_FOUND", `HN has no ${what}.`);
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await sleep(this.retryDelayMs);
          continue;
        }
        if (!res.ok) throw new HnHiringError("UPSTREAM_ERROR", `HN API answered ${res.status} while loading ${what}. Try again later.`);
        return (await res.json()) as T;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
