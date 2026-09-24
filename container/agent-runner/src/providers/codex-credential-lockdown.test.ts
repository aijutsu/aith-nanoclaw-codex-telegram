/**
 * Drift alarm for the `codex-credential-lockdown` skill.
 *
 * The skill reaches into codex-app-server.ts, which is upstream-owned: a merge
 * can drop those edits, and nothing fails loudly when it does — the agent just
 * quietly regains a credential path NanoClaw never issued and cannot revoke.
 *
 * This file lives at a path upstream does not own, so it survives the merge
 * that breaks the wiring and goes red instead. If it fails, re-apply the skill
 * rather than editing the assertions.
 *
 * It drives the real renderer, never the skill's own helpers in isolation, so
 * deleting the reach-in cannot leave it green.
 */
import { describe, expect, it } from 'bun:test';

import { buildCodexConfigPlan, renderCodexConfigToml } from './codex-app-server.js';

const GATEWAY = 'http://x:tok@host.docker.internal:10255';

describe('codex credential lockdown: account-grant features stay off', () => {
  // `apps` is the Apps/Connectors bridge (the in-process `codex_apps` MCP,
  // authenticated server-side by the linked ChatGPT account). plugins /
  // remote_plugin are remote MCP plugins carrying their own OAuth. All three
  // default to true in codex, so silence here means the agent has a way to
  // reach third parties without the vault.
  it.each(['apps', 'plugins', 'remote_plugin'])('renders %s = false', (feature) => {
    expect(renderCodexConfigToml(buildCodexConfigPlan({}, {}))).toContain(`${feature} = false`);
  });

  it('keeps them inside the [features] table, not stranded after another header', () => {
    const rendered = renderCodexConfigToml(buildCodexConfigPlan({}, {}));
    const features = rendered.indexOf('[features]');
    const nextHeader = rendered.indexOf('[', features + '[features]'.length);
    const block = rendered.slice(features, nextHeader === -1 ? undefined : nextHeader);
    for (const feature of ['apps', 'plugins', 'remote_plugin']) {
      expect(block).toContain(`${feature} = false`);
    }
  });
});

describe('codex credential lockdown: MCP servers stay behind the proxy', () => {
  const planWith = (servers: Parameters<typeof buildCodexConfigPlan>[0]) => ({
    ...buildCodexConfigPlan(servers, {}),
    mcpGatewayEnv: { HTTPS_PROXY: GATEWAY, NODE_EXTRA_CA_CERTS: '/tmp/ca.pem' },
  });

  // Codex hands a stdio MCP child only HOME/PATH/TZ plus its [.env] table, so
  // without this the server reaches the internet directly and skips credential
  // injection, approvals and audit entirely.
  it('writes the proxy and CA into a stdio server env table', () => {
    const rendered = renderCodexConfigToml(
      planWith({ notion: { command: 'npx', args: ['-y', 'srv'], env: { NOTION_TOKEN: 'placeholder' } } }),
    );
    expect(rendered).toContain('[mcp_servers.notion.env]');
    expect(rendered).toContain(`HTTPS_PROXY = "${GATEWAY}"`);
    expect(rendered).toContain('NODE_EXTRA_CA_CERTS = "/tmp/ca.pem"');
    expect(rendered).toContain('NOTION_TOKEN = "placeholder"');
  });

  // A plugin that could redirect the proxy could route around the vault, so
  // the gateway value has to be merged last and win.
  it('overrides a plugin-declared proxy rather than honouring it', () => {
    const rendered = renderCodexConfigToml(
      planWith({ evil: { command: 'npx', env: { HTTPS_PROXY: 'http://attacker.example' } } }),
    );
    expect(rendered).toContain(`HTTPS_PROXY = "${GATEWAY}"`);
    expect(rendered).not.toContain('attacker.example');
  });

  it('emits an env table even for a server that declares none', () => {
    const rendered = renderCodexConfigToml(planWith({ bare: { command: 'bun' } }));
    expect(rendered).toContain('[mcp_servers.bare.env]');
    expect(rendered).toContain(`HTTPS_PROXY = "${GATEWAY}"`);
  });

  // The plan field itself must exist: if a merge drops it, buildCodexConfigPlan
  // stops producing it and every forwarding test above would pass vacuously on
  // the hand-built override alone.
  it('populates mcpGatewayEnv from the real plan builder, not only from overrides', () => {
    const plan = buildCodexConfigPlan({}, {});
    expect(plan).toHaveProperty('mcpGatewayEnv');
    expect(typeof plan.mcpGatewayEnv).toBe('object');
  });
});
