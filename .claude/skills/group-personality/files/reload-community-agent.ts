/**
 * Operator shortcut for reloading a community agent after instruction edits.
 *
 * Stops every container of the group — including any this host process does not
 * own — and queues a conversation reset on each chat session, so the next
 * message is answered by a fresh container reading the freshly composed project
 * document, with no earlier thread to compete with it.
 *
 * It preflights first, because the two ways this silently does nothing are both
 * invisible from the chat: a missing agent image (every spawn fails
 * `image-unavailable`, which the host treats as retryable and so retries
 * forever at warn level), and a `personality.md` the composer drops. On either,
 * this exits non-zero having stopped nothing, rather than promising a reload it
 * cannot deliver.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { CONTAINER_IMAGE, GROUPS_DIR } from '../src/config.js';
import { CONTAINER_RUNTIME_BIN } from '../src/container-runtime.js';
import { PERSONALITY_FILE, PERSONALITY_MAX_BYTES, readGroupPersonality } from '../src/group-personality.js';
import { SocketTransport } from '../src/cli/socket-client.js';
import { formatTransportError } from '../src/cli/transport-errors.js';

/** The folder the community-assistant template stamps Louis into. */
export const COMMUNITY_AGENT_FOLDER = 'louis';

/** Sends one CLI command to the running host and returns its data, or throws its error. */
export type CliRequest = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** `--folder <slug>`, defaulting to the fork's own community agent. */
export function parseFolder(argv: readonly string[]): string {
  const flag = argv.indexOf('--folder');
  if (flag === -1) return COMMUNITY_AGENT_FOLDER;
  const value = argv[flag + 1];
  if (!value || value.startsWith('--')) throw new Error('--folder needs a value, e.g. --folder louis');
  return value;
}

interface GroupRow {
  id: string;
  name: string;
  folder: string;
}

async function resolveGroup(request: CliRequest, folder: string): Promise<GroupRow> {
  const groups = (await request('groups-list')) as GroupRow[];
  const matches = groups.filter((group) => group.folder === folder);
  if (matches.length === 1) return matches[0];

  const known = groups.map((group) => group.folder).join(', ') || '(none)';
  throw new Error(
    matches.length === 0
      ? `No agent group has folder "${folder}". Folders on this install: ${known}. ` +
          'Pass --folder <slug>, or see `pnpm ncl groups list`.'
      : `${matches.length} agent groups share folder "${folder}", which should be unique. See \`pnpm ncl groups list\`.`,
  );
}

/**
 * The image the host would spawn. Checked rather than assumed: a pruned or
 * reset Docker daemon takes it away without touching anything NanoClaw can see,
 * and the resulting failure never reaches the chat.
 */
function assertImagePresent(): void {
  try {
    execFileSync(CONTAINER_RUNTIME_BIN, ['image', 'inspect', CONTAINER_IMAGE], { stdio: 'ignore' });
  } catch {
    throw new Error(
      `Agent image ${CONTAINER_IMAGE} is not present, so no container can start and nothing was stopped.\n` +
        'Build it first:\n' +
        '  ./container/build.sh\n' +
        '(`ncl groups restart --rebuild` cannot do this — it only layers packages onto an existing base image.)',
    );
  }
}

/**
 * The voice has to survive `readGroupPersonality`, or the composer leaves the
 * Personality section out of the project document entirely — the same symptom
 * as a reload that did not happen.
 */
function assertPersonalityReadable(groupDir: string): number {
  const personality = readGroupPersonality(groupDir);
  if (personality) return Buffer.byteLength(personality, 'utf-8');
  throw new Error(
    `${path.join(groupDir, PERSONALITY_FILE)} will not be composed into the project document, so nothing was stopped.\n` +
      `It is missing, empty, a symlink, or larger than ${PERSONALITY_MAX_BYTES} bytes. ` +
      'Check the host log for the warning naming which, then fix the file and re-run.',
  );
}

/**
 * Preflight, then stop every container of the one agent group in `folder` and
 * reset its chat conversations; returns the report to print.
 *
 * Both preflights run before the restart and throw, so a refusal has stopped
 * nothing — the caller's non-zero exit is the whole signal.
 */
export async function reloadCommunityAgent(
  request: CliRequest,
  folder = COMMUNITY_AGENT_FOLDER,
): Promise<string> {
  const group = await resolveGroup(request, folder);
  const groupDir = path.join(GROUPS_DIR, group.folder);

  assertImagePresent();
  const personalityBytes = assertPersonalityReadable(groupDir);

  const result = (await request('groups-restart', { id: group.id, fresh: true })) as {
    restarted: number;
    stoppedUnowned: number;
    cleared: number;
  };

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [
    `${group.name} (${group.folder})`,
    `  image        ${CONTAINER_IMAGE}`,
    `  personality  ${personalityBytes} bytes`,
    `  stopped      ${plural(result.restarted, 'container')} owned, ${result.stoppedUnowned} unowned`,
    `  reset queued ${plural(result.cleared, 'chat session')}`,
    'The next message in each chat starts a fresh conversation on the current instructions.',
  ].join('\n');
}

function socketRequest(): CliRequest {
  const transport = new SocketTransport();
  return async (command, args = {}) => {
    const response = await transport.sendFrame({ id: randomUUID(), command, args }).catch((error: unknown) => {
      throw new Error(formatTransportError(error).trim());
    });
    if (!response.ok) throw new Error(response.error.message);
    return response.data;
  };
}

// Async so a bad --folder rejects rather than throwing past the handler below.
async function main(): Promise<void> {
  const folder = parseFolder(process.argv.slice(2));
  console.log(await reloadCommunityAgent(socketRequest(), folder));
}

// Only run when invoked directly, so the function above stays importable by tests.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
