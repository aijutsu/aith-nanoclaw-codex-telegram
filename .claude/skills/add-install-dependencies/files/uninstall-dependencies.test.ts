import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// uninstall-dependencies.sh is the mirror of install-dependencies.sh, and the
// only thing standing between a student and a wrongly-removed system tool is
// its classifier. So the interesting group here is not "does it parse" but
// "does it refuse to claim what isn't ours" — driven hermetically through
// --check against stubbed tools, never against the machine running the suite.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(root, 'uninstall-dependencies.sh');
const PAYLOAD_DIR = path.join(root, '.claude/skills/add-install-dependencies/files');

const script = readFileSync(SCRIPT, 'utf-8');
const lines = script.split('\n');
// Assertions run against code, not prose: this script's comments discuss the
// commands it must never run, and a commented-out command must not satisfy a
// check either.
const code = lines.filter((l) => !/^\s*#/.test(l)).join('\n');

const make = (...args: string[]) => execFileSync('make', args, { cwd: root, encoding: 'utf-8' });

// ─── the --check harness ─────────────────────────────────────────────────────
//
// A fake HOME, a fake PATH and a stub `brew` whose answers come from env vars.
// Nothing here touches the real machine, so the same expectations hold on a
// maintainer's laptop and in CI.

interface Fixture {
  /** Formula names the stub brew claims to own. */
  formulae?: string[];
  /** Cask names the stub brew claims to own. */
  casks?: string[];
  /** Tools to put on PATH as stubs: name -> subdirectory of the fake HOME. */
  onPath?: Record<string, string>;
  /** Absolute-ish paths (relative to fake HOME) to create as executables. */
  homeFiles?: string[];
  /** Written to <checkout>/logs/install-deps/handoff.json when present. */
  installedByThisRun?: string[];
  /** Writes a ~/.zprofile carrying the installer's marker block. */
  profileMarker?: boolean;
}

function runCheck(fx: Fixture): { stdout: string; status: number } {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ncl-uninst-'));
  const home = path.join(tmp, 'home');
  const bin = path.join(tmp, 'bin');
  const checkout = path.join(tmp, 'checkout');
  for (const d of [home, bin, checkout]) mkdirSync(d, { recursive: true });

  // A minimal thing that satisfies is_nanoclaw_checkout().
  writeFileSync(path.join(checkout, 'nanoclaw.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(checkout, 'package.json'), '{}\n');

  if (fx.installedByThisRun) {
    const dir = path.join(checkout, 'logs/install-deps');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'handoff.json'),
      JSON.stringify({ version: '1.0.0', installed_by_this_run: fx.installedByThisRun }, null, 2),
    );
  }

  if (fx.profileMarker) {
    writeFileSync(
      path.join(home, '.zprofile'),
      [
        'export EDITOR=vim',
        // The user's own brew line, which must survive untouched.
        'eval "$(/opt/homebrew/bin/brew shellenv)"',
        '',
        '# Added by NanoClaw install-dependencies.sh',
        'eval "$(/opt/homebrew/bin/brew shellenv)"',
        '',
      ].join('\n'),
    );
  }

  const stub = (dir: string, name: string, body: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };

  // The stub brew answers only the four queries the classifier makes.
  stub(
    bin,
    'brew',
    [
      'case "$1 $2" in',
      '  "list --formula")',
      '    if [ "$3" = "--versions" ]; then',
      '      for f in $STUB_FORMULAE; do [ "$f" = "$4" ] && { echo "$4 1.0"; exit 0; }; done',
      '      exit 1',
      '    fi',
      '    for f in $STUB_FORMULAE; do echo "$f"; done; exit 0 ;;',
      '  "list --cask")',
      '    if [ "$3" = "--versions" ]; then',
      '      for c in $STUB_CASKS; do [ "$c" = "$4" ] && { echo "$4 2.0"; exit 0; }; done',
      '      exit 1',
      '    fi',
      '    for c in $STUB_CASKS; do echo "$c"; done; exit 0 ;;',
      'esac',
      'case "$1" in --prefix) echo "$STUB_BREW_PREFIX"; exit 0 ;; shellenv) exit 0 ;; esac',
      'exit 1',
    ].join('\n'),
  );

  for (const [name, dir] of Object.entries(fx.onPath ?? {})) {
    stub(path.join(home, dir), name, 'echo "v1.0.0"');
  }
  for (const f of fx.homeFiles ?? []) {
    stub(path.dirname(path.join(home, f)), path.basename(f), 'echo "v1.0.0"');
  }

  // Version-manager bins come first, exactly as they would in a real shell.
  const pathDirs = [...Object.values(fx.onPath ?? {}).map((d) => path.join(home, d)), bin, '/usr/bin', '/bin'];

  const res = execFileSync('/bin/bash', [SCRIPT, '--check', '--dir', checkout], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: home,
      PATH: pathDirs.join(':'),
      NO_COLOR: '1',
      TERM: 'dumb',
      NANOCLAW_BREW_BIN: path.join(bin, 'brew'),
      STUB_FORMULAE: (fx.formulae ?? []).join(' '),
      STUB_CASKS: (fx.casks ?? []).join(' '),
      STUB_BREW_PREFIX: path.join(tmp, 'brewprefix'),
    },
  });
  return { stdout: res, status: 0 };
}

