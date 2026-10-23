/**
 * Helpers to stop and respawn an agent group's containers.
 *
 * `restartAgentGroupContainers` handles the sessions this host owns: writes an
 * on_wake message to each, kills the container, then wakes a fresh one via the
 * onExit callback — race-free. `stopUnownedGroupContainers` sweeps the rest, so
 * "restart this group" means every container of it, not just the ones in this
 * process's registry.
 */
import { INSTALL_SLUG } from './config.js';
import { isContainerRunning, killContainer } from './container-runner.js';
import { getSessionDriver } from './drivers/index.js';
import type { SupervisedSnapshot } from './drivers/session-events.js';
import { requestWake } from './request-wake.js';
import { setStopIntent, shadowWrite } from './db/coordination.js';
import { getMessagingGroup } from './db/messaging-groups.js';
import { getSession, getSessionsByAgentGroup } from './db/sessions.js';
import { log } from './log.js';
import { withExistingMailboxSession, writeSessionMessage } from './session-manager.js';

/**
 * Kill all running containers for an agent group and respawn them.
 *
 * Only targets sessions that actually have a running container.
 * If `wakeMessage` is provided, each session gets an on_wake message
 * (picked up only by the fresh container's first poll) and a
 * wake request on exit. Without it, containers are killed and
 * only come back on the next real user message.
 */
