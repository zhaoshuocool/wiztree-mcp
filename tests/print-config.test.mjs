import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = join(import.meta.dirname, "..", "scripts", "print-config.mjs");
const repoRoot = resolve(import.meta.dirname, "..");
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const jsonBlock = (stdout) => JSON.parse(stdout.slice(stdout.indexOf("{\n")));

test("print-config emits absolute paths and timeout fields instead of placeholders", (t) => {
  const claude = run(["--root", repoRoot, "--client", "claude"]);
  assert.equal(claude.status, 0, claude.stderr);
  const entry = join(repoRoot, "dist", "index.js");
  const blocks = jsonBlock(claude.stdout);
  assert.deepEqual(blocks.mcpServers.wiztree.args, [entry]);
  assert.equal(blocks.mcpServers.wiztree.command, process.execPath);
  const codex = run(["--root", repoRoot, "--client", "codex"]);
  assert.equal(codex.status, 0, codex.stderr);
  assert.match(codex.stdout, new RegExp(`args = \\[${JSON.stringify(entry).replace(/\\/g, "\\\\")}\\]`));
  assert.match(codex.stdout, /startup_timeout_sec = 120/);
  assert.match(codex.stdout, /tool_timeout_sec = 600/);
  for (const output of [claude.stdout, codex.stdout]) {
    assert.doesNotMatch(output, /path[\\/]to|REPLACE|your[_-]?path|Users[/\\]you/i, "no placeholder text may survive");
  }
});

test("print-config refuses to emit config for an unbuilt checkout", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "wiztree-print-config-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const result = run(["--root", base]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not built/);
  assert.match(result.stderr, /npm run build/);
});

test("print-config rejects an unknown client rather than printing nothing", (t) => {
  const result = run(["--client", "not-a-client"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown --client/);
});
