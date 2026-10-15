// Records trimmed, anonymised copies of real HN Algolia responses into test/fixtures.
// Tests never touch the network; re-run this only when you want fresher fixtures.
// Usage: node scripts/record-fixtures.ts [months=3] [postsPerThread=40]
import { mkdir, writeFile } from "node:fs/promises";
import { redactEmails } from "../src/parse.ts";

const API = "https://hn.algolia.com/api/v1";
const [months = 3, postsPerThread = 40] = process.argv.slice(2).map(Number);
const OUT = new URL("../test/fixtures/", import.meta.url);

async function get(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": "hn-hiring-mcp fixture recorder" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await new Promise((r) => setTimeout(r, 1000));
  return res.json();
}

const search = await get(`${API}/search_by_date?tags=story,author_whoishiring&hitsPerPage=${months * 3}`);
const stories = search.hits.map(({ objectID, title, created_at, created_at_i, num_comments }: any) => ({
  objectID, title, created_at, created_at_i, num_comments,
}));
await mkdir(new URL("threads/", OUT), { recursive: true });
await writeFile(new URL("stories.json", OUT), JSON.stringify({ hits: stories }, null, 1));

for (const story of stories.filter((s: any) => s.title.startsWith("Ask HN: Who is hiring?"))) {
  const thread = await get(`${API}/items/${story.objectID}`);
  const children = thread.children
    .filter((c: any) => c.text)
    .slice(0, postsPerThread)
    .map((c: any, i: number) => ({
      id: c.id,
      type: c.type,
      author: `user${i + 1}`,
      created_at: c.created_at,
      parent_id: c.parent_id,
      story_id: c.story_id,
      title: null,
      text: redactEmails(c.text),
      children: [],
    }));
  // Keep one deleted post so the parser's null path stays covered.
  children.push({ id: 1, type: "comment", author: null, created_at: thread.created_at, parent_id: thread.id, story_id: thread.id, title: null, text: null, children: [] });
  const { id, type, author, created_at, title, text } = thread;
  await writeFile(
    new URL(`threads/${id}.json`, OUT),
    JSON.stringify({ id, type, author, created_at, parent_id: null, story_id: id, title, text, children }, null, 1),
  );
  console.log(`${title}: ${children.length} posts`);
}
