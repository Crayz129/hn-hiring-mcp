import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("./fixtures/", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

export const stories: { hits: Array<{ objectID: string; title: string; created_at_i: number }> } = read("stories.json");
export const threads: Map<number, any> = new Map(
  readdirSync(new URL("threads/", dir)).map((f) => {
    const t = read(`threads/${f}`);
    return [t.id, t];
  }),
);

/** IDs of the hiring threads in the fixtures, newest first. */
export const threadIds = stories.hits.filter((h) => h.title.startsWith("Ask HN: Who is hiring?")).map((h) => Number(h.objectID));

export interface FixtureFetch {
  fetch: typeof fetch;
  calls: string[];
  /** Status codes to return (in order) instead of the fixture, e.g. [500, 500]. */
  failWith: number[];
}

/** A fetch that answers the HN Algolia URLs the client builds, from recorded fixtures only. */
export function fixtureFetch(): FixtureFetch {
  const state: FixtureFetch = { calls: [], failWith: [], fetch: undefined as never };
  state.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    state.calls.push(url.pathname + url.search);
    const status = state.failWith.shift();
    if (status) return new Response("upstream says no", { status });

    if (url.pathname === "/api/v1/search_by_date") {
      let hits = stories.hits;
      const filters = url.searchParams.get("numericFilters");
      if (filters) {
        const [, from, to] = /created_at_i>=(\d+),created_at_i<(\d+)/.exec(filters)!.map(Number) as [number, number, number];
        hits = hits.filter((h) => h.created_at_i >= from && h.created_at_i < to);
      }
      return Response.json({ hits: hits.slice(0, Number(url.searchParams.get("hitsPerPage") ?? 20)) });
    }

    const itemId = Number(/^\/api\/v1\/items\/(\d+)$/.exec(url.pathname)?.[1]);
    const thread = threads.get(itemId);
    if (thread) return Response.json(thread);
    for (const t of threads.values()) {
      const post = t.children.find((c: any) => c.id === itemId);
      if (post) return Response.json(post);
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  }) as typeof fetch;
  return state;
}
