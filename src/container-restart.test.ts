import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

vi.mock('./log.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockIsContainerRunning = vi.fn<(id: string) => boolean>();
const mockKillContainer = vi.fn<(id: string, reason: string, onExit?: () => void) => void>();
const mockWakeContainer = vi.fn();
vi.mock('./container-runner.js', () => ({
  isContainerRunning: (...args: unknown[]) => mockIsContainerRunning(args[0] as string),
  killContainer: (...args: unknown[]) =>
    mockKillContainer(args[0] as string, args[1] as string, args[2] as (() => void) | undefined),
  wakeContainer: (...args: unknown[]) => mockWakeContainer(...args),
}));

const mockGetSessionsByAgentGroup = vi.fn();
const mockGetSession = vi.fn();
vi.mock('./db/sessions.js', () => ({
  getSessionsByAgentGroup: (...args: unknown[]) => mockGetSessionsByAgentGroup(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

const mockWriteSessionMessage = vi.fn();
vi.mock('./session-manager.js', () => ({
  writeSessionMessage: (...args: unknown[]) => mockWriteSessionMessage(...args),
  withExistingMailboxSession: (
    _agentGroupId: string,
    _sessionId: string,
    action: (mailbox: { countDueMessages(): number }) => unknown,
  ) => action({ countDueMessages: () => mockCountDueMessages() }),
}));

const mockCountDueMessages = vi.fn((..._args: unknown[]) => 0);

vi.mock('./config.js', () => ({ INSTALL_SLUG: 'slug-a' }));

const mockListSessions = vi.fn();
vi.mock('./drivers/index.js', () => ({
  getSessionDriver: () => ({ listSessions: (...args: unknown[]) => mockListSessions(...args) }),
}));

const mockGetMessagingGroup = vi.fn();
vi.mock('./db/messaging-groups.js', () => ({
  getMessagingGroup: (...args: unknown[]) => mockGetMessagingGroup(...args),
}));

import {
  clearAgentGroupChatThreads,
  restartAgentGroupContainers,
  stopUnownedGroupContainers,
} from './container-restart.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Helpers ---

function makeSession(id: string, agentGroupId: string, status = 'active') {
  return { id, agent_group_id: agentGroupId, status };
}

// --- Tests ---

describe('restartAgentGroupContainers', () => {
  it('skips sessions without a running container', async () => {
    mockGetSessionsByAgentGroup.mockReturnValue([makeSession('s1', 'g1'), makeSession('s2', 'g1')]);
    mockIsContainerRunning.mockReturnValue(false);

    const killed = await restartAgentGroupContainers('g1', 'test');

    expect(killed).toEqual([]);
    expect(mockKillContainer).not.toHaveBeenCalled();
    expect(mockWriteSessionMessage).not.toHaveBeenCalled();
  });

  it('skips non-active sessions', async () => {
    mockGetSessionsByAgentGroup.mockReturnValue([makeSession('s1', 'g1', 'closed')]);
    mockIsContainerRunning.mockReturnValue(true);

    const killed = await restartAgentGroupContainers('g1', 'test');

    expect(killed).toEqual([]);
    expect(mockKillContainer).not.toHaveBeenCalled();
  });

  it('kills running containers and returns count', async () => {
    mockGetSessionsByAgentGroup.mockReturnValue([makeSession('s1', 'g1'), makeSession('s2', 'g1')]);
    mockIsContainerRunning.mockImplementation((id) => id === 's1');

    const killed = await restartAgentGroupContainers('g1', 'test');

    expect(killed).toEqual(['s1']);
    expect(mockKillContainer).toHaveBeenCalledTimes(1);
    expect(mockKillContainer).toHaveBeenCalledWith('s1', 'test', undefined);
  });

  it('does not write wake message when wakeMessage is omitted', async () => {
    mockGetSessionsByAgentGroup.mockReturnValue([makeSession('s1', 'g1')]);
    mockIsContainerRunning.mockReturnValue(true);

    await restartAgentGroupContainers('g1', 'test');

    expect(mockWriteSessionMessage).not.toHaveBeenCalled();
    expect(mockKillContainer).toHaveBeenCalledWith('s1', 'test', undefined);
  });

  it('writes on_wake message and passes onExit callback when wakeMessage is provided', async () => {
    mockGetSessionsByAgentGroup.mockReturnValue([makeSession('s1', 'g1')]);
    mockIsContainerRunning.mockReturnValue(true);

    await restartAgentGroupContainers('g1', 'test', 'Resuming.');

    // Should write an on-wake message
    expect(mockWriteSessionMessage).toHaveBeenCalledTimes(1);
    const [agentGroupId, sessionId, msg] = mockWriteSessionMessage.mock.calls[0];
    expect(agentGroupId).toBe('g1');
    expect(sessionId).toBe('s1');
    expect(msg.onWake).toBe(true);
    expect(JSON.parse(msg.content).text).toBe('Resuming.');

    // Should pass an onExit callback to killContainer
    expect(mockKillContainer).toHaveBeenCalledTimes(1);
    const onExit = mockKillContainer.mock.calls[0][2];
    expect(typeof onExit).toBe('function');
  });

  it('onExit callback calls wakeContainer with refreshed session', async () => {
    mockGetSessionsByAgentGroup.mockReturnValue([makeSession('s1', 'g1')]);
    mockIsContainerRunning.mockReturnValue(true);
    const freshSession = makeSession('s1', 'g1');
    mockGetSession.mockReturnValue(freshSession);

    await restartAgentGroupContainers('g1', 'test', 'Resuming.');

    // Simulate container exit by calling the onExit callback
    const onExit = mockKillContainer.mock.calls[0][2] as () => void;
    onExit();

    expect(mockGetSession).toHaveBeenCalledWith('s1');
    await vi.waitFor(() => expect(mockWakeContainer).toHaveBeenCalledWith(freshSession));
  });

  it('onExit callback does not wake if session no longer exists', async () => {
    mockGetSessionsByAgentGroup.mockReturnValue([makeSession('s1', 'g1')]);
    mockIsContainerRunning.mockReturnValue(true);
    mockGetSession.mockReturnValue(undefined);

    await restartAgentGroupContainers('g1', 'test', 'Resuming.');

    const onExit = mockKillContainer.mock.calls[0][2] as () => void;
    onExit();

    expect(mockWakeContainer).not.toHaveBeenCalled();
  });

  it('handles multiple running sessions with wake message', async () => {
    mockGetSessionsByAgentGroup.mockReturnValue([makeSession('s1', 'g1'), makeSession('s2', 'g1')]);
    mockIsContainerRunning.mockReturnValue(true);

    const killed = await restartAgentGroupContainers('g1', 'test', 'Config updated.');

    expect(killed).toEqual(['s1', 's2']);
    expect(mockKillContainer).toHaveBeenCalledTimes(2);
    expect(mockWriteSessionMessage).toHaveBeenCalledTimes(2);

    // Each session gets its own on-wake message
    expect(mockWriteSessionMessage.mock.calls[0][1]).toBe('s1');
    expect(mockWriteSessionMessage.mock.calls[1][1]).toBe('s2');
  });

  it('wakes even without a wake message when in-flight messages are pending', async () => {
    // A provider switch mid-conversation kills a container holding claimed
    // messages — without an immediate respawn those messages stay dark until
    // the next inbound or a slow sweep backoff.
    mockGetSessionsByAgentGroup.mockReturnValue([makeSession('s1', 'ag1')]);
    mockIsContainerRunning.mockReturnValue(true);
    mockCountDueMessages.mockReturnValue(2);

    await restartAgentGroupContainers('ag1', 'provider switch');

    const onExit = mockKillContainer.mock.calls[0][2] as () => void;
    expect(typeof onExit).toBe('function');
    mockGetSession.mockReturnValue(makeSession('s1', 'ag1'));
    onExit();
    await vi.waitFor(() => expect(mockWakeContainer).toHaveBeenCalled());
  });
});

// --- stopUnownedGroupContainers ---

function makeSnapshot(agentGroupId: string, sessionId: string, phase = 'running') {
  const stop = vi.fn(() => Promise.resolve());
  return { handle: { key: { installSlug: 'slug-a', agentGroupId, sessionId }, stop }, phase, stop };
}

describe('stopUnownedGroupContainers', () => {
  it('stops a running container of the group that this host does not own', async () => {
    const mine = makeSnapshot('g1', 's1');
    mockListSessions.mockResolvedValue([mine]);
    mockIsContainerRunning.mockReturnValue(false);

    const count = await stopUnownedGroupContainers('g1', 'reload');

    expect(mockListSessions).toHaveBeenCalledWith('slug-a');
    expect(mine.stop).toHaveBeenCalledWith('reload');
    expect(count).toBe(1);
  });

  it('leaves another agent group and another install alone', async () => {
    const other = makeSnapshot('g2', 's2');
    mockListSessions.mockResolvedValue([other]);
    mockIsContainerRunning.mockReturnValue(false);

    const count = await stopUnownedGroupContainers('g1', 'reload');

    expect(other.stop).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('leaves a container this host already owns to killContainer', async () => {
    const owned = makeSnapshot('g1', 's1');
    mockListSessions.mockResolvedValue([owned]);
    mockIsContainerRunning.mockImplementation((id: string) => id === 's1');

    const count = await stopUnownedGroupContainers('g1', 'reload');

    expect(owned.stop).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('tears a corpse down without counting it as something that stopped answering', async () => {
    const corpse = makeSnapshot('g1', 's1', 'terminal');
    mockListSessions.mockResolvedValue([corpse]);
    mockIsContainerRunning.mockReturnValue(false);

    const count = await stopUnownedGroupContainers('g1', 'reload');

    expect(corpse.stop).toHaveBeenCalledWith('reload');
    expect(count).toBe(0);
  });

  it('leaves a container the caller is still tearing down alone (double-stop race)', async () => {
    // The shape that bit in practice: killContainer only SCHEDULES the stop, so
    // by the time the sweep runs the entry can already be gone from
    // activeContainers while docker is still stopping it. Stopping it again
    // races the first stop and the runtime fails one of them.
    const stopping = makeSnapshot('g1', 's1');
    mockListSessions.mockResolvedValue([stopping]);
    mockIsContainerRunning.mockReturnValue(false);

    const count = await stopUnownedGroupContainers('g1', 'reload', new Set(['s1']));

    expect(stopping.stop).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('degrades to zero when the listing cannot be read, rather than failing the reload', async () => {
    mockListSessions.mockRejectedValue(new Error('daemon down'));

    await expect(stopUnownedGroupContainers('g1', 'reload')).resolves.toBe(0);
  });
});

// --- clearAgentGroupChatThreads ---

function makeChatSession(
  id: string,
  messagingGroupId: string | null,
  threadId: string | null = null,
  status = 'active',
) {
  return { id, agent_group_id: 'g1', messaging_group_id: messagingGroupId, thread_id: threadId, status };
}

describe('clearAgentGroupChatThreads', () => {
  it('queues one on-wake /clear per chat session, routed to that chat', async () => {
    mockGetSessionsByAgentGroup.mockResolvedValue([makeChatSession('s1', 'mg1', 'thread-7')]);
    mockGetMessagingGroup.mockResolvedValue({ id: 'mg1', channel_type: 'telegram', platform_id: 'telegram:-100' });

    const cleared = await clearAgentGroupChatThreads('g1');

    expect(cleared).toBe(1);
    expect(mockWriteSessionMessage).toHaveBeenCalledTimes(1);
    const [agentGroupId, sessionId, msg] = mockWriteSessionMessage.mock.calls[0];
    expect(agentGroupId).toBe('g1');
    expect(sessionId).toBe('s1');
    expect(msg.onWake).toBe(true);
    expect(msg.channelType).toBe('telegram');
    expect(msg.platformId).toBe('telegram:-100');
    expect(msg.threadId).toBe('thread-7');
    expect(JSON.parse(msg.content)).toMatchObject({ text: '/clear', sender: 'system' });
  });

  it('leaves task sessions and closed sessions untouched', async () => {
    mockGetSessionsByAgentGroup.mockResolvedValue([
      makeChatSession('task', null),
      makeChatSession('closed', 'mg1', null, 'closed'),
    ]);

    const cleared = await clearAgentGroupChatThreads('g1');

    expect(cleared).toBe(0);
    expect(mockWriteSessionMessage).not.toHaveBeenCalled();
  });

  it('skips a session whose messaging group is gone', async () => {
    mockGetSessionsByAgentGroup.mockResolvedValue([makeChatSession('s1', 'mg-gone')]);
    mockGetMessagingGroup.mockResolvedValue(undefined);

    const cleared = await clearAgentGroupChatThreads('g1');

    expect(cleared).toBe(0);
    expect(mockWriteSessionMessage).not.toHaveBeenCalled();
  });
});
