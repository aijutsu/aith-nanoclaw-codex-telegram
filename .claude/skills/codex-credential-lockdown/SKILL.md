---
name: codex-credential-lockdown
description: Restrict codex agents to credentials held in the OneCLI vault by disabling codex's Apps/Connectors bridge and remote plugins, and by forwarding the proxy + CA env into every MCP server codex spawns. Use when a codex agent reaches a third-party service (Notion, GitHub, Linear, ...) with an account grant NanoClaw never issued, or after an upstream update touches codex-app-server.ts.
---

# Codex credential lockdown

Makes the OneCLI vault the **only** way a codex agent can authenticate to a
third party.

**Re-run this after any upstream update that touches
`container/agent-runner/src/providers/codex-app-server.ts`.** That file is
upstream-owned, so a merge can drop these edits, and nothing fails loudly when
it does — the agent simply regains an out-of-band credential path. The shipped
tests are the alarm: if they go red, the wiring was lost.

## The problem

A codex agent was observed reading *and writing* a Notion workspace with no
credential in the vault. The session rollout showed 15 tool calls on an MCP
server named `codex_apps` — `notion.search`, `notion.fetch`,
`notion.notion-create-database` — all returning `Ok`, while the plugin's own
stdio `notion` server sat idle with `NOTION_TOKEN = "placeholder"`.

**Why no network control can catch this.** Gateway logs showed 507 requests to
`chatgpt.com` and **zero** to any Notion host. The Notion OAuth grant is held
server-side by the linked ChatGPT account: codex asks `chatgpt.com`, and
OpenAI's backend talks to Notion. Nothing Notion-bound ever leaves the
container, so host rules and egress lockdown see nothing to block — and
blocking `chatgpt.com` would kill codex itself.

The cached connector catalogue held **369 tools across 12 services** (GitHub 90,
Linear 74, TickTick 55, Notion 41, Canva 36, Spotify, …), so this is not one
service's problem.

**The second half.** Cutting the bridge alone leaves the agent with *no* path,
because the intended one never worked: codex spawns stdio MCP servers with a
minimal env. Read from `/proc/<pid>/environ` in a live container, the notion
server had only `HOME NOTION_TOKEN PATH PLUGIN_DATA PLUGIN_ROOT TZ` — no
`HTTPS_PROXY`, no CA. Its calls bypassed the gateway entirely and sent
`Bearer placeholder` straight to `api.notion.com`. Both halves are needed.

## Apply

### 1. Gateway rules — the enforcing control

Connector traffic is separable by path from codex's own operation:

| Block | Keep |
|-------|------|
| `/backend-api/ps/*` (`/ps/mcp` is the `codex_apps` bridge) | `/backend-api/codex/*` |
| `/backend-api/plugins/*` | `/backend-api/wham/*` |

```bash
onecli rules create --name "Block codex connectors" \
  --host-pattern chatgpt.com --path-pattern "/backend-api/ps/*" \
  --action block --enabled

onecli rules create --name "Block codex plugin catalog" \
  --host-pattern chatgpt.com --path-pattern "/backend-api/plugins/*" \
  --action block --enabled
```

Omit `--agent-id` so it covers **every** agent — a per-agent rule silently stops
protecting anything the moment a group is recreated. Validate with `--dry-run`
first; `onecli rules list` to confirm.

This is enforcement, not advice: codex's `~/.codex/auth.json` is a sentinel stub
(its JWT `sub` decodes to `onecli-managed`), so codex cannot authenticate to
`chatgpt.com` except through the gateway and cannot route around the rule.

### 2. Reach-in: `container/agent-runner/src/providers/codex-app-server.ts`

`config.toml` is regenerated wholesale on every spawn
(`fs.writeFileSync(configTomlPath, renderCodexConfigToml(...))`), and there is
no DB column or passthrough for extra codex config — so hand-editing that file
is futile. Both changes go in the renderer.

**(a) Two module constants**, above `export interface CodexConfigPlan`:

```ts
const CODEX_DISABLED_FEATURES = ['apps', 'plugins', 'remote_plugin'] as const;

const CODEX_MCP_GATEWAY_ENV = [
  'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'NODE_USE_ENV_PROXY',
] as const;
```

