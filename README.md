# WizTree MCP

[中文](./README.zh-CN.md) | [日本語](./README.ja.md) | [English](./README.md)

> **This fork fixes Simplified Chinese (zh-CN) WizTree exports.** Upstream resolves
> only English and Japanese CSV headers, so a zh-CN export yields `entries: 0` with
> no error at all, and its exporter argument order silently writes no CSV when a
> WizTree GUI instance is already running. This branch adds zh-CN headers, moves the
> target path last with a trailing separator, and collapses doubled separators.
> It also closes the silent-failure and path-safety gaps that survived that work: an
> unrecognized header now fails loudly instead of reporting an empty scan, UNC
> prefixes survive separator collapsing, `get_treemap` is confined to the export
> directory, and WizTree lookup prefers install locations over `PATH`.
> See [README.zh-CN.md](./README.zh-CN.md) for the full write-up, install steps and
> regression tests.

Disk-usage analysis over MCP. Windows uses WizTree CSV export; macOS uses a
read-only native metadata scanner. Existing English/Japanese WizTree CSVs remain
usable on both platforms. Scanned files are never modified.

## Snapshot lifecycle — behavior change

**Normal scans no longer create persistent snapshots on either platform.**
`scan_path` returns `csvPath: "scan:<id>"`, an in-memory handle accepted by all
CSV analysis tools. One scan is retained per process; the next successful scan
replaces it, and a restart expires it. A failed scan leaves the previous handle
available. Parsed user CSVs are cached separately (up to three).

On Windows, WizTree must export CSV. The server creates a unique temporary
directory, waits for the exporter to exit, parses its CSV, reads any treemap PNG,
and removes that temporary directory in `finally`, including exporter/parse
failure, cancellation and timeout. Only the directory created by this operation
is removed. Existing user CSVs and legacy `exports/` are not automatically
cleaned. Cleanup errors surface as failed calls. A hard process crash or power
loss can prevent `finally` from running; no broad startup sweep deletes files.

On macOS, normal scanning writes no CSV at all. There are no generated timestamp
or UUID filenames for persistent exports on either platform.

To intentionally retain a result (for example, the earlier side of a comparison),
provide **all three** parameters:

```json
{
  "targetPath": "/Users/you/Documents/example",
  "saveSnapshot": true,
  "snapshotDirectory": "/Users/you/Documents/chosen-snapshots",
  "snapshotName": "baseline.csv"
}
```

Use an absolute directory appropriate to the host; Windows accepts a path such
as `D:\chosen-snapshots`. The filename must end in `.csv` and contain only
letters, digits, dot, underscore or hyphen, with no path components. Existing
files are never overwritten. A repeated `baseline.csv` request fails with
`EEXIST` instead of silently creating another filename. Choose a new name only
when you deliberately want another snapshot. Without `saveSnapshot: true`,
providing a save destination is rejected.

Saved CSVs are limited to 32 MiB each; the direct regular files in the chosen
directory plus the new CSV must fit 128 MiB. Saves are serialized within one
server process. Avoid multiple server processes writing to the same directory.
Files created by the save operation use mode 0600 where supported. Cancelled or
failed writes remove only the new file opened by that operation. Windows saves
preserve the original WizTree CSV; Mac saves use compatible English headers.

**Compatibility changes:** previous Windows `scan_path` calls returned a
persistent timestamped CSV/PNG under `exports/`. They now return a memory handle
unless explicit saving is requested. Treemap images are returned inline and their
temporary PNGs are removed; no new persistent `treemapPath` is returned.
Previously introduced Mac `saveSnapshot: true` without a directory/name is also
rejected. Update clients that require durable filenames. Analysis output tables
now show both logical and allocated size. Standalone CSV parsing is capped at
200,000 entries; scan parsing/traversal uses `maxEntries` (default 100,000,
maximum 200,000).

## Tools

