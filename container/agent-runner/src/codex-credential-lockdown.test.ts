/**
 * codex-credential-lockdown — drift alarm.
 *
 * Shipped by .claude/skills/codex-credential-lockdown. Everything it checks
 * lives in files /update-nanoclaw merges rather than reinstalls (Dockerfile,
 * index.ts, a fork-owned module and TOML file), and this test lives at a path
 * upstream does not own, so a merge that drops the wiring fails here instead
 * of silently handing codex agents back their out-of-band credential paths.
 */
import { describe, expect, it } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { MCP_GATEWAY_ENV, withMcpGatewayEnv } from './mcp-gateway-env.js';
import { buildCodexConfigPlan, renderCodexConfigToml } from './providers/codex-app-server.js';
import type { McpServerConfig } from './providers/types.js';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const CONTAINER = path.resolve(SRC, '..', '..');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const GATEWAY = {
  HTTPS_PROXY: 'http://x:tok@host.docker.internal:10255',
  NODE_EXTRA_CA_CERTS: '/tmp/ca.pem',
  UNRELATED: 'not forwarded',
};

describe('codex credential lockdown: account-grant features stay off', () => {
  const managed = read(path.join(CONTAINER, 'codex-managed-config.toml'));
  const features = managed.split(/^\[features\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';

  for (const feature of ['apps', 'plugins', 'remote_plugin']) {
    it(`managed config sets ${feature} = false inside [features]`, () => {
      expect(features).toMatch(new RegExp(`^${feature} = false$`, 'm'));
    });
  }

  it('the image installs it where codex reads managed config', () => {
    expect(read(path.join(CONTAINER, 'Dockerfile'))).toMatch(
      /^COPY codex-managed-config\.toml \/etc\/codex\/managed_config\.toml$/m,
    );
  });
});

describe('codex credential lockdown: MCP servers route through the gateway', () => {
  const servers: Record<string, McpServerConfig> = {
    notion: {
      command: 'npx',
      args: ['notion-mcp'],
      env: { NOTION_TOKEN: 'placeholder', HTTPS_PROXY: 'http://evil:1' },
    },
    docs: { type: 'http', url: 'https://mcp.example.com/mcp' },
  };

  it('merges the gateway env last, so a plugin cannot shadow the proxy', () => {
    const out = withMcpGatewayEnv('codex', servers, GATEWAY);
    const notion = out.notion as { env: Record<string, string> };
    expect(notion.env.HTTPS_PROXY).toBe(GATEWAY.HTTPS_PROXY);
    expect(notion.env.NODE_EXTRA_CA_CERTS).toBe(GATEWAY.NODE_EXTRA_CA_CERTS);
    expect(notion.env.NOTION_TOKEN).toBe('placeholder');
    expect(notion.env.UNRELATED).toBeUndefined();
  });

  it('leaves HTTP servers and other providers alone', () => {
    expect(withMcpGatewayEnv('codex', servers, GATEWAY).docs).toEqual(servers.docs);
    expect(withMcpGatewayEnv('claude', servers, GATEWAY)).toBe(servers);
  });

  it('forwards only the gateway variables', () => {
    expect([...MCP_GATEWAY_ENV]).toContain('HTTPS_PROXY');
    expect([...MCP_GATEWAY_ENV]).not.toContain('UNRELATED');
  });

  it('the forwarded env reaches the real config.toml renderer', () => {
    const toml = renderCodexConfigToml(buildCodexConfigPlan(withMcpGatewayEnv('codex', servers, GATEWAY)));
    const notionEnv = toml.split('[mcp_servers.notion.env]')[1]?.split(/^\[/m)[0] ?? '';
    expect(notionEnv).toContain(`HTTPS_PROXY = "${GATEWAY.HTTPS_PROXY}"`);
  });

  it('index.ts applies it to the servers every provider is built with', () => {
    expect(read(path.join(SRC, 'index.ts'))).toMatch(/mcpServers: withMcpGatewayEnv\(providerName, mcpServers\)/);
  });
});
