import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// install-dependencies.sh performs the course's install lesson. Its commands
// are the course's, verbatim, so the fidelity group below is the alarm that
// goes off when the two drift apart. Nothing can assert the course side from
// here — it lives in another repo — so this guards the half that can be.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(root, 'install-dependencies.sh');
const PAYLOAD_DIR = path.join(root, '.claude/skills/add-install-dependencies/files');

const script = readFileSync(SCRIPT, 'utf-8');
const lines = script.split('\n');
// Assertions run against code, not prose: the script's own comments discuss
// the commands it must never use ("the course deliberately avoids `brew
// install make`"), and a commented-out command must not satisfy a fidelity
// check either.
const code = lines.filter((l) => !/^\s*#/.test(l)).join('\n');

const make = (...args: string[]) =>
  execFileSync('make', args, { cwd: root, encoding: 'utf-8' });

describe('install-deps make target', () => {
  // A behaviour test, not a regex over the Makefile: this also goes red if
  // the recipe is indented with spaces instead of a tab, which make reports
  // as "missing separator" and is the one authoring fragility here.
  it('runs the installer', () => {
    expect(make('-n', 'install-deps')).toContain('bash install-dependencies.sh');
  });

  // The change is append-only; these four existed before it.
  it.each([
    ['help', 'notion-connection.ts help'],
    ['add-notion-connection', 'notion-connection.ts add'],
    ['list-notion-connections', 'notion-connection.ts list'],
    ['remove-notion-connection', 'notion-connection.ts remove'],
    ['reload-community-agent', 'reload-community-agent.ts'],
  ])('leaves the %s target working', (target, expected) => {
    expect(make('-n', target)).toContain(expected);
  });
});

describe('course fidelity', () => {
  // Each string is quoted from course/001-building-agents-with-nanoclaw/
  // 01-installations/. Changing one here without changing the page it came
  // from (or the other way round) is a documentation bug.
  it.each([
    // homebrew
    'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh',
    'sudo apt update && sudo apt install -y build-essential procps curl file git',
    'sudo dnf install -y @development-tools procps-ng curl file git',
    // git + jq
    'brew install git jq',
    'sudo apt install -y jq',
    'sudo dnf install -y jq',
    // docker
    'brew install --cask orbstack',
    'brew install --cask docker-desktop',
    'https://get.docker.com',
    'sudo usermod -aG docker',
    'https://docs.docker.com/desktop/setup/install/windows-install/',
    // make
    'xcode-select --install',
    'sudo apt install -y make',
    'sudo dnf install -y make',
    // node + pnpm
    'brew install node@24',
    'brew link --force node@24',
    'corepack enable --install-directory "$(brew --prefix)/bin" pnpm',
    'npm install -g pnpm@10',
    // codex
    'brew install --cask codex',
    'https://chatgpt.com/codex/install.sh',
    // wsl + clone + handoff
    'wsl --set-version Ubuntu 2',
    'https://github.com/aijutsu/aith-nanoclaw-codex-telegram.git',
    'git clone',
    'bash nanoclaw.sh --agent-provider codex',
  ])('installs with the course command: %s', (cmd) => {
    expect(code).toContain(cmd);
  });

  it.each([
    // Installs gmake and leaves `make` alone — the course says so explicitly.
    [/brew install make\b/, 'brew install make'],
    // The bare `docker` cask was renamed upstream to `docker-desktop`;
    // setup/install-docker.sh still has the stale name.
    [/brew install --cask docker(?!-desktop)/, 'brew install --cask docker'],
    // Too old on supported Ubuntu releases; the course warns against it.
    [/apt(?:-get)? install[^\n]*\bnodejs\b/, 'apt install nodejs'],
  ])('never uses %s', (pattern) => {
    expect(code).not.toMatch(pattern);
  });

  it('never installs Docker Engine inside WSL', () => {
    // On WSL the runtime is Docker Desktop on the Windows side. Reaching the
    // get.docker.com path there is the outcome the course calls wrong.
    const wslBranch = script.slice(
      script.indexOf('  if $IS_WSL; then'),
      script.indexOf('probe_make() {'),
    );
    expect(wslBranch).not.toContain('get.docker.com');
    expect(wslBranch).toContain('docs.docker.com/desktop/setup/install/windows-install/');
  });

  it('does not install bun or claude code on the host', () => {
    // Bun is pinned in container/Dockerfile and lives inside the image.
    expect(code).not.toMatch(/bun\.sh\/install|brew install.*\bbun\b/);
    expect(code).not.toMatch(/claude-code@latest|claude\.ai\/install\.sh/);
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
    // Under `curl | bash` stdin is the script itself, so a prompt on stdin
    // would consume the script or block forever.
    const reads = lines
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => /^\s*read\s/.test(l))
      .filter(([l]) => !/<\s*\/dev\/tty/.test(l));
    expect(reads.map(([l, n]) => `${n}: ${l.trim()}`)).toEqual([]);
  });

  it('never gates interactivity on stdin being a tty', () => {
    // migrate-v2.sh uses `! [ -t 0 ]` to refuse running inside an agent's
    // Bash tool. Here that test would reject every legitimate curl|bash run.
    const offenders = lines
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => /\[\s*-t\s+0\s*\]/.test(l) && !/^\s*#/.test(l.trim()));
    expect(offenders.map(([l, n]) => `${n}: ${l.trim()}`)).toEqual([]);
  });

  // Same rule and the same regexes as setup/installer-shell.test.ts. Kept
  // here too so the fork stays covered if that upstream file is ever
  // reverted by a merge.
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
          const code = line.trim();
          if (code.startsWith('#') || /^echo\b/.test(code)) return;
          const m = CURL_PIPE.exec(code);
          if (m && !SYSTEM_SHELL.test(m[1]))
            offenders.push(`${path.relative(root, file)}:${i + 1}: ${code}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('is executable', () => {
    expect(statSync(SCRIPT).mode & 0o111).toBeGreaterThan(0);
  });
});

describe('skill payload', () => {
  // The skill reinstalls these files after an upstream update, so a fix made
  // only to the installed copy would be silently undone on the next apply.
  it.each(['install-dependencies.sh', 'install-dependencies.test.ts'])(
    '%s is identical to the copy the skill installs',
    (name) => {
      const installed = name.endsWith('.sh')
        ? readFileSync(SCRIPT, 'utf-8')
        : readFileSync(path.join(root, 'scripts', name), 'utf-8');
      expect(readFileSync(path.join(PAYLOAD_DIR, name), 'utf-8')).toBe(installed);
    },
  );
});