- `locate_wiztree`: Find WizTree from `WIZTREE_PATH`, common install locations, then `PATH`.
- `scan_path`: Scan a specified target; return a memory handle or an explicitly named CSV. Windows supports its existing include/exclude filters, sorting, admin and treemap arguments.
- `analyze_csv`: Summarize a handle or an existing CSV.
- `top_entries`: Largest files/folders by logical or allocated size.
- `drill_down`: Direct children of a folder, sorted by size.
- `search_entries`: Path substring or glob search with matched count and size.
- `old_large_files`: Files larger than a threshold and older than a chosen age.
- `extension_summary`: File usage by extension.
- `compare_csv`: Growth/shrinkage between handles or CSV files.
- `list_snapshots`: List the configured legacy export directory. Intentionally saved snapshots elsewhere are accessed by their returned paths.
- `get_treemap`: Read a PNG from the configured export directory only. `scan_path`
  returns treemaps inline and deletes its temporary PNG, so this serves PNGs that are
  actually saved in that directory.
- `cleanup_snapshots`: Legacy explicit deletion of older CSV/PNG files in the configured export directory. This tool does not establish ownership of legacy files; it is disabled in the configuration examples below.

Setting `WIZTREE_MCP_DISABLE_CLEANUP=1` omits `cleanup_snapshots` from
`tools/list` and rejects direct calls. Unset or other values preserve the legacy
tool's availability. It is independent of cleanup of owned Windows temporary
files, which always runs. No scan automatically removes user snapshots.
`WIZTREE_MCP_EXPORT_DIR` controls only the legacy list/cleanup directory
(default `exports/` under the repository), not the explicit save destination.

List-style tools return compact tab-separated tables. `csvPath` inputs can be
`scan:<id>` handles or filesystem paths. Save at least the earlier scan before
running a second scan if you need a comparison.

## Setup

Requires Node.js 22 or newer. Install without lifecycle scripts, then build:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

Run `node dist/index.js` for stdio MCP. The process waits for JSON-RPC messages.
No native dependencies or macOS WizTree installation are required.

## Registering the server

Let the checkout compute its own paths instead of editing an example by hand:

```sh
npm run print-config                    # Codex, cc-switch, Claude Code/Desktop, Gemini CLI
npm run print-config -- --client codex  # one client only
```

It prints the same blocks shown below with this checkout's absolute `dist/index.js`,
the absolute path of the `node` binary that ran it, and the timeout fields already
present. If `dist/index.js` is missing it exits `1` and prints nothing usable, so a
half-built checkout cannot quietly become a broken registration.

### Placeholders in the examples below

Any token written as `<...>` is a placeholder, never a path. There are two:

| Token | Replace with | How to read it |
|---|---|---|
| `<REPO>` | absolute path of this checkout, e.g. `C:\tools\wiztree-mcp` | `git rev-parse --show-toplevel` |
| `<NODE>` | absolute path of the directory holding `node`, e.g. `C:\Program Files\nodejs` | `where.exe node` / `which node` |

Delete the angle brackets together with the token; do not keep the surrounding `<` `>`.

This deserves more care than a typical example block. `<` and `>` are not valid path
characters, so a line that was pasted half-replaced can never resolve, and the client
reports almost nothing: GUI-launched clients start MCP servers before any model turn
happens, so `ENOENT` on the script path surfaces only as "server not connected", or the
server is simply absent from `/mcp` and the tool list. Nothing in the conversation says
which line was wrong.

### Resolve both paths before pasting

```sh
npm run print-config -- --client codex   # prints both, already escaped for the target file
```

Or read them by hand, from the repository root:

```powershell
where.exe node                       # goes in command
node -e "console.log(require('path').join(process.cwd(),'dist','index.js'), require('fs').existsSync(require('path').join(process.cwd(),'dist','index.js')))"
```

`which node` on macOS/Linux. The second command must print `true`; `false` means
`npm run build` never ran or the command was run outside the checkout.

Then restart the client, because MCP servers are read at startup only, and verify the
connection instead of assuming it. In Codex, `/mcp` has to list `wiztree` together with
its tools. In Claude Code, `claude mcp list` actually connects and prints
`✔ wiztree - OK`.

### Codex (`~/.codex/config.toml`)

macOS:

