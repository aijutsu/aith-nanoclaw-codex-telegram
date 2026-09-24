/**
 * Notion credential management for the OneCLI vault.
 *
 * Notion is not an OAuth app in OneCLI's catalogue (Apps lists gmail, github,
 * google-*, resend), so its credential is a plain `generic` secret with the
 * header injection spelled out. That is easy to get subtly wrong by hand, so
 * this script owns the exact shape.
 *
 * Invocation is via the Makefile (`make add-notion-connection` /
 * `make list-notion-connections` / `make remove-notion-connection`). Everything
 * here is plain Node, `@clack/prompts` and the OneCLI binary, so it behaves the
 * same on Windows, macOS and Ubuntu.
 *
 * Why not `docker exec` into the gateway: the `onecli` container ships only a
 * Node server — it has no `onecli` executable on its PATH, so an exec there
 * fails with "executable file not found". The CLI is a per-platform native
 * binary installed on the host, so we resolve it on the host instead.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as p from '@clack/prompts';

/** Notion's REST API host — what the MCP server calls, so what the secret binds to. */
export const NOTION_HOST = 'api.notion.com';
export const SECRET_NAME = 'Notion';

/** Current tokens are `ntn_`; `secret_` is Notion's legacy internal-integration prefix. */
const TOKEN_PREFIXES = ['ntn_', 'secret_'];

export interface OneCliSecret {
  id: string;
  name: string;
  type?: string;
  hostPattern?: string;
  pathPattern?: string | null;
  injectionConfig?: { headerName?: string; valueFormat?: string } | null;
  createdAt?: string;
  typeLabel?: string;
}

export function isValidNotionToken(token: string): boolean {
  return TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)) && token.length > 10;
}

/**
 * Candidate paths for the OneCLI binary, best first. PATH is scanned
 * explicitly rather than shelling out to `which`/`where`, which do not exist
 * uniformly across the three target platforms.
 */
export function onecliCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[] {
  const exe = platform === 'win32' ? 'onecli.exe' : 'onecli';
  const out: string[] = [];
  if (env.ONECLI_BIN) out.push(env.ONECLI_BIN);
  const sep = platform === 'win32' ? ';' : ':';
  for (const dir of (env.PATH ?? env.Path ?? '').split(sep)) {
    if (dir.trim()) out.push(path.join(dir.trim(), exe));
  }
  if (platform === 'win32') {
    for (const base of [env.LOCALAPPDATA, env.APPDATA].filter(Boolean) as string[]) {
      out.push(path.join(base, 'onecli', exe), path.join(base, 'Programs', 'onecli', exe));
    }
    out.push(path.join(home, '.local', 'bin', exe));
  } else {
    out.push(
      path.join(home, '.local', 'bin', exe),
      '/usr/local/bin/onecli',
      '/opt/homebrew/bin/onecli',
      '/usr/bin/onecli',
    );
  }
  return out;
}

function resolveOnecli(): string {
  for (const candidate of onecliCandidates(process.platform, process.env, os.homedir())) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not there — keep looking */
    }
  }
  throw new Error(
    'Could not find the OneCLI binary.\n' +
      'Install it, or point this script at it with ONECLI_BIN=/path/to/onecli.\n' +
      'Note: `docker exec onecli …` does not work — the gateway container has no CLI inside it.',
  );
}

/** Run onecli and parse its JSON. Never logs argv, which may carry a token. */
function onecliJson(bin: string, args: string[]): unknown {
  const r = spawnSync(bin, args, { encoding: 'utf-8' });
  if (r.error) throw new Error(`Could not run ${bin}: ${r.error.message}`);
  const out = (r.stdout ?? '').trim();
  const err = (r.stderr ?? '').trim();
  if (r.status !== 0) throw new Error(`onecli ${args[0]} ${args[1]} failed:\n${err || out}`);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`onecli returned output that is not JSON:\n${out || err}`);
  }
}

export function secretRows(payload: unknown): OneCliSecret[] {
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: OneCliSecret[] }).data;
  }
  return payload && typeof payload === 'object' ? [payload as OneCliSecret] : [];
}

/**
 * Every secret that looks like the Notion one, host first then name. Removal
 * needs the full list: deleting the first of several would silently orphan the
 * rest, so `remove` refuses to guess and asks for an explicit --id instead.
 */
