// Live smoke test: starts the built server over stdio and calls a tool against the real HN API.
// Usage: npm run build && node scripts/smoke.ts search_jobs '{"query":"python","work_mode":"remote","limit":3}'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [tool = "list_hiring_threads", args = "{}"] = process.argv.slice(2);
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"] }));
const started = Date.now();
const result = await client.callTool({ name: tool, arguments: JSON.parse(args) });
console.log(JSON.stringify(result.isError ? result.content : result.structuredContent, null, 2));
console.error(`${tool}: ${Date.now() - started} ms`);
await client.close();
