import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it } from "vitest";
import { ResponseCache } from "../src/cache.ts";
import { HnClient } from "../src/hn-client.ts";
import { createServer } from "../src/server.ts";
import { fixtureFetch, threadIds, threads, type FixtureFetch } from "./fixture-fetch.ts";

const [latestId, previousId] = threadIds as [number, number];
const latest = threads.get(latestId);
const previous = threads.get(previousId);
const NOW = Date.parse(latest.created_at) + 10 * 24 * 3600 * 1000;

let upstream: FixtureFetch;
let client: Client;

async function connect(cache = new ResponseCache(null, () => NOW)) {
  const hn = new HnClient({ fetch: upstream.fetch, cache, minIntervalMs: 0, retryDelayMs: 0, now: () => NOW });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(hn).connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { result, data: result.structuredContent as any, text: (result.content[0] as { text: string } | undefined)?.text ?? "" };
}

beforeEach(async () => {
  upstream = fixtureFetch();
  await connect();
});

describe("tool listing", () => {
  it("exposes four read-only tools with input and output schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_job", "hiring_trends", "list_hiring_threads", "search_jobs"]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
    const search = tools.find((t) => t.name === "search_jobs")!;
    expect(Object.keys(search.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["query", "month", "location", "work_mode", "technologies", "has_salary", "visa_sponsorship", "limit", "offset"]),
    );
  });
});

describe("list_hiring_threads", () => {
  it("returns only 'Who is hiring?' threads, newest first", async () => {
    const { data } = await call("list_hiring_threads", { limit: 3 });
    expect(data.threads).toHaveLength(3);
    expect(data.threads[0]).toMatchObject({ id: latestId, title: latest.title, hn_url: `https://news.ycombinator.com/item?id=${latestId}` });
    expect(data.threads.every((t: any) => t.title.startsWith("Ask HN: Who is hiring?"))).toBe(true);
    expect(data.threads.map((t: any) => t.month)).toEqual([...data.threads.map((t: any) => t.month)].sort().reverse());
  });
});

describe("search_jobs", () => {
  it("defaults to the latest thread, skips deleted posts and paginates", async () => {
    const livePosts = latest.children.filter((c: any) => c.text).length;
    const first = await call("search_jobs", { limit: 15 });
    expect(first.data).toMatchObject({ thread_id: latestId, total_matches: livePosts, offset: 0, next_offset: 15 });
    expect(first.data.jobs).toHaveLength(15);

    const last = await call("search_jobs", { limit: 15, offset: 30 });
    expect(last.data.jobs).toHaveLength(livePosts - 30);
    expect(last.data.next_offset).toBeNull();
    const ids = new Set([...first.data.jobs, ...last.data.jobs].map((j: any) => j.id));
    expect(ids.size).toBe(15 + livePosts - 30);
  });

  it("sorts by newest by default", async () => {
    const { data } = await call("search_jobs", { limit: 50 });
    const dates = data.jobs.map((j: any) => j.posted_at);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("selects a past month", async () => {
    const month = previous.title.match(/\((\w+ \d{4})\)/)[1];
    const { data } = await call("search_jobs", { month: monthToIso(month) });
    expect(data.thread_id).toBe(previousId);
  });

  it("applies every filter to every returned job", async () => {
    const { data } = await call("search_jobs", { work_mode: "remote", technologies: ["python"], limit: 50 });
    expect(data.total_matches).toBeGreaterThan(0);
    for (const job of data.jobs) {
      expect(job.work_modes).toContain("remote");
      expect(job.technologies).toContain("Python");
    }
    const salaried = await call("search_jobs", { has_salary: true, limit: 50 });
    expect(salaried.data.jobs.every((j: any) => j.salary)).toBe(true);
  });

  it("requires every free-text term", async () => {
    const { data } = await call("search_jobs", { query: "engineer", limit: 50 });
    expect(data.total_matches).toBeGreaterThan(0);
    const none = await call("search_jobs", { query: "engineer zzzunmatchablezzz" });
    expect(none.data.total_matches).toBe(0);
  });

  it("never returns e-mail addresses", async () => {
    for (const id of threadIds) {
      const month = monthToIso(threads.get(id).title.match(/\((\w+ \d{4})\)/)[1]);
      const { text } = await call("search_jobs", { month, limit: 50 });
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    }
  });

  it("rejects malformed input with a clear message", async () => {
    const badMonth = await call("search_jobs", { month: "2026-13" });
    expect(badMonth.result.isError).toBe(true);
    expect(badMonth.text).toContain("YYYY-MM");

    const badTech = await call("search_jobs", { technologies: ["cobol"] });
    expect(badTech.result.isError).toBe(true);
    expect(badTech.text).toMatch(/^INVALID_INPUT: Unknown technology "cobol"/);

    const missing = await call("search_jobs", { month: "2010-01" });
    expect(missing.text).toMatch(/^NOT_FOUND: No "Ask HN: Who is hiring\?" thread found for 2010-01/);
  });
});

describe("get_job", () => {
  it("returns the full post with its thread", async () => {
    const raw = latest.children.find((c: any) => c.text);
    const { data } = await call("get_job", { id: raw.id });
    expect(data).toMatchObject({ id: raw.id, thread_id: latestId, hn_url: `https://news.ycombinator.com/item?id=${raw.id}` });
    expect(data.text.length).toBeGreaterThan(data.excerpt.length - 1);
  });

  it("refuses ids that are not job posts", async () => {
    const thread = await call("get_job", { id: latestId });
    expect(thread.result.isError).toBe(true);
    expect(thread.text).toMatch(/^NOT_FOUND: .*not a top-level job post/);

    const unknown = await call("get_job", { id: 999 });
    expect(unknown.text).toMatch(/^NOT_FOUND/);
  });
});

describe("hiring_trends", () => {
  it("reports per-month technology shares, oldest first", async () => {
    const { data } = await call("hiring_trends", { technologies: ["Python", "golang"], months: 3 });
    expect(data.months.map((m: any) => m.month)).toEqual([...data.months.map((m: any) => m.month)].sort());
    for (const m of data.months) {
      expect(m.technologies.map((t: any) => t.name)).toEqual(["Python", "Go"]);
      for (const t of m.technologies) expect(t.share_percent).toBeCloseTo((t.posts / m.total_posts) * 100, 0);
    }
  });
});

describe("upstream behaviour", () => {
  it("retries once on a 5xx and then reports UPSTREAM_ERROR", async () => {
    upstream.failWith = [503];
    expect((await call("list_hiring_threads")).result.isError).toBeFalsy();

    upstream.failWith = [500, 500];
    const failed = await call("search_jobs", { month: "2026-01" });
    expect(failed.result.isError).toBe(true);
    expect(failed.text).toMatch(/^UPSTREAM_ERROR: HN API answered 500/);
  });

  it("serves repeated calls from the cache, including across restarts via disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hn-hiring-mcp-"));
    await connect(new ResponseCache(dir, () => NOW));
    await call("search_jobs", { query: "engineer" });
    await call("search_jobs", { query: "senior" });
    expect(upstream.calls).toHaveLength(2); // thread list + thread

    upstream = fixtureFetch();
    await connect(new ResponseCache(dir, () => NOW));
    await call("search_jobs", { query: "engineer" });
    expect(upstream.calls).toHaveLength(0);
  });
});

function monthToIso(monthYear: string): string {
  const [name, year] = monthYear.split(" ") as [string, string];
  const index = new Date(`${name} 1, 2000`).getMonth() + 1;
  return `${year}-${String(index).padStart(2, "0")}`;
}
