/**
 * Drives `reloadCommunityAgent` through the real CLI dispatcher and a real,
 * migrated test DB, so a renamed `groups-list` / `groups-restart` command or
 * a changed group row shape goes red. Only the container restart itself (the
 * Docker edge) is faked.
 */
import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/container-restart.js', () => ({
  restartAgentGroupContainers: vi.fn().mockResolvedValue(0),
}));

vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual('../src/config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-test-reload-community-agent' };
});

const TEST_DIR = '/tmp/nanoclaw-test-reload-community-agent';

import { restartAgentGroupContainers } from '../src/container-restart.js';
import { dispatch } from '../src/cli/dispatch.js';
// Side-effect import: registers every resource command, as the host does.
import '../src/cli/resources/index.js';
import { closeDb, createAgentGroup, initTestDb, runMigrations } from '../src/db/index.js';
import { reloadCommunityAgent, type CliRequest } from './reload-community-agent.js';

const hostRequest: CliRequest = async (command, args = {}) => {
  const response = await dispatch({ id: `t-${command}`, command, args }, { caller: 'host' });
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
};

async function addGroup(id: string, folder: string): Promise<void> {
  await createAgentGroup({ id, name: id, folder, agent_provider: null, created_at: new Date().toISOString() });
}

describe('reload-community-agent', () => {
  beforeEach(async () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
    await runMigrations(await initTestDb());
    vi.mocked(restartAgentGroupContainers).mockClear();
  });

  afterEach(async () => {
    await closeDb();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('restarts the group in the louis folder and nothing else', async () => {
    await addGroup('ag-other', 'other');
    await addGroup('Louis', 'louis');
    vi.mocked(restartAgentGroupContainers).mockResolvedValueOnce(2);

    const line = await reloadCommunityAgent(hostRequest);

    expect(restartAgentGroupContainers).toHaveBeenCalledTimes(1);
    expect(vi.mocked(restartAgentGroupContainers).mock.calls[0][0]).toBe('Louis');
    expect(line).toBe('Louis: stopped 2 running container(s). Updated instructions will load on the next message.');
  });

  it('refuses to guess when no group uses the louis folder', async () => {
    await addGroup('ag-other', 'other');

    await expect(reloadCommunityAgent(hostRequest)).rejects.toThrow(
      'Expected exactly one agent group with folder "louis"',
    );
    expect(restartAgentGroupContainers).not.toHaveBeenCalled();
  });
});