export async function restartAgentGroupContainers(
  agentGroupId: string,
  reason: string,
  wakeMessage?: string,
): Promise<string[]> {
  const sessions = (await getSessionsByAgentGroup(agentGroupId)).filter(
    (s) => s.status === 'active' && isContainerRunning(s.id),
  );

  for (const session of sessions) {
    if (wakeMessage) {
      await writeSessionMessage(agentGroupId, session.id, {
        id: `restart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'chat',
        timestamp: new Date().toISOString(),
        platformId: agentGroupId,
        channelType: 'agent',
        threadId: null,
        content: JSON.stringify({
          text: wakeMessage,
          sender: 'system',
          senderId: 'system',
        }),
        onWake: true,
      });
    }
    // Always respawn after the kill when there is anything to process: an
    // explicit wake message, or in-flight messages the dying container had
    // claimed. Without this, a provider switch mid-conversation leaves the
    // claimed messages dark until the next inbound or a slow sweep backoff.
    const hasPending =
      (await withExistingMailboxSession(
        session.agent_group_id,
        session.id,
        (mailbox) => mailbox.countDueMessages() > 0,
      )) ?? false;
    const willRespawn = Boolean(wakeMessage || hasPending);
    // Shadow the respawn plan durably before the kill; the on_wake mechanism
    // stays authoritative. Cleared once the respawn request has been made.
    if (willRespawn) {
      await shadowWrite('stop-intent', () => setStopIntent(session.id, 'respawn_after_stop', new Date().toISOString()));
    }
    killContainer(
      session.id,
      reason,
      willRespawn
        ? () => {
            void (async () => {
              const s = await getSession(session.id);
              if (s) await requestWake(s, 'container-restart');
              await shadowWrite('stop-intent-clear', () => setStopIntent(session.id, null, new Date().toISOString()));
            })();
          }
        : undefined,
    );
  }

  if (sessions.length > 0) {
    log.info('Restarting agent group containers', { agentGroupId, reason, count: sessions.length });
  }
  // The ids, not the count: `killContainer` is fire-and-forget, so a caller that
  // sweeps afterwards has to exclude these BY ID. `isContainerRunning` cannot
  // tell it — by then the kill may already have dropped the entry from
  // `activeContainers`, and the sweep would stop the same container twice.
  return sessions.map((session) => session.id);
}

/**
 * Stop every agent container of this group that the running host does not own.
 *
 * `killContainer` can only reach what is in the host's in-process
 * `activeContainers` map, and `restartAgentGroupContainers` only looks at
 * `active` sessions. Two classes slip through both: a container belonging to a
 * `closed` session, and one left behind by a previous host process or by an
 * adoption whose claim was lost. An operator who asks for a reload to take
 * effect on the next message means those too — a survivor keeps answering with
 * the project document it was spawned with.
 *
 * Scope is the driver's own label listing, the same primitive
 * `adoptRunningSessions` uses: `nanoclaw-install` = this checkout's slug and
 * `nanoclaw-role` = agent (see `LABELS` in `src/drivers/types.ts`), joined here
 * on the group id. Containers belonging to anything else on the runtime —
 * another NanoClaw checkout included, since its slug differs — carry none of
 * those labels and cannot match.
 *
 * `alreadyStopping` is the set `restartAgentGroupContainers` just returned.
 * Excluding it is load-bearing: `killContainer` only schedules the stop, so a
 * container it is still tearing down can already be absent from
 * `activeContainers`, and stopping it a second time races the first — the
 * runtime then fails one of them and the host logs a teardown error for a
 * container that was stopping correctly.
 *
 * Returns the number of containers that were actually alive. Corpses are still
 * torn down (residue a dead host could not clean up) but not counted, because
 * the number exists to tell an operator what stopped answering.
 */
export async function stopUnownedGroupContainers(
  agentGroupId: string,
  reason: string,
  alreadyStopping: ReadonlySet<string> = new Set(),
): Promise<number> {
  let snapshots: SupervisedSnapshot[];
  /* eslint-disable no-catch-all/no-catch-all -- an unreadable listing degrades the sweep; it never fails the reload */
  try {
    snapshots = await getSessionDriver().listSessions(INSTALL_SLUG);
  } catch (err) {
    // The owned sessions above are already stopped, so rethrowing here would
    // report a failed reload where what happened is a partial one.
    log.warn('Could not list sessions to sweep unowned containers', { agentGroupId, reason, err });
    return 0;
  }
  /* eslint-enable no-catch-all/no-catch-all */

  let live = 0;
  for (const { handle, phase } of snapshots) {
    if (handle.key.agentGroupId !== agentGroupId) continue;
    // Ours: killContainer already has it, with the exit callbacks and respawn
    // bookkeeping this sweep deliberately does not replicate.
    if (handle.key.sessionId && alreadyStopping.has(handle.key.sessionId)) continue;
    if (handle.key.sessionId && isContainerRunning(handle.key.sessionId)) continue;
    await handle.stop(reason).catch((err: unknown) => {
      log.warn('Failed to stop unowned container', { agentGroupId, sessionId: handle.key.sessionId, err });
    });
    if (phase !== 'terminal') live += 1;
  }

  if (live > 0) {
    log.info('Stopped agent group containers this host did not own', { agentGroupId, reason, count: live });
  }
  return live;
}

/**
 * Queue a `/clear` on every chat session of a group, so the next container to
 * start drops the provider's stored conversation and opens a fresh one.
 *
 * Call this BEFORE the containers are killed. The rows are written `on_wake`,
 * which only a fresh container's first poll reads
 * (`container/agent-runner/src/mailbox/sqlite/operations.ts`), so a container
 * already past its first poll — including one inside its SIGTERM grace period —
 * cannot consume them, and a later crash-respawn cannot re-clear.
 *
 * The continuation itself lives in `session_state` in the session's
 * `outbound.db`, whose single writer is the container (docs/db.md). The host
 * therefore asks rather than writes: `/clear` is the runner's own documented
 * reset, so this works for every provider rather than reaching into one
 * provider's state.
 *
 * `trigger: true` is load-bearing. A `trigger: false` row rides in the batch's
 * context slots, which keep only the NEWEST rows under the per-prompt cap — a
 * busy group chat could crowd the clear out before any container read it.
 *
 * Routing is the session's own chat, never null: `extractRouting` takes the
 * batch's first non-echo row, so a null-routed clear arriving alongside a real
 * message would decide where that message's reply goes.
 *
 * Task sessions are skipped. Their threads carry run history an operator did
 * not ask to discard, and their instructions refresh from the project document
 * on resume like any other session's.
 */
export async function clearAgentGroupChatThreads(agentGroupId: string): Promise<number> {
  const sessions = (await getSessionsByAgentGroup(agentGroupId)).filter(
    (s) => s.status === 'active' && s.messaging_group_id !== null,
  );

  let cleared = 0;
  for (const session of sessions) {
    const mg = await getMessagingGroup(session.messaging_group_id!);
    if (!mg) {
      log.warn('Skipping thread reset for a session whose messaging group is gone', {
        sessionId: session.id,
        messagingGroupId: session.messaging_group_id,
      });
      continue;
    }
    await writeSessionMessage(agentGroupId, session.id, {
      id: `reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'chat',
      timestamp: new Date().toISOString(),
      platformId: mg.platform_id,
      channelType: mg.channel_type,
      threadId: session.thread_id,
      content: JSON.stringify({ text: '/clear', sender: 'system', senderId: 'system' }),
      onWake: true,
    });
    cleared += 1;
  }

  if (cleared > 0) {
    log.info('Queued conversation reset for agent group chat sessions', { agentGroupId, count: cleared });
  }
  return cleared;
}