Comment them with *why*: `apps` is the ChatGPT-account connector bridge;
`plugins`/`remote_plugin` are remote MCP plugins carrying their own OAuth (the
cached Notion one points at `https://mcp.notion.com/mcp`). All three are stage
`stable`, default `true` in the pinned codex — verify with
`codex features list -c features.apps=false`, which flips `apps` to `false`.
(`connectors` is a deprecated alias for `apps`; use `apps`.)

**(b) A plan field** on `CodexConfigPlan`, and populate it in
`buildCodexConfigPlan`:

```ts
/** Proxy + CA env forwarded into every stdio MCP server codex spawns. */
mcpGatewayEnv: Record<string, string>;
```

```ts
export function codexMcpGatewayEnvSection(source: NodeJS.ProcessEnv = process.env): CodexConfigPlan['mcpGatewayEnv'] {
  const forwarded: Record<string, string> = {};
  for (const key of CODEX_MCP_GATEWAY_ENV) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') forwarded[key] = value;
  }
  return forwarded;
}
```

**(c) Two edits inside `renderCodexConfigToml`.** In the `[features]` block,
after the existing `memories` line:

```ts
for (const feature of CODEX_DISABLED_FEATURES) lines.push(`${feature} = false`);
```

In the stdio server loop, replace the `config.env` guard so the gateway env is
merged **last** — a plugin-declared `HTTPS_PROXY` must never shadow the real
one, or that server routes around credential injection:

```ts
const env = { ...config.env, ...plan.mcpGatewayEnv };
if (Object.keys(env).length > 0) { /* emit [mcp_servers.<name>.env] from `env` */ }
```

### 3. Tests — the drift alarm

Copy the standalone guard in, which is what makes a lost reach-in loud:

```bash
cp "${CLAUDE_SKILL_DIR}/files/codex-credential-lockdown.test.ts" \
   container/agent-runner/src/providers/codex-credential-lockdown.test.ts
```

It lives at a path upstream does not own, so it **survives the merge that breaks
the wiring** and fails instead of being clobbered alongside it. It drives the
real `renderCodexConfigToml`, never the helpers in isolation, so deleting the
reach-in cannot leave it green — verified by removing both halves, which turns
7 of its 8 tests red.

Then fix up the upstream test file
(`container/agent-runner/src/providers/codex-app-server.test.ts`), which this
reach-in perturbs:

- its exact-bytes test pins every rendered line, so add the three new
  `[features]` entries to the expected output, and pass `mcpGatewayEnv: {}` so
  the bytes stay deterministic on a machine that has a proxy in its own
  environment;
- its `toContain('[features]\nmemories = false')` assertion needs the new lines;
- its "builds every declared configuration capability" test does an exact
  `toEqual` on the plan, so add `mcpGatewayEnv`.

Those three are merge-conflict prone by nature. If a future merge makes them
painful, they can be dropped — the standalone guard above is the one that must
survive.

### 4. Rebuild and verify

```bash
cd container/agent-runner && bun install --frozen-lockfile && bun test
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
./container/build.sh
ncl groups restart --id <group-id>
```

After the next spawn, `data/v2-sessions/<group-id>/.codex-shared/config.toml`
must contain the three `[features]` lines and the proxy vars under each
`[mcp_servers.*.env]`. Then ask the agent something that previously used a
connector and check the new rollout JSONL contains **no `codex_apps` calls**.

## Also required (not code)

The vaulted ChatGPT account is what holds the connector grants.
`setup/providers/codex.ts` already states that session must be **dedicated to
the gateway**. If a personal account was vaulted, disconnect its connectors or
re-vault with a clean account. The controls above hold regardless, but this
removes the underlying grant.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent still calls `codex_apps` | image not rebuilt, or container not respawned | `./container/build.sh`, then restart the group |
| Codex errors or retry-loops after the rules | it polls `/backend-api/ps/plugins/list` often and may handle a block badly | `onecli rules update --enabled false` to confirm the cause, then narrow the path pattern |
| MCP server still bypasses the proxy | `[mcp_servers.<name>.env]` has no `HTTPS_PROXY` | the (c) merge was lost — re-apply and re-run the tests |
| Tests red after an upstream merge | exactly what they are for | re-apply this skill |
| Stale connector tools still offered | `.codex-shared/cache/codex_apps_tools/` holds the old catalogue | remove that cache dir and respawn |

The `config.toml` now carries the gateway proxy URL — which includes basic-auth
userinfo — once per MCP server. It is mode 0600 under gitignored `data/`, but it
is readable by any MCP server in that group. Weigh that before adding a
third-party MCP server you do not trust.
