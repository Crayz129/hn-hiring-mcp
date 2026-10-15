import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SERVER_NAME, SERVER_VERSION } from "../src/server.ts";

const json = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

it("keeps name and version in sync across package.json, server.json and the server", () => {
  const pkg = json("package.json");
  const registry = json("server.json");
  expect(SERVER_NAME).toBe(pkg.name);
  expect(SERVER_VERSION).toBe(pkg.version);
  expect(registry.name).toBe(pkg.mcpName);
  expect(registry.version).toBe(pkg.version);
  expect(registry.packages[0]).toMatchObject({ identifier: pkg.name, version: pkg.version });
});