```toml
[mcp_servers.wiztree]
command = "<NODE>/node"
args = ["<REPO>/dist/index.js"]
startup_timeout_sec = 120
tool_timeout_sec = 600

[mcp_servers.wiztree.env]
WIZTREE_MCP_DISABLE_CLEANUP = "1"
```

Windows (`<NODE>` is the directory from `where.exe node`):

```toml
[mcp_servers.wiztree]
command = '<NODE>\\node.exe'
args = ['<REPO>\dist\index.js']
startup_timeout_sec = 120
tool_timeout_sec = 600

[mcp_servers.wiztree.env]
WIZTREE_PATH = 'C:\Program Files\WizTree\WizTree64.exe'
WIZTREE_MCP_DISABLE_CLEANUP = '1'
```

Use an absolute path to `node.exe`, not bare `node`. GUI-launched clients such as
Claude Desktop and the ChatGPT desktop app start servers without a shell PATH, and
version managers (nvm, fnm, volta) keep `node` off PATH entirely; a bare `node`
then fails with `ENOENT` before the server can report anything.

`WIZTREE_PATH` is optional when WizTree is found in a common location or `PATH`.
Skip it if `npm run print-config` did not find WizTree there and print-config omitted
the key; a path to a nonexistent `WizTree64.exe` is worse than no key at all.
`admin: true` still triggers Windows UAC. The exporter process is terminated on
cancellation/timeout and awaited before temporary-file cleanup. Windows process
termination, UAC and file-lock behavior require real Windows validation.

### Timeouts

Scans are long-running, and every client's default tool timeout is far below this
server's own `timeoutSeconds` (300 s by default). Left unset, the client aborts the
tool call mid-scan and the result looks like "no entries" rather than a timeout:

| Client | Tool-call timeout setting | Default |
|---|---|---|
| Codex | `tool_timeout_sec` (seconds) in `[mcp_servers.wiztree]` | 60 |
| Codex (startup) | `startup_timeout_sec` (seconds) | 10 |
| Claude Code / Claude Desktop | `MCP_TOOL_TIMEOUT` (ms); `MCP_TIMEOUT` bounds startup | 30000 ms startup |
| Gemini CLI | `timeout` (ms) in `mcpServers.wiztree` | 60000 |

`codex mcp add` cannot write timeout fields, so add `tool_timeout_sec` afterwards.
`npm run print-config -- --client codex` writes them, which is the reason to prefer it
over `codex mcp add`.

### Claude Code and Claude Desktop

Claude Code reads `mcpServers` from `~/.claude.json`; Claude Desktop reads the same
shape from `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wiztree": {
      "type": "stdio",
      "command": "<NODE>\\node.exe",
      "args": ["<REPO>\\dist\\index.js"],
      "env": {
        "WIZTREE_PATH": "C:\\Program Files\\WizTree\\WizTree64.exe",
        "WIZTREE_MCP_DISABLE_CLEANUP": "1"
      }
    }
  }
}
```

`npm run print-config -- --client claude` prints this block with the placeholders
substituted, which also removes an escaping trap: in JSON, `C:\Users\ben\...` is not a
literal path at all. Some sequences are parse errors, and ones like `\t` in `C:\tools`
decode into a real tab character, so the entry looks valid and points nowhere.

### cc-switch (one entry, several clients)

