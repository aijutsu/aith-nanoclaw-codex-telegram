/**
 * Fork (onecli-full-uninstall skill): purge the local OneCLI gateway and vault.
 *
 * Upstream's uninstaller deliberately leaves the gateway alone — it can be
 * shared by several NanoClaw copies. This fork wants a full uninstall to leave
 * nothing behind, so the OneCLI application is offered as its own group with
 * its own default-No confirm: the compose project's containers, volumes
 * (the vault database) and network, the OneCLI image, ~/.onecli/, and the
 * `onecli` CLI in ~/.local/bin.
 *
 * Everything is found by the compose project label, not by `docker compose`,
 * so it works without the compose file and without the compose plugin.
 *
 * Same constraints as remove.ts: static imports only, no setup-log writes —
 * this runs while the uninstaller is deleting its own runtime.
 */
import fs from 'fs';
import path from 'path';

import type { RunCommand } from './scan.js';

const PROJECT_LABEL = 'label=com.docker.compose.project=onecli';
const IMAGE_REPO = 'ghcr.io/onecli/onecli';

export interface OneCliInventory {
  runtime: string;
  /** False when the container runtime could not be queried. */
  runtimeOk: boolean;
  containerIds: string[];
  volumes: string[];
  networks: string[];
  imageIds: string[];
  /** ~/.onecli when present. */
  configDir?: string;
  /** `onecli` and any `onecli.*` copies in ~/.local/bin. */
  binaries: string[];
}

export function oneCliFound(inv: OneCliInventory): boolean {
  return (
    inv.containerIds.length +
      inv.volumes.length +
      inv.networks.length +
      inv.imageIds.length +
      inv.binaries.length >
      0 || inv.configDir !== undefined
  );
}

function lines(stdout: string): string[] {
  return [
    ...new Set(
      stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function scanOneCli(deps: { home: string; runCommand: RunCommand; runtime: string }): OneCliInventory {
  const { home, runCommand, runtime } = deps;
  const inv: OneCliInventory = {
    runtime,
    runtimeOk: true,
    containerIds: [],
    volumes: [],
    networks: [],
    imageIds: [],
    binaries: [],
  };

  const list = (args: string[]): string[] => {
    try {
      const res = runCommand(runtime, args);
      if (res.status === 0) return lines(res.stdout);
    } catch {
      // fall through
    }
    inv.runtimeOk = false;
    return [];
  };
  inv.containerIds = list(['ps', '-aq', '--filter', PROJECT_LABEL]);
  if (inv.runtimeOk) {
    inv.volumes = list(['volume', 'ls', '-q', '--filter', PROJECT_LABEL]);
    inv.networks = list(['network', 'ls', '-q', '--filter', PROJECT_LABEL]);
    inv.imageIds = list(['images', '-q', IMAGE_REPO]);
  }

  const configDir = path.join(home, '.onecli');
  if (fs.existsSync(configDir)) inv.configDir = configDir;

  const binDir = path.join(home, '.local', 'bin');
  try {
    for (const name of fs.readdirSync(binDir)) {
      if (name === 'onecli' || name.startsWith('onecli.')) inv.binaries.push(path.join(binDir, name));
    }
  } catch {
    // no ~/.local/bin
  }

  return inv;
}

export function oneCliRows(inv: OneCliInventory, tilde: (p: string) => string): { what: string; where: string }[] {
  const rows: { what: string; where: string }[] = [];
  if (inv.containerIds.length > 0) {
    rows.push({ what: 'OneCLI containers', where: `${inv.containerIds.length} container(s) (compose project onecli)` });
  }
  if (inv.volumes.length > 0) rows.push({ what: 'Vault database & app data', where: inv.volumes.join(', ') });
  if (inv.networks.length > 0) rows.push({ what: 'Docker network', where: `${inv.networks.length} network(s)` });
  if (inv.imageIds.length > 0) rows.push({ what: 'OneCLI image', where: IMAGE_REPO });
  if (inv.configDir) rows.push({ what: 'Config & credentials', where: `${tilde(inv.configDir)}/` });
  for (const b of inv.binaries) rows.push({ what: 'Command-line tool (onecli)', where: tilde(b) });
  return rows;
}

export function oneCliNotes(inv: OneCliInventory): string[] {
  if (inv.runtimeOk) return [];
  return [
    `OneCLI: '${inv.runtime}' unavailable; remove later with: ` +
      `${inv.runtime} ps -aq --filter ${PROJECT_LABEL} | xargs -r ${inv.runtime} rm -f; ` +
      `${inv.runtime} volume ls -q --filter ${PROJECT_LABEL} | xargs -r ${inv.runtime} volume rm`,
  ];
}

/**
 * Containers first (a volume in use can't be removed), then volumes, network,
 * image, and the host files. Re-lists by label at removal time, like
 * rm-containers in remove.ts. Each step is independent; failures become notes.
 */
export function purgeOneCli(
  inv: OneCliInventory,
  deps: { runCommand: RunCommand; log: (line: string) => void },
): { notes: string[] } {
  const { runCommand, log } = deps;
  const rt = inv.runtime;
  const notes: string[] = [];

  const step = (label: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      notes.push(`OneCLI ${label}: failed (${err instanceof Error ? err.message : String(err)}) — re-run to retry.`);
    }
  };
  const relist = (args: string[]): string[] => {
    const res = runCommand(rt, args);
    return res.status === 0 ? lines(res.stdout) : [];
  };
  const remove = (label: string, args: string[], ids: string[], done: string) => {
    if (ids.length === 0) return;
    const res = runCommand(rt, [...args, ...ids]);
    if (res.status === 0) log(done);
    else notes.push(`OneCLI ${label}: not removed — retry with: ${rt} ${args.join(' ')} ${ids.join(' ')}`);
  };

  if (inv.runtimeOk) {
    step('containers', () => {
      const ids = relist(['ps', '-aq', '--filter', PROJECT_LABEL]);
      remove('containers', ['rm', '-f'], ids, `✓ removed ${ids.length} OneCLI container(s)`);
    });
    step('volumes', () => {
      const ids = relist(['volume', 'ls', '-q', '--filter', PROJECT_LABEL]);
      remove('volumes', ['volume', 'rm', '-f'], ids, '✓ removed OneCLI vault & data volumes');
    });
    step('network', () => {
      const ids = relist(['network', 'ls', '-q', '--filter', PROJECT_LABEL]);
      remove('network', ['network', 'rm'], ids, '✓ removed OneCLI network');
    });
    step('image', () => {
      const ids = relist(['images', '-q', IMAGE_REPO]);
      remove('image', ['rmi', '-f'], ids, '✓ removed OneCLI image');
    });
  }
  if (inv.configDir) {
    const dir = inv.configDir;
    step('config', () => {
      fs.rmSync(dir, { recursive: true, force: true });
      log('✓ removed OneCLI config & credentials');
    });
  }
  for (const b of inv.binaries) {
    step('CLI', () => {
      fs.rmSync(b, { force: true });
      log(`✓ removed ${path.basename(b)} command`);
    });
  }

  return { notes };
}
