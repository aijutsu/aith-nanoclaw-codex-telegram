/**
 * Forward the credential gateway's proxy + CA env into every stdio MCP server
 * a codex agent spawns.
 *
 * Installed by .claude/skills/codex-credential-lockdown. Kept out of the codex
 * provider files on purpose: those are reinstalled from the `providers`
 * registry branch on every /update-nanoclaw, which silently dropped this
 * wiring when it lived there.
 *
 * Codex does NOT pass its own environment to the stdio MCP servers it spawns;
 * a child sees only HOME/PATH/TZ plus its `[mcp_servers.<name>.env]` table.
 * Without this, an MCP server reaches the internet directly, bypassing
 * credential injection, approvals and audit, and a placeholder credential it
 * was given stays a placeholder on the wire.
 */
import type { McpServerConfig } from './providers/types.js';

export const MCP_GATEWAY_ENV = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'NODE_USE_ENV_PROXY',
] as const;

/** The gateway env actually present; absent or empty vars are omitted. */
export function mcpGatewayEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const key of MCP_GATEWAY_ENV) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') forwarded[key] = value;
  }
  return forwarded;
}

/**
 * Return `servers` with the gateway env merged into each stdio server's env.
 * Merged LAST: a plugin-declared HTTPS_PROXY must never shadow the real one,
 * or that server routes around credential injection. HTTP servers are left
 * alone; codex makes those requests itself, through its own proxy env.
 * Only codex needs this, so other providers get `servers` back unchanged.
 */
export function withMcpGatewayEnv(
  providerName: string,
  servers: Record<string, McpServerConfig>,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, McpServerConfig> {
  if (providerName !== 'codex') return servers;
  const gatewayEnv = mcpGatewayEnv(source);
  if (Object.keys(gatewayEnv).length === 0) return servers;
  const out: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(servers)) {
    out[name] = config.type === 'http' ? config : { ...config, env: { ...config.env, ...gatewayEnv } };
  }
  return out;
}
