#!/usr/bin/env node
// Prints registration blocks with real absolute paths already filled in, so no
// placeholder has to be hand-edited. Reads nothing but its own location.
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CLIENTS = ['codex', 'cc-switch', 'claude', 'gemini'];

const USAGE = `Usage: node scripts/print-config.mjs [--client <${CLIENTS.join('|')}|all>] [--root <dir>]

Prints MCP registration blocks with this checkout's absolute dist/index.js path,
the absolute path of the running node binary, and the client timeout fields.
Exit code 1 when dist/index.js is missing, so a broken registration cannot be
pasted silently.`;

function parseArgs(argv) {
  const opts = {
    client: 'all',
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === '--client') {
      opts.client = argv[++i] ?? '';
    } else if (arg === '--root') {
      opts.root = path.resolve(argv[++i] ?? '.');
    } else {
      console.error(`unknown argument: ${arg}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  const wanted = opts.client === 'all' ? CLIENTS : [opts.client];
  const unknown = wanted.filter((client) => !CLIENTS.includes(client));
  if (unknown.length > 0) {
    console.error(`unknown --client: ${unknown.join(', ')} (expected ${CLIENTS.join(', ')} or all)`);
    process.exit(2);
  }
  return { ...opts, wanted };
}

// TOML basic strings need escaped backslashes; JSON.stringify produces exactly that.
const tomlString = (value) => JSON.stringify(value);

function main() {
  const { root, wanted } = parseArgs(process.argv.slice(2));
  const entry = path.join(root, 'dist', 'index.js');
  if (!existsSync(entry)) {
    console.error(`not built: ${entry}\nRun "npm ci --ignore-scripts && npm run build" in ${root} first.`);
    process.exit(1);
  }

  const nodeCommand = process.execPath;
  const isWindows = process.platform === 'win32';
  const defaultWizTree = 'C:\\Program Files\\WizTree\\WizTree64.exe';
  const wizTreePath = isWindows && existsSync(defaultWizTree) ? defaultWizTree : undefined;

  const notes = [];
  if (wizTreePath) {
    notes.push(`WIZTREE_PATH points at the detected WizTree install: ${wizTreePath}`);
  } else if (isWindows) {
    notes.push(`WIZTREE_PATH is omitted because ${defaultWizTree} was not found; set it if WizTree lives elsewhere.`);
  } else {
    notes.push('Non-Windows host: scans use the native metadata backend, so WIZTREE_PATH is not emitted.');
  }

  const env = { WIZTREE_MCP_DISABLE_CLEANUP: '1' };
  if (wizTreePath) env.WIZTREE_PATH = wizTreePath;

  const blocks = [];
  const push = (label, detail, text) => blocks.push({ label, detail, text });

  if (wanted.includes('codex')) {
    const lines = [
      '[mcp_servers.wiztree]',
      `command = ${tomlString(nodeCommand)}`,
      `args = [${tomlString(entry)}]`,
      'startup_timeout_sec = 120',
      'tool_timeout_sec = 600',
      '',
      '[mcp_servers.wiztree.env]',
      ...Object.entries(env).map(([key, value]) => `${key} = ${tomlString(value)}`),
    ];
    push('~/.codex/config.toml', 'restart Codex, then confirm the server with /mcp', lines.join('\n'));
  }

  const mcpServersJson = (extra) =>
    JSON.stringify(
      {
        mcpServers: {
          wiztree: { type: 'stdio', command: nodeCommand, args: [entry], env, ...extra },
        },
      },
      null,
      2,
    );

  if (wanted.includes('cc-switch')) {
    push(
      'cc-switch "paste config" box',
      'tick the target apps under "write to"; client-native timeout fields pass through verbatim',
      mcpServersJson({ startup_timeout_sec: 120, tool_timeout_sec: 600 }),
    );
  }

  if (wanted.includes('claude')) {
    push('~/.claude.json or claude_desktop_config.json', 'check with: claude mcp list', mcpServersJson({}));
  }

  if (wanted.includes('gemini')) {
    push(
      '~/.gemini/settings.json',
      'timeout is in milliseconds',
      JSON.stringify(
        { mcpServers: { wiztree: { command: nodeCommand, args: [entry], env, timeout: 600000 } } },
        null,
        2,
      ),
    );
  }

  console.log(`# wiztree-mcp registration for ${root}`);
  console.log('# Copy one block as is: every path below is already absolute.');
  for (const note of notes) console.log(`# ${note}`);
  console.log('');
  for (const block of blocks) {
    console.log(`# ${block.label} - ${block.detail}`);
    console.log(block.text);
    console.log('');
  }
}

main();