[cc-switch](https://github.com/farion1231/cc-switch) keeps MCP servers in its own
store and writes them into each client's config file, which is handy when the same
server should reach Codex and Claude Code at once.

1. `npm run print-config -- --client cc-switch`, then copy the JSON it prints.
2. Sidebar **MCP** → header **Add MCP**.
3. Paste that JSON into the "paste config" box and the form fills itself; the box also
   accepts Codex TOML. Alternatively fill command, args (one per line), env and working
   directory by hand in the connection form.
4. Tick the target apps under "write to", then add. Toggle per app later from the matrix.
5. Restart the client and confirm the connection: `/mcp` in Codex, `claude mcp list`
   for Claude Code. Tools appear as `mcp__wiztree__scan_path` and friends.

Step 1 is worth taking seriously here more than anywhere else: cc-switch stores the args
and replays them into every managed client, so a placeholder left in the panel's args
field is written back into `~/.codex/config.toml` on the next sync, and the failed
launch leaves no error text behind in the client. When a registered server shows no
tools, edit the entry in cc-switch and read its args line before suspecting the server.

Two cautions. Once cc-switch manages Codex, stop editing the `[mcp_servers]` section of
`~/.codex/config.toml` by hand: cc-switch rewrites that section from its own store on
every sync, so a manual fix gets dropped and the entry must be corrected in the panel.
And `tool_timeout_sec` and other client-native fields pass through cc-switch verbatim,
so keeping them in the pasted JSON is safe. The working directory can stay empty; the
snapshot and cleanup directory is derived from the script location (`<REPO>/exports`),
not from cwd.

**No allowed-root setting is implemented.** The server can scan any directory
readable by its process. Mac rejects `/` and symlink targets, but that is not an
allowlist. CSV analysis and PNG reading also accept arbitrary readable paths;
explicit saves can target arbitrary writable directories. Register only after
agreeing on that scope or implementing the desired allowed-root policy.

## macOS backend

Only metadata is read, never file contents. `includeFiles` / `includeFolders`
control returned rows; directory totals still include all encountered regular
files. POSIX drilldown/comparison paths preserve case.

- Symlinks and nested mounts are skipped. Symlink target directories and `/` are rejected. Canonical containment is rechecked before listing. Node path APIs leave a check/list race against concurrent adversarial path replacement; scan a stable trusted directory.
- Permission and disappearing-file errors produce `partial: true`, `errorCount` and up to 100 error details. Skipped link/mount counts are separate.
- Cancellation, timeout (default 300 seconds), traversal queue and entry limits abort without publishing a result. Pending filesystem calls finish before cancellation is observed.
- Logical size is `st_size`; allocated size is `st_blocks * 512`. Hardlinks count once per path and are reported as `hardlinkEntries`. APFS clones/shared extents, compression, snapshots, purgeable storage and actual reclaimable bytes are not reconciled. Totals exclude directory metadata and special files.
- WizTree-specific admin, filters, sorting, executable path and treemap options are rejected on Mac. Use the analysis tools to filter and sort results.

## Privacy

Results and saved CSVs include full local paths. Check outputs before sharing.
Explicitly saved files outside the repository are not covered by its Git ignore
rules. Normal scans create no persistent CSV/PNG exports.

## Implementation / validation
Added native scanning, Windows temporary-export lifecycle, shared named snapshot
saves, in-memory handles, optional cleanup-tool disablement and fixture tests.
Direct dependency declarations and package names are unchanged; patched
transitive versions are recorded in the lockfile without adding native packages.

`npm run typecheck`, `npm run build`, `npm test` (29 tests) and `git diff --check` pass.
Tests cover native sizes, symlinks, hardlinks, permission errors, cancellation and
limits; English/Japanese Windows CSV compatibility; Mac real stdio analysis;
cleanup-disabled `tools/list`; explicit saves, duplicate refusal and size budgets;
and Windows mock/Node fixture subprocess export success, failure, parser failure,
cancellation and timeout, including owned-temp cleanup and user-CSV preservation; and
`scripts/print-config.mjs`, which emits registration blocks with real absolute paths.
The suite is split by host and CI runs both jobs. `tests/windows.test.mjs` runs
anywhere; the macOS-dependent cases in `tests/native.test.mjs` (POSIX symlinks, file
modes, case-sensitive names) skip elsewhere, which is what makes `npm test` usable on
Windows at all: 25 pass and 4 skip there, and all 29 run on macOS. Tests drive mock
exporters and Node subprocess fixtures rather than WizTree itself, so real WizTree,
UAC and taskkill behavior is still not exercised. Tests use small temporary fixtures
removed after execution (the 128 MiB budget fixture is sparse).

The automated suite stays inside fixtures. Outside it, one manual smoke run on Windows
started the built server the way a client does: a registered stdio session listed all 11
tools, scanned a small real directory with the installed `WizTree64.exe`, ran the
analysis tools over that scan, and refused an out-of-range `get_treemap` path. UAC
elevation, `taskkill` against a hung exporter, real macOS host behavior and any
user-data deletion remain unverified, and nothing in this branch widens permissions
persistently.

## Dependency audit follow-up

### First pass

`npm audit --audit-level=high` passes after compatible transitive updates; the
existing CI threshold is unchanged. No forced or major update was used, and
installed versions were checked against the lockfile after `npm ci --ignore-scripts`.

| Package | Original severity | Kind | Locked version before → after | Fixed from |
| --- | --- | --- | --- | --- |
| proxy-addr | critical | transitive | 2.0.7 → 2.0.8 | 2.0.8 |
| fast-uri | high | transitive | 3.1.2 → 3.1.8 | 3.1.8 |
| hono | high | transitive | 4.12.23 → 4.13.13 | 4.13.7 |
| ip-address | high | transitive | 10.2.0 → 10.7.3 | 10.7.1 |
| @hono/node-server | moderate | transitive | 1.19.14 → 1.19.17 | 1.19.15 |
| qs | moderate | transitive | 6.15.2 → 6.16.0 | 6.16.0 |
| esbuild | low | transitive/dev | 0.28.0 → 0.28.2 | 0.28.1 |
| body-parser | low | transitive | 2.2.2 (retained) | 2.3.0 |
| csv-parse | moderate | direct | 5.6.0 (retained) | 7.0.2 |

The compatible `qs` update also patches existing `side-channel` 1.1.0 → 1.1.1;
esbuild's existing platform packages follow 0.28.2. No package names were added.
Two findings remain: `csv-parse` requires a major update and `body-parser` 2.3.0
introduces a nested `content-type` 2.x dependency. Both are deferred for separate
review. This is not a zero-findings audit report. No audit exception was added.

### Second pass

The high gate started failing again once two newer advisories were published:
`body-parser` (high: a silently disabled size limit, and DoS via trailing bytes after a
compressed body) and `zod` (high: GHSA-mrhx-c7xc-m3w5, memory exhaustion while
validating oversized constrained collections, affecting `zod <4.6.6`).

| Package | Kind | Locked version before → after | Fixed from |
| --- | --- | --- | --- |
| body-parser | transitive | 2.2.2 → 2.4.0 | 2.4.0 |
| @hono/node-server | transitive | 1.19.17 → 2.1.7 | 2.1.3 |
| fast-uri | transitive | 3.1.8 → 3.1.9 | 3.1.9 |
| ip-address | transitive | 10.7.3 → 10.7.6 | same resolution |
| qs | transitive | 6.16.0 → 6.17.1 | same resolution |
| iconv-lite | transitive | 0.7.2 → 0.7.3 | same resolution |
| zod | direct, major | 3.25.76 → 4.6.7 | 4.6.6 |

The first pass's "no major update" rule was lifted for `zod` alone, because it has no
3.x fix and both consumers already accept v4: `@modelcontextprotocol/sdk` 1.32 declares
`zod: ^3.25 || ^4.0`, `zod-to-json-schema` 3.25.2 peers `^3.25.28 || ^4`, and the
resolved tree keeps one deduplicated `zod` instead of a v3 copy hiding under the SDK.
The declared range is now `^4.6.7`.

Schema output was checked through a real stdio session rather than by type check alone:
the 11 tools still publish their defaults, enum values, descriptions, numeric bounds and
`exclusiveMinimum`, and a tool call still coerces defaults and returns its error text.
`npm run typecheck`, `npm run build` and `npm test` (29 tests) pass, and the installed
tree was re-checked against the lockfile after `npm ci --ignore-scripts`.

`body-parser` 2.4.0 now carries a nested `content-type` 2.1.0 next to the existing 1.x
copy; no package name was added. `csv-parse` 5.x stays open (moderate, fixed only in
7.0.2, a breaking major) and is still deferred for separate review. `npm audit
--audit-level=high` exits 0 again; `--audit-level=moderate` still reports that single
finding. No audit exception was added.

## License

MIT. See [LICENSE](./LICENSE).
