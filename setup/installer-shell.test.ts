import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Downloaded installers must run under the system shell by absolute path.
// `sh` or `bash` resolved through PATH can be a foreign shell: exe.dev images
// put /exe.dev/bin/sh first on PATH, and its builtin lsof always exits 0, which
// makes the OneCLI installer's port probe report every port as busy.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const files = readdirSync(here)
  .filter((f) => (f.endsWith('.sh') || f.endsWith('.ts')) && !f.endsWith('.test.ts'))
  .map((f) => path.join(here, f))
  // Root-level installers (nanoclaw.sh, setup.sh, install-dependencies.sh,
  // migrate-v2.sh, uninstall.sh) run the same downloads under the same rule,
  // and were outside this scan.
  .concat(
    readdirSync(root)
      .filter((f) => f.endsWith('.sh'))
      .map((f) => path.join(root, f)),
  )
  .concat(path.resolve(here, '../.claude/skills/add-onecli/scripts/setup.ts'));

// `|(?!\|)` so a logical OR is not read as a pipe: `apt install … curl file git
// || return 1` names curl as a package and pipes nothing, and `"$(curl …)" ||
// return 1` is a command substitution. Both used to be reported as offenders.
const CURL_PIPE = /curl\b[^|\n]*\|(?!\|)\s*(.+)$/;
const SYSTEM_SHELL = /^(?:sudo(?:\s+-\S+)*\s+)?\/bin\/(?:sh|bash)(?=\s|$|["'`])/;

describe('setup installers', () => {
  it('pipe downloaded scripts into /bin/sh or /bin/bash, never a PATH-resolved shell', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('#') || code.startsWith('//') || code.startsWith('*') || /^echo\b/.test(code)) return;
        const pipe = CURL_PIPE.exec(code);
        if (pipe && !SYSTEM_SHELL.test(pipe[1]))
          offenders.push(`${path.relative(path.resolve(here, '..'), file)}:${i + 1}: ${code}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the OneCLI installer on /bin/sh', () => {
    const src = readFileSync(path.resolve(here, '../.claude/skills/add-onecli/scripts/setup.ts'), 'utf-8');
    expect(src).toMatch(/curl -fsSL onecli\.sh\/install \| \/bin\/sh/);
  });
});
