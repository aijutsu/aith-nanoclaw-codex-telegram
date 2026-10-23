/**
 * Drives `reloadCommunityAgent` through the real CLI dispatcher and a real,
 * migrated test DB, so a renamed `groups-list` / `groups-restart` command, a
 * changed group row shape, or a `groups-restart` payload that stops carrying
 * `stoppedUnowned` / `cleared` goes red.
 *
 * Only two edges are faked: the Docker restart (`container-restart.js`) and the
 * `docker image inspect` the image preflight shells out to. `personality.md` is
 * a real file read by the real `readGroupPersonality`, because the drop rules
 * (absent, empty, oversized, symlink) are the thing the preflight exists for.
 */
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  /** Ordered record of the restart-edge calls, to assert the reset lands before the kill. */
  calls: [] as string[],
  imagePresent: true,
  execFileSync: vi.fn(),
}));

vi.mock('../src/container-runner.js', () => ({
  wakeContainer: vi.fn().mockResolvedValue(undefined),
  isContainerRunning: vi.fn().mockReturnValue(false),
  getActiveContainerCount: vi.fn().mockReturnValue(0),
  killContainer: vi.fn(),
  buildAgentGroupImage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/container-restart.js', () => ({
  restartAgentGroupContainers: vi.fn(async () => {
    state.calls.push('restart');
    return [];
  }),
  stopUnownedGroupContainers: vi.fn(async () => {
    state.calls.push('stop-unowned');
    return 0;
  }),
  clearAgentGroupChatThreads: vi.fn(async () => {
    state.calls.push('clear');
    return 0;
  }),
}));

// Partial mock, for the reason `egress-lockdown.test.ts` gives: anything else in
// the graph importing another `child_process` export must still find it.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: state.execFileSync,
}));

vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual('../src/config.js');
  return {
    ...actual,
    DATA_DIR: '/tmp/nanoclaw-test-reload-community-agent/data',
    GROUPS_DIR: '/tmp/nanoclaw-test-reload-community-agent/groups',
  };
});

const TEST_DIR = '/tmp/nanoclaw-test-reload-community-agent';
const GROUPS_DIR = path.join(TEST_DIR, 'groups');

import {
  clearAgentGroupChatThreads,
  restartAgentGroupContainers,
  stopUnownedGroupContainers,
} from '../src/container-restart.js';
import { dispatch } from '../src/cli/dispatch.js';
// Side-effect import: registers the `groups-*` commands, as the host does.
import '../src/cli/resources/groups.js';
import { closeDb, createAgentGroup, initTestDb, runMigrations } from '../src/db/index.js';
import { COMMUNITY_AGENT_FOLDER, parseFolder, reloadCommunityAgent, type CliRequest } from './reload-community-agent.js';

/** The same path a real approval replay takes: dispatch as the host. */
const hostRequest: CliRequest = async (command, args = {}) => {
  const response = await dispatch({ id: `t-${command}`, command, args }, { caller: 'host' });
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
};

async function addGroup(id: string, folder: string): Promise<void> {
  await createAgentGroup({ id, name: id, folder, agent_provider: null, created_at: new Date().toISOString() });
}

/** A voice of the shape Louis actually writes, so the byte count in the report is real. */
const LOUIS_VOICE = [
  '# Voice',
  '',
  'Warm but brief. Lead with the answer, then the caveat.',
  'Reply in the language the member wrote in; default to English.',
  '',
].join('\n');

function writePersonality(folder: string, content: string): void {
  const dir = path.join(GROUPS_DIR, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'personality.md'), content);
}

