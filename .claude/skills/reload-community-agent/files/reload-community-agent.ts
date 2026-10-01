/** Operator shortcut for reloading Louis after instruction edits. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { SocketTransport } from '../src/cli/socket-client.js';
import { formatTransportError } from '../src/cli/transport-errors.js';

/** The folder the community-assistant template stamps Louis into. */
export const COMMUNITY_AGENT_FOLDER = 'louis';

/** Sends one CLI command to the running host and returns its data, or throws its error. */
export type CliRequest = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Restart the containers of the one agent group in `folder`; returns the line to print. */
export async function reloadCommunityAgent(request: CliRequest, folder = COMMUNITY_AGENT_FOLDER): Promise<string> {
  const groups = (await request('groups-list')) as Array<{
    id: string;
    name: string;
    folder: string;
  }>;
  const matches = groups.filter((group) => group.folder === folder);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one agent group with folder "${folder}". Check \`pnpm ncl groups list\`.`);
  }
  const group = matches[0];
  const result = (await request('groups-restart', { id: group.id })) as {
    restarted: number;
  };
  return `${group.name}: stopped ${result.restarted} running container(s). Updated instructions will load on the next message.`;
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

// Only run when invoked directly, so the function above stays importable by tests.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  reloadCommunityAgent(socketRequest())
    .then((line) => console.log(line))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
