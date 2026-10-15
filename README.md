# hn-hiring-mcp

[![CI](https://github.com/Crayz129/hn-hiring-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Crayz129/hn-hiring-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/hn-hiring-mcp)](https://www.npmjs.com/package/hn-hiring-mcp)

An [MCP](https://modelcontextprotocol.io) server that turns the monthly Hacker News
**"Ask HN: Who is hiring?"** threads into a typed, searchable job API.

Every month hundreds of companies post jobs there as free-form comments. HN's own API
can only return items by id, so there is no way to ask *"remote Python roles in Europe
that state a salary"* or *"is Rust demand growing?"*. This server parses each post into
structured fields (company, roles, location, remote/hybrid/onsite, salary, visa,
technologies) and exposes four read-only tools to any MCP client.

## Tools

| Tool | What it does |
| --- | --- |
| `list_hiring_threads` | Latest monthly threads with ids and comment counts. |
| `search_jobs` | Search one month: free text, `location`, `work_mode`, `technologies`, `has_salary`, `visa_sponsorship`, `sort`, `limit`/`offset`. Returns compact summaries. |
| `get_job` | Full text and parsed fields of one post by id. |
| `hiring_trends` | Per month: share of posts mentioning each technology, and remote/hybrid/onsite counts. |

All tools declare JSON Schemas for input **and** output (`structuredContent`), are annotated
`readOnlyHint`, and fail with a clear, model-readable error:

```
INVALID_INPUT: Unknown technology "cobol". Known technologies: Python, TypeScript, … For anything else use the free-text "query".
NOT_FOUND: HN item 49922569 is not a top-level job post in a "Who is hiring?" thread.
UPSTREAM_ERROR: HN API answered 503 while loading thread list. Try again later.
```

## Install

Requires Node.js 22+.

**Claude Code**

```bash
claude mcp add hn-hiring -- npx -y hn-hiring-mcp
```

**Claude Desktop**: add to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "hn-hiring": {
      "command": "npx",
      "args": ["-y", "hn-hiring-mcp"]
    }
  }
}
```

Any other MCP client: run `npx -y hn-hiring-mcp` as a stdio server.

## Example

An abridged session in Claude Desktop (October 2026 data):

> **You:** Find remote Python jobs from this month's Who is hiring that state a salary.
>
> *Claude calls* `search_jobs({ "technologies": ["Python"], "work_mode": "remote", "has_salary": true })`
>
> **Claude:** The October 2026 thread has 37 remote posts mentioning Python; 22 of them state a salary:
> 1. **NeuralFrame**: Senior Backend Engineer, Medical Data Pipeline (Python + Rust).
>    REMOTE (US only, no visa sponsorship), $170k–$210k + equity.
>    [HN post](https://news.ycombinator.com/item?id=50095921)
> 2. …
>
> **You:** Has demand for MCP experience changed this year?
>
> *Claude calls* `hiring_trends({ "technologies": ["MCP", "Python", "TypeScript"], "months": 6 })`
>
> **Claude:** Yes. Posts mentioning MCP went from 2.5% in May to 4.5% in October
> (1.3% at the June low), while Python (22–27%) and TypeScript (20–24%) stayed flat.

## How it works

- **Data source:** the public [HN Algolia API](https://hn.algolia.com/api). One request
  returns a whole thread (~250 job posts), instead of ~400 item requests to the Firebase API.
- **Politeness:** requests are serialised with at least 1 s between them, send an identifying
  `User-Agent`, and retry once on 429/5xx.
- **Cache:** responses are cached in memory and on disk (`~/.cache/hn-hiring-mcp`, override with
  `HN_HIRING_MCP_CACHE_DIR`, or `off`). Threads older than 45 days never change and are kept;
  the current month is refreshed hourly. Replies to job posts are dropped before caching.
- **Parsing** ([`src/parse.ts`](src/parse.ts)) follows the thread's own convention,
  `Company | Role | Location | REMOTE | Salary`, and also handles `—` separators, the location in
  parentheses and salary ranges written with ` - `. Technology detection
  ([`src/technologies.ts`](src/technologies.ts)) leans conservative: "Go ahead and apply" is not Go.
  Posts are free text, so the fields are best-effort; `headline` and `hn_url` are always there to check.

## Privacy and scope

- Read-only. No accounts, no logins, no applying on anyone's behalf.
- E-mail addresses in posts (including `name [at] company [dot] com` and puzzle-style ones) are
  replaced with `[email on HN]`; the user follows `hn_url` to the original post to apply.
- HN usernames of posters are not returned.

## Development

```bash
npm install
npm test            # vitest, against recorded fixtures only; no network
npm run typecheck
npm run build
node scripts/smoke.ts search_jobs '{"query":"rust","limit":3}'   # live call through a real MCP client
node scripts/record-fixtures.ts                                   # refresh fixtures (anonymised, trimmed)
```

The server tests connect a real MCP `Client` to the server over an in-memory transport,
so they exercise schemas, validation and error mapping the way Claude does.

## License

MIT