describe('reload-community-agent', () => {
  beforeEach(async () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(TEST_DIR, 'data'), { recursive: true });
    fs.mkdirSync(GROUPS_DIR, { recursive: true });
    await runMigrations(await initTestDb());

    state.calls = [];
    state.imagePresent = true;
    state.execFileSync.mockReset().mockImplementation((_bin: string, args: readonly string[]) => {
      if (args[0] === 'image' && args[1] === 'inspect' && !state.imagePresent) {
        throw new Error('No such image');
      }
      return '';
    });
    vi.mocked(restartAgentGroupContainers).mockClear();
    vi.mocked(stopUnownedGroupContainers).mockClear();
    vi.mocked(clearAgentGroupChatThreads).mockClear();
  });

  afterEach(async () => {
    await closeDb();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('stops the louis group, resets its chats, and reports what it did', async () => {
    await addGroup('ag-other', 'other');
    await addGroup('Louis', 'louis');
    writePersonality('louis', LOUIS_VOICE);
    vi.mocked(restartAgentGroupContainers).mockImplementationOnce(async () => {
      state.calls.push('restart');
      return ['sess-dm', 'sess-group'];
    });
    vi.mocked(stopUnownedGroupContainers).mockImplementationOnce(async () => {
      state.calls.push('stop-unowned');
      return 1;
    });
    vi.mocked(clearAgentGroupChatThreads).mockImplementationOnce(async () => {
      state.calls.push('clear');
      return 2;
    });

    const report = await reloadCommunityAgent(hostRequest);

    expect(vi.mocked(restartAgentGroupContainers).mock.calls[0][0]).toBe('Louis');
    expect(report.split('\n')).toEqual([
      'Louis (louis)',
      expect.stringContaining('  image        '),
      `  personality  ${Buffer.byteLength(LOUIS_VOICE.trim(), 'utf-8')} bytes`,
      '  stopped      2 containers owned, 1 unowned',
      '  reset queued 2 chat sessions',
      'The next message in each chat starts a fresh conversation on the current instructions.',
    ]);
  });

  it('queues the conversation reset before the kill, so only a fresh container reads it', async () => {
    await addGroup('Louis', 'louis');
    writePersonality('louis', LOUIS_VOICE);

    await reloadCommunityAgent(hostRequest);

    // Load-bearing order: reset rows must exist before the container dies.
    expect(state.calls).toEqual(['clear', 'restart', 'stop-unowned']);
  });

  it('excludes the containers it just killed from the unowned sweep', async () => {
    await addGroup('Louis', 'louis');
    writePersonality('louis', LOUIS_VOICE);
    vi.mocked(restartAgentGroupContainers).mockImplementationOnce(async () => ['sess-dm', 'sess-group']);

    await reloadCommunityAgent(hostRequest);

    expect(vi.mocked(stopUnownedGroupContainers).mock.calls[0][2]).toEqual(new Set(['sess-dm', 'sess-group']));
  });

  it('singularises the counts so a one-container reload does not read as broken', async () => {
    await addGroup('Louis', 'louis');
    writePersonality('louis', LOUIS_VOICE);
    vi.mocked(restartAgentGroupContainers).mockImplementationOnce(async () => ['sess-dm']);
    vi.mocked(clearAgentGroupChatThreads).mockImplementationOnce(async () => 1);

    const report = await reloadCommunityAgent(hostRequest);

    expect(report).toContain('  stopped      1 container owned, 0 unowned');
    expect(report).toContain('  reset queued 1 chat session');
  });

  it('refuses, and stops nothing, when the agent image is gone', async () => {
    await addGroup('Louis', 'louis');
    writePersonality('louis', LOUIS_VOICE);
    state.imagePresent = false;

    await expect(reloadCommunityAgent(hostRequest)).rejects.toThrow('./container/build.sh');
    expect(state.calls).toEqual([]);
  });

  // The regression the preflight exists for: a dropped personality.md used to
  // report a successful reload through an eleven-day outage.
  it.each([
    ['absent', null],
    ['empty', ''],
    ['whitespace only', '   \n\n  '],
    ['over PERSONALITY_MAX_BYTES', 'x'.repeat(4097)],
  ])('refuses, and stops nothing, when personality.md is %s', async (_label, content) => {
    await addGroup('Louis', 'louis');
    if (content === null) fs.mkdirSync(path.join(GROUPS_DIR, 'louis'), { recursive: true });
    else writePersonality('louis', content);

    await expect(reloadCommunityAgent(hostRequest)).rejects.toThrow(
      'will not be composed into the project document, so nothing was stopped',
    );
    expect(state.calls).toEqual([]);
  });

  it('refuses to guess when no group uses the folder, and names the folders it found', async () => {
    await addGroup('ag-other', 'other');

    await expect(reloadCommunityAgent(hostRequest)).rejects.toThrow(
      'No agent group has folder "louis". Folders on this install: other.',
    );
    expect(state.calls).toEqual([]);
  });

  // `agent_groups.folder` is `TEXT NOT NULL UNIQUE` (migration 001), so the
  // host cannot produce this list and the stub stands in for it. The branch is
  // still worth holding: it is the only thing between a duplicate reaching
  // `groups-list` by any other route and a reload of an arbitrary one of them.
  it('refuses to guess when two groups report the same folder', async () => {
    const duplicates: CliRequest = async (command) => {
      if (command === 'groups-list') {
        return [
          { id: 'Louis', name: 'Louis', folder: 'louis' },
          { id: 'Louis-staging', name: 'Louis-staging', folder: 'louis' },
        ];
      }
      throw new Error(`unexpected command ${command}`);
    };

    await expect(reloadCommunityAgent(duplicates)).rejects.toThrow(
      '2 agent groups share folder "louis", which should be unique.',
    );
    expect(state.calls).toEqual([]);
  });

  it('reloads a non-default group when given its folder', async () => {
    await addGroup('Louis', 'louis');
    await addGroup('Helper', 'helper');
    writePersonality('helper', LOUIS_VOICE);

    const report = await reloadCommunityAgent(hostRequest, 'helper');

    expect(vi.mocked(restartAgentGroupContainers).mock.calls[0][0]).toBe('Helper');
    expect(report.split('\n')[0]).toBe('Helper (helper)');
  });

  describe('parseFolder', () => {
    it.each([
      ['no flag', [], COMMUNITY_AGENT_FOLDER],
      ['explicit value', ['--folder', 'helper'], 'helper'],
      ['value after another flag', ['--verbose', '--folder', 'helper'], 'helper'],
    ])('%s → %s', (_label, argv, expected) => {
      expect(parseFolder(argv as string[])).toBe(expected);
    });

    it.each([
      ['missing value', ['--folder']],
      ['next flag taken as the value', ['--folder', '--verbose']],
    ])('rejects %s', (_label, argv) => {
      expect(() => parseFolder(argv as string[])).toThrow('--folder needs a value');
    });
  });
});
