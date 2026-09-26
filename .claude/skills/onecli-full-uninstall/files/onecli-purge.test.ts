import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { oneCliFound, oneCliRows, purgeOneCli, scanOneCli } from './onecli-purge.js';
import type { RunCommand } from './scan.js';

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-onecli-home-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

/** Fake docker that answers list commands from `state` and records every call. */
function fakeDocker(state: { ps: string[]; volumes: string[]; networks: string[]; images: string[] }) {
  const calls: string[][] = [];
  const run: RunCommand = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd !== 'docker') return { status: 1, stdout: '' };
    const out = (ids: string[]) => ({ status: 0, stdout: ids.join('\n') + '\n' });
    if (args[0] === 'ps') return out(state.ps);
    if (args[0] === 'volume' && args[1] === 'ls') return out(state.volumes);
    if (args[0] === 'network' && args[1] === 'ls') return out(state.networks);
    if (args[0] === 'images') return out(state.images);
    return { status: 0, stdout: '' };
  };
  return { run, calls };
}

function seedHostFiles() {
  fs.mkdirSync(path.join(home, '.onecli', 'credentials'), { recursive: true });
  fs.writeFileSync(path.join(home, '.onecli', '.env'), 'NEXTAUTH_SECRET=x\n');
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  for (const name of ['onecli', 'onecli.bak', 'ncl', 'onecli-other']) {
    fs.writeFileSync(path.join(home, '.local', 'bin', name), '');
  }
}

describe('scanOneCli', () => {
  it('finds nothing on a clean machine', () => {
    const { run } = fakeDocker({ ps: [], volumes: [], networks: [], images: [] });
    const inv = scanOneCli({ home, runCommand: run, runtime: 'docker' });
    expect(oneCliFound(inv)).toBe(false);
    expect(inv.runtimeOk).toBe(true);
  });

  it('inventories the compose project by label plus host files', () => {
    seedHostFiles();
    const { run, calls } = fakeDocker({
      ps: ['c1', 'c2'],
      volumes: ['onecli_pgdata', 'onecli_app-data'],
      networks: ['n1'],
      images: ['i1', 'i1'],
    });
    const inv = scanOneCli({ home, runCommand: run, runtime: 'docker' });

    expect(calls).toContainEqual(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=onecli']);
    expect(inv.containerIds).toEqual(['c1', 'c2']);
    expect(inv.volumes).toEqual(['onecli_pgdata', 'onecli_app-data']);
    expect(inv.imageIds).toEqual(['i1']);
    expect(inv.configDir).toBe(path.join(home, '.onecli'));
    expect(inv.binaries.map((b) => path.basename(b)).sort()).toEqual(['onecli', 'onecli.bak']);
    expect(oneCliRows(inv, (p) => p).map((r) => r.what)).toContain('Vault database & app data');
  });

  it('degrades when docker is unavailable but still finds host files', () => {
    seedHostFiles();
    const run: RunCommand = () => ({ status: 1, stdout: '' });
    const inv = scanOneCli({ home, runCommand: run, runtime: 'docker' });
    expect(inv.runtimeOk).toBe(false);
    expect(oneCliFound(inv)).toBe(true);
  });
});

describe('purgeOneCli', () => {
  it('removes containers before volumes, then network, image and host files', () => {
    seedHostFiles();
    const state = { ps: ['c1'], volumes: ['onecli_pgdata'], networks: ['n1'], images: ['i1'] };
    const { run, calls } = fakeDocker(state);
    const inv = scanOneCli({ home, runCommand: run, runtime: 'docker' });
    calls.length = 0;

    const logs: string[] = [];
    const { notes } = purgeOneCli(inv, { runCommand: run, log: (l) => logs.push(l) });

    const removals = calls.filter((c) => ['rm', 'volume', 'network', 'rmi'].includes(c[1]) && !c.includes('ls'));
    expect(removals).toEqual([
      ['docker', 'rm', '-f', 'c1'],
      ['docker', 'volume', 'rm', '-f', 'onecli_pgdata'],
      ['docker', 'network', 'rm', 'n1'],
      ['docker', 'rmi', '-f', 'i1'],
    ]);
    expect(notes).toEqual([]);
    expect(fs.existsSync(path.join(home, '.onecli'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'onecli'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'onecli.bak'))).toBe(false);
    // Unrelated binaries survive.
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'ncl'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'onecli-other'))).toBe(true);
  });

  it('turns a failed removal into a retry note and keeps going', () => {
    seedHostFiles();
    const run: RunCommand = (_cmd, args) => {
      if (args[0] === 'volume' && args[1] === 'rm') return { status: 1, stdout: '' };
      if (args[0] === 'volume' && args[1] === 'ls') return { status: 0, stdout: 'onecli_pgdata\n' };
      return { status: 0, stdout: '' };
    };
    const inv = scanOneCli({ home, runCommand: run, runtime: 'docker' });
    const { notes } = purgeOneCli(inv, { runCommand: run, log: () => {} });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('docker volume rm -f onecli_pgdata');
    expect(fs.existsSync(path.join(home, '.onecli'))).toBe(false);
  });
});