export function findNotionSecrets(rows: OneCliSecret[], host = NOTION_HOST): OneCliSecret[] {
  const byHost = rows.filter((r) => r.hostPattern === host);
  return byHost.length > 0 ? byHost : rows.filter((r) => r.name?.toLowerCase() === 'notion');
}

export function findNotionSecret(rows: OneCliSecret[], host = NOTION_HOST): OneCliSecret | undefined {
  return findNotionSecrets(rows, host)[0];
}

/**
 * Render the vault for humans. OneCLI's list response carries no value field
 * at all, but we allowlist the columns anyway so a future field that does
 * carry material can never reach a terminal or a screenshot through here.
 */
export function formatSecrets(rows: OneCliSecret[]): string {
  if (rows.length === 0) return 'No secrets in the OneCLI vault yet.';
  // ID last: it is the widest column and only needed to disambiguate, so the
  // human-readable columns stay left-aligned and scannable. It is an opaque
  // handle, not a credential, so printing it is safe.
  const header = ['NAME', 'TYPE', 'HOST PATTERN', 'INJECTS', 'CREATED', 'ID'];
  const body = rows.map((r) => [
    r.name ?? '(unnamed)',
    r.typeLabel ?? r.type ?? '-',
    r.hostPattern ?? '-',
    r.injectionConfig?.headerName ? `${r.injectionConfig.headerName} header` : '-',
    (r.createdAt ?? '').slice(0, 10) || '-',
    r.id ?? '-',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(header), widths.map((w) => '-'.repeat(w)).join('  '), ...body.map(line)].join('\n');
}

/** Read the token without echoing it. Falls back to piped stdin for automation. */
async function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf-8');
  }
  return new Promise<string>((resolve, reject) => {
    stdout.write(question);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    let buf = '';
    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          cleanup();
          stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

/**
 * Hand the token to onecli through a 0600 temp file rather than `--value`,
 * so it never appears in argv where `ps` (or any process lister) would show
 * it to every other user on the box.
 */
function withTokenFile<T>(token: string, fn: (file: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-notion-'));
  const file = path.join(dir, 'token');
  try {
    fs.writeFileSync(file, token, { mode: 0o600 });
    return fn(file);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort — the token file is short-lived and user-scoped */
    }
  }
}

function listSecrets(bin: string): OneCliSecret[] {
  return secretRows(onecliJson(bin, ['secrets', 'list']));
}

async function addConnection(dryRun: boolean): Promise<void> {
  const bin = resolveOnecli();

  const raw = process.env.NOTION_TOKEN ?? (await promptHidden('Notion internal integration token (input hidden): '));
  const token = raw.trim();
  if (!token) throw new Error('No token entered — nothing was changed.');
  if (!isValidNotionToken(token)) {
    throw new Error(
      `That does not look like a Notion integration token (expected it to start with ${TOKEN_PREFIXES.join(' or ')}).\n` +
        'Create one at https://notion.so/profile/integrations — New integration, with read + update + insert content.',
    );
  }

  const existing = findNotionSecret(listSecrets(bin));
  const injection = ['--header-name', 'Authorization', '--value-format', 'Bearer {value}'];

  withTokenFile(token, (file) => {
    const args = existing
      ? ['secrets', 'update', '--id', existing.id, '--file', file, '--host-pattern', NOTION_HOST, ...injection]
      : [
          'secrets',
          'create',
          '--name',
          SECRET_NAME,
          '--type',
          'generic',
          '--file',
          file,
          '--host-pattern',
          NOTION_HOST,
          ...injection,
        ];
    if (dryRun) args.push('--dry-run');
    onecliJson(bin, args);
    console.log(existing ? `Updated the existing "${existing.name}" secret.` : `Created the "${SECRET_NAME}" secret.`);
  });

  if (dryRun) {
    console.log('(dry run — nothing was actually stored)');
    return;
  }

  console.log(`\nNotion is now wired for ${NOTION_HOST}. The gateway injects it per request, so no restart is needed.`);
  console.log('\nStill to do in Notion itself: share the pages with the integration');
  console.log('(open the parent page, then ··· > Connections > pick the integration).');
  console.log('Without that, the token is valid but every call returns object_not_found.');
}

/**
 * Unwrap a clack answer. Ctrl-C / Esc cancels the removal and exits 0 — an
 * abort the operator asked for is not a failure. Mirrors `answered` in
 * setup/uninstall/flow.ts, kept local for the same reason it is there: this
 * script must not pull in the setup tree to ask one question.
 */
function answered<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Cancelled. Nothing was removed.');
    process.exit(0);
  }
  return value as T;
}

