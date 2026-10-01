/** Operator shortcut for reloading Louis after instruction edits. */
import { randomUUID } from 'node:crypto';

import { SocketTransport } from '../src/cli/socket-client.js';
import { formatTransportError } from '../src/cli/transport-errors.js';

const transport = new SocketTransport();

async function request(command: string, args: Record<string, unknown> = {}) {
  const response = await transport.sendFrame({ id: randomUUID(), command, args }).catch((error: unknown) => {
    throw new Error(formatTransportError(error).trim());
  });
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

async function main(): Promise<void> {
  const groups = (await request('groups-list')) as Array<{
    id: string;
    name: string;
    folder: string;
  }>;
  const matches = groups.filter((group) => group.folder === 'louis');
  if (matches.length !== 1) {
    throw new Error('Expected exactly one agent group with folder "louis". Check `pnpm ncl groups list`.');
  }
  const group = matches[0];
  const result = (await request('groups-restart', { id: group.id })) as {
    restarted: number;
  };
  console.log(
    `${group.name}: stopped ${result.restarted} running container(s). Updated instructions will load on the next message.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