/** The verdict the report gives a label: 'ours' | 'foreign' | 'absent'. */
function verdict(stdout: string, label: string): 'ours' | 'foreign' | 'absent' {
  const ours = stdout.slice(stdout.indexOf('Installed for NanoClaw'), stdout.indexOf('Leaving alone'));
  const foreign = stdout.slice(stdout.indexOf('Leaving alone'));
  const row = new RegExp(`^\\s+[-·]\\s+${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'm');
  if (stdout.includes('Installed for NanoClaw') && row.test(ours)) return 'ours';
  if (stdout.includes('Leaving alone') && row.test(foreign)) return 'foreign';
  return 'absent';
}

describe('uninstall make target', () => {
  // A behaviour test, not a regex over the Makefile: this also goes red if the
  // recipe is indented with spaces instead of a tab, which make reports as
  // "missing separator" and is the one authoring fragility here.
  it('runs the uninstaller', () => {
    expect(make('-n', 'uninstall')).toContain('bash uninstall-dependencies.sh');
  });

  // The change is append-only; these six existed before it.
  it.each([
    ['help', 'notion-connection.ts help'],
    ['add-notion-connection', 'notion-connection.ts add'],
    ['list-notion-connections', 'notion-connection.ts list'],
    ['remove-notion-connection', 'notion-connection.ts remove'],
    ['reload-community-agent', 'reload-community-agent.ts'],
    ['install-deps', 'bash install-dependencies.sh'],
  ])('leaves the %s target working', (target, expected) => {
    expect(make('-n', target)).toContain(expected);
  });
});

describe('classification', () => {
  it('claims a Homebrew cask it installed', () => {
    const { stdout } = runCheck({ casks: ['codex'] });
    expect(verdict(stdout, 'Codex (Homebrew cask)')).toBe('ours');
  });

  it('refuses a Node managed by a version manager', () => {
    // The installer never installs into nvm's tree — faced with a version
    // manager it declines and prints that manager's own upgrade command — so
    // an nvm Node is never ours, even with node@24 in the formula list.
    const { stdout } = runCheck({
      formulae: ['node@24'],
      onPath: { node: '.nvm/versions/node/v24.12.0/bin' },
    });
    expect(verdict(stdout, 'Node.js')).toBe('foreign');
    expect(stdout).toContain('managed by nvm');
  });

  it('refuses a pnpm living under a version manager', () => {
    // The regression that shipped in the first draft: `npm config get prefix`
    // reports the ACTIVE Node's prefix, which is inside nvm when Node comes
    // from nvm, so an npm-prefix rule alone claims somebody else's pnpm.
    const { stdout } = runCheck({
      onPath: { node: '.nvm/versions/node/v24.12.0/bin', pnpm: '.nvm/versions/node/v24.12.0/bin' },
    });
    expect(verdict(stdout, 'pnpm')).toBe('foreign');
  });

  it('refuses a git that Homebrew does not own', () => {
    const { stdout } = runCheck({ formulae: [] });
    expect(verdict(stdout, 'git')).not.toBe('ours');
  });

  it('claims a Homebrew-owned jq', () => {
    const { stdout } = runCheck({ formulae: ['jq'] });
    expect(verdict(stdout, 'jq')).toBe('ours');
  });

  it('never claims make, even when Homebrew owns a make formula', () => {
    // make arrives with Command Line Tools or build-essential and the whole
    // toolchain compiles against it. There is no evidence that makes it safe
    // to offer, so the classifier has no path to `ours` for it at all.
    const { stdout } = runCheck({ formulae: ['make'] });
    expect(verdict(stdout, 'Make')).not.toBe('ours');
  });

  it('claims the Codex binary at the path the course installs to', () => {
    const { stdout } = runCheck({ homeFiles: ['.local/bin/codex'] });
    expect(verdict(stdout, 'Codex (~/.local/bin)')).toBe('ours');
  });

  it('reports both Codex copies separately when both exist', () => {
    // PATH only ever shows one of them, so a single row would silently leave
    // the other behind.
    const { stdout } = runCheck({ casks: ['codex'], homeFiles: ['.local/bin/codex'] });
    expect(verdict(stdout, 'Codex (Homebrew cask)')).toBe('ours');
    expect(verdict(stdout, 'Codex (~/.local/bin)')).toBe('ours');
  });

  it('changes nothing and exits 0', () => {
    const { stdout } = runCheck({ casks: ['orbstack'] });
    expect(stdout).toContain('Nothing was changed.');
  });
});

describe('the installer record demotes, never promotes', () => {
  // handoff.json is only ever allowed to take a tool OUT of the removable
  // set. Promoting on it would be unsafe: a record saying "we installed node"
  // says nothing about the nvm-managed node answering `node` today.
  it('demotes a brew-owned tool the record does not name', () => {
    const { stdout } = runCheck({ casks: ['codex'], installedByThisRun: ['git'] });
    expect(verdict(stdout, 'Codex (Homebrew cask)')).toBe('foreign');
    expect(stdout).toContain('installed before NanoClaw');
  });

  it('keeps a brew-owned tool the record does name', () => {
    const { stdout } = runCheck({ casks: ['codex'], installedByThisRun: ['codex'] });
    expect(verdict(stdout, 'Codex (Homebrew cask)')).toBe('ours');
  });

  it('demotes everything when the record names nothing', () => {
    // The installer ran and installed nothing, so nothing is ours.
    const { stdout } = runCheck({ casks: ['codex'], formulae: ['jq'], installedByThisRun: [] });
    expect(verdict(stdout, 'Codex (Homebrew cask)')).toBe('foreign');
    expect(verdict(stdout, 'jq')).toBe('foreign');
  });

  it('falls back to live classification with no record at all', () => {
    const { stdout } = runCheck({ casks: ['codex'] });
    expect(verdict(stdout, 'Codex (Homebrew cask)')).toBe('ours');
  });
});

describe('the profile marker is Homebrew’s only provenance', () => {
  // persist_brew_shellenv is reached from exactly one place — inside
  // install_brew — while probe_brew only calls load_brew_env, which fixes
  // PATH for one process and writes nothing. So the marker proves this
  // installer installed Homebrew, and its absence proves it did not.
  it('finds the marked block and offers only it', () => {
    const { stdout } = runCheck({ profileMarker: true });
    expect(verdict(stdout, 'Shell profile line')).toBe('ours');
  });

  it('offers nothing when no profile carries the marker', () => {
    const { stdout } = runCheck({});
    expect(verdict(stdout, 'Shell profile line')).toBe('absent');
  });

  it('tells the user which way round it is before asking about Homebrew', () => {
    const fn = code.slice(code.indexOf('offer_homebrew() {'), code.indexOf('closing() {'));
    expect(fn).toContain('BREW_FROM_INSTALLER');
    // Stated before the question, not after it.
    expect(fn.indexOf('BREW_FROM_INSTALLER')).toBeLessThan(fn.indexOf('confirm_word'));
  });

  it('captures the signal at classification time, not at question time', () => {
    // Phase 5 can remove the marker before the Homebrew question is reached,
    // so reading the file again there would always report "already here".
    expect(code).toMatch(/BREW_FROM_INSTALLER=true\n\s+t_add profile/);
  });
});

describe('the installer publishes the record', () => {
  const installer = readFileSync(path.join(root, 'install-dependencies.sh'), 'utf-8');

  it('tracks what this run installed separately from what was present', () => {
    // `state` cannot express it: a successful install ends as `present`, the
    // same value as "was already here".
    expect(installer).toMatch(/^T_OWNED=\(\)$/m);
    expect(installer).toContain('t_own()');
    expect(installer).toContain('"installed_by_this_run"');
  });

  it('records ownership on every successful install path', () => {
    // Including the two that end `manual` — Docker's GUI first run and the
    // Command Line Tools window. The install command itself succeeded.
    const runStep = installer.slice(installer.indexOf('run_step() {'));
    expect(runStep.indexOf('t_own "$key"')).toBeGreaterThan(-1);
    expect(runStep.indexOf('t_own "$key"')).toBeLessThan(runStep.indexOf('verify_tool "$key"'));
  });
});

describe('safety invariants', () => {
  it('never removes the checkout it runs from', () => {
    // bash reads a script incrementally as it executes, so deleting the
    // folder from inside is undefined behaviour. The closing report prints
    // the command for the user to run instead — that line starts with `say`.
    const offenders = lines
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => /^\s*rm\s+-rf?\b/.test(l) && /PROJECT_ROOT/.test(l));
    expect(offenders.map(([l, n]) => `${n}: ${l.trim()}`)).toEqual([]);
  });

  it('only ever uninstalls packages the installer installs', () => {
    const allowed = ['node@24', 'orbstack', 'docker-desktop', 'codex', 'jq', 'git'];
    const found = [...code.matchAll(/brew uninstall (?:--(?:formula|cask) )?(\S+)/g)]
      .map((m) => m[1].replace(/['"$]/g, ''))
      .filter((n) => !n.startsWith('{'));
    for (const name of found) expect(allowed).toContain(name);
  });

  it('gates Homebrew behind a typed word, not a y/N', () => {
    const fn = code.slice(code.indexOf('offer_homebrew() {'), code.indexOf('closing() {'));
    expect(fn).toContain('confirm_word');
    // A bare confirm() anywhere in that function would be the bug.
    expect(fn).not.toMatch(/\bconfirm\s+"/);
  });

  it('does not let --yes answer the Homebrew prompt', () => {
    // --yes exists to skip small confirmations; it must not be able to take
    // out an unrelated toolchain.
    const fn = code.slice(code.indexOf('offer_homebrew() {'), code.indexOf('closing() {'));
    expect(fn).not.toContain('OPT_YES');
  });

  it('takes every decision before it removes anything', () => {
    // The property setup/uninstall/plan.ts guarantees for its own half: a
    // Ctrl-C during the questions leaves the machine untouched.
    const main = code.slice(code.indexOf('main() {'));
    expect(main.indexOf('decide')).toBeLessThan(main.indexOf('remove_selected'));
  });

  it('reads provenance before delegating the NanoClaw uninstall', () => {
    // That uninstall deletes logs/, where handoff.json lives.
    const main = code.slice(code.indexOf('main() {'));
    expect(main.indexOf('classify_all')).toBeLessThan(main.indexOf('delegate_nanoclaw'));
  });

  it('scopes the orphan-watcher sweep to this install', () => {
    const fn = code.slice(code.indexOf('sweep_orphan_watchers() {'));
    expect(fn).toContain('nanoclaw-install=$INSTALL_SLUG');
  });

  it('keeps the Codex account when it removes the Codex binary', () => {
    // ~/.codex holds the ChatGPT sign-in and config, which the installer
    // never created. Only the payload under packages/ is removable.
    expect(code).toContain("rm -rf '$HOME/.codex/packages/standalone'");
    expect(code).not.toMatch(/rm -rf '\$HOME\/\.codex'/);
  });
});

describe('shell constraints', () => {
  it('parses under the running bash', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT])).not.toThrow();
  });

  it('parses under /bin/bash, which is 3.2 on macOS', () => {
    expect(() => execFileSync('/bin/bash', ['-n', SCRIPT])).not.toThrow();
  });

  // /bin/bash on macOS is 3.2.57. These all need bash 4+.
  it.each([
    [/declare\s+-A/, 'associative arrays'],
    [/\$\{[A-Za-z_][A-Za-z0-9_]*,,/, 'lowercase expansion ${v,,}'],
    [/\$\{[A-Za-z_][A-Za-z0-9_]*\^\^/, 'uppercase expansion ${v^^}'],
    [/^\s*(mapfile|readarray)\b/m, 'mapfile/readarray'],
    [/&>>/, '&>> redirection'],
  ])('avoids %s', (pattern) => {
    expect(code).not.toMatch(pattern);
  });

  it('reads every prompt from /dev/tty', () => {
    const reads = lines
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => /^\s*read\s/.test(l))
      .filter(([l]) => !/<\s*\/dev\/tty/.test(l));
    expect(reads.map(([l, n]) => `${n}: ${l.trim()}`)).toEqual([]);
  });

  it('never gates interactivity on stdin being a tty', () => {
    const offenders = lines
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => /\[\s*-t\s+0\s*\]/.test(l) && !/^\s*#/.test(l.trim()));
    expect(offenders.map(([l, n]) => `${n}: ${l.trim()}`)).toEqual([]);
  });

  // Same rule and the same regexes as setup/installer-shell.test.ts. Kept here
  // too so the fork stays covered if that upstream file is reverted by a merge.
  it('pipes downloaded installers into an absolute system shell', () => {
    const CURL_PIPE = /curl\b[^|\n]*\|(?!\|)\s*(.+)$/;
    const SYSTEM_SHELL = /^(?:sudo(?:\s+-\S+)*\s+)?\/bin\/(?:sh|bash)(?=\s|$|["'`])/;
    const targets = [
      ...readdirSync(root)
        .filter((f) => f.endsWith('.sh'))
        .map((f) => path.join(root, f)),
      ...readdirSync(PAYLOAD_DIR)
        .filter((f) => f.endsWith('.sh'))
        .map((f) => path.join(PAYLOAD_DIR, f)),
    ];
    const offenders: string[] = [];
    for (const file of targets) {
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          const l = line.trim();
          if (l.startsWith('#') || /^echo\b/.test(l)) return;
          const m = CURL_PIPE.exec(l);
          if (m && !SYSTEM_SHELL.test(m[1])) offenders.push(`${path.relative(root, file)}:${i + 1}: ${l}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('runs Homebrew\u2019s own uninstaller under an absolute shell', () => {
    expect(code).toMatch(/\/bin\/bash -c \\?\n?\s*"\$\(curl -fsSL https:\/\/raw\.githubusercontent\.com\/Homebrew/);
  });

  it('is executable', () => {
    expect(statSync(SCRIPT).mode & 0o111).toBeGreaterThan(0);
  });
});

describe('skill payload', () => {
  // The skill reinstalls these files after an upstream update, so a fix made
  // only to the installed copy would be silently undone on the next apply.
  it.each(['uninstall-dependencies.sh', 'uninstall-dependencies.test.ts'])(
    '%s is identical to the copy the skill installs',
    (name) => {
      const installed = name.endsWith('.sh')
        ? readFileSync(SCRIPT, 'utf-8')
        : readFileSync(path.join(root, 'scripts', name), 'utf-8');
      expect(readFileSync(path.join(PAYLOAD_DIR, name), 'utf-8')).toBe(installed);
    },
  );
});
