#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defaultCacheDir, ResponseCache } from "./cache.ts";
import { HnClient } from "./hn-client.ts";
import { createServer } from "./server.ts";

const hn = new HnClient({ cache: new ResponseCache(defaultCacheDir()) });
const server = createServer(hn);
await server.connect(new StdioServerTransport());