/** Default-No, like every destructive confirm in the uninstall flow. */
async function confirmRemoval(prompt: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  return answered(await p.confirm({ message: prompt, initialValue: false }));
}

async function removeConnection(opts: { yes: boolean; dryRun: boolean; id?: string }): Promise<void> {
  // Destructive and interactive: refuse a headless run rather than deleting on
  // an implied yes. Same guard, same escape hatches, as `nanoclaw.sh --uninstall`.
  if (!process.stdin.isTTY && !opts.yes && !opts.dryRun) {
    console.error(
      'Removing a connection needs an interactive terminal. ' +
        'Re-run with --yes to skip the prompt, or --dry-run to preview.',
    );
    process.exit(1);
  }

  const bin = resolveOnecli();
  const all = listSecrets(bin);
  const matches = opts.id ? all.filter((r) => r.id === opts.id) : findNotionSecrets(all);

  if (matches.length === 0) {
    console.log(
      opts.id
        ? `No secret with id ${opts.id} — nothing to remove.`
        : `Notion is not connected (no secret for ${NOTION_HOST}) — nothing to remove.`,
    );
    return; // exit 0: re-running the Make target must not be an error
  }

  if (matches.length > 1) {
    console.error(`${matches.length} secrets match Notion, so I will not guess which to remove:\n`);
    console.error(formatSecrets(matches));
    console.error('\nRe-run naming one explicitly:');
    console.error('  pnpm exec tsx scripts/notion-connection.ts remove --id <id>');
    process.exit(1);
  }

  const target = matches[0];
  // Show the host, not just the name: it is what distinguishes this secret
  // from a same-named one bound elsewhere, and the name match is a fallback.
  console.log('About to remove this secret from the OneCLI vault:\n');
  console.log(formatSecrets([target]));
  console.log();

  if (opts.dryRun) {
    console.log('(dry run — nothing was removed)');
    return;
  }

  const ok = await confirmRemoval(
    `Remove the "${target.name}" secret shown above? (${target.hostPattern ?? 'unknown host'} calls lose their credential)`,
    opts.yes,
  );
  if (!ok) {
    console.log('Left it in place.');
    return;
  }

  onecliJson(bin, ['secrets', 'delete', '--id', target.id]);
  console.log(`\nRemoved "${target.name}".`);
  console.log('The token itself is gone — re-adding needs a fresh copy from notion.so/profile/integrations.');
  console.log('Agents calling that host now get 401 and will prompt for a new setup link.');
}

function listConnections(): void {
  const rows = listSecrets(resolveOnecli());
  console.log(formatSecrets(rows));
  const notion = findNotionSecret(rows);
  console.log(
    notion
      ? `\nNotion: connected (secret "${notion.name}" -> ${notion.hostPattern}).`
      : `\nNotion: not connected. Run \`make add-notion-connection\` to add a token for ${NOTION_HOST}.`,
  );
  console.log('Token values are never stored in or printed by this command.');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'help';
  const dryRun = argv.includes('--dry-run');
  const yes = argv.includes('--yes');
  const idAt = argv.indexOf('--id');
  const id = idAt !== -1 ? argv[idAt + 1] : undefined;

  if (command === 'add') await addConnection(dryRun);
  else if (command === 'list') listConnections();
  else if (command === 'remove') await removeConnection({ yes, dryRun, ...(id ? { id } : {}) });
  else {
    console.log('Usage:');
    console.log('  make add-notion-connection      add or rotate the Notion token in the OneCLI vault');
    console.log('  make list-notion-connections    list vault secrets (never prints token values)');
    console.log('  make remove-notion-connection   remove the Notion secret (asks first)');
    console.log('');
    console.log('Flags (when calling the script directly):');
    console.log('  --dry-run   show what would happen, change nothing');
    console.log('  --yes       skip the confirmation on remove');
    console.log('  --id <id>   target one secret by id (from the ID column of list)');
  }
}

// Only run when invoked directly, so the helpers above stay importable by tests.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
