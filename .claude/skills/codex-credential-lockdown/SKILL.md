---
name: codex-credential-lockdown
description: Restrict codex agents to credentials held in the OneCLI vault by disabling codex's Apps/Connectors bridge and remote plugins, and by forwarding the proxy + CA env into every MCP server codex spawns. Use when a codex agent reaches a third-party service (Notion, GitHub, Linear, ...) with an account grant NanoClaw never issued, or after an upstream update touches container/Dockerfile or container/agent-runner/src/index.ts, or codex-credential-lockdown.test.ts goes red.
---

# Codex credential lockdown

Makes the OneCLI vault the **only** way a codex agent can authenticate to a
third party.

**Re-run this after any upstream update that touches `container/Dockerfile` or
`container/agent-runner/src/index.ts`.** Both are upstream-owned, so a merge
can drop these edits, and nothing fails loudly when it does: the agent simply
regains an out-of-band credential path. The shipped test is the alarm: if it
goes red, the wiring was lost.

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

### 2. Feature flags: codex's managed config, baked into the image

Codex reads `/etc/codex/managed_config.toml` as its **managed** layer. It
outranks `$CODEX_HOME/config.toml` (which NanoClaw regenerates on every spawn)
and `-c` overrides, so nothing inside the container can switch these back on.

```bash
cp "${CLAUDE_SKILL_DIR}/files/codex-managed-config.toml" container/codex-managed-config.toml
```

In `container/Dockerfile`, just above the `# ---- Entrypoint` block:

```dockerfile
# ---- Codex credential lockdown (fork: codex-credential-lockdown skill) -------
# Managed config outranks the per-spawn config.toml and `-c` flags.
COPY codex-managed-config.toml /etc/codex/managed_config.toml
```

`apps` is the ChatGPT-account connector bridge; `plugins`/`remote_plugin` are
remote MCP plugins carrying their own OAuth (the cached Notion one points at
`https://mcp.notion.com/mcp`). All three are stage `stable`, default `true`.
Verified on codex 0.146.0: with the file in place `codex features list` shows
all three `false`, even with `config.toml` setting them `true` and with
`-c features.apps=true`. (`connectors` is a deprecated alias for `apps`.)

**Hardened (pulled) images skip the Dockerfile.** On such an install this half
needs the file in the published image instead; the gateway rules in step 1
still hold on their own.

### 3. MCP gateway env: a fork-owned module, called from `index.ts`

```bash
cp "${CLAUDE_SKILL_DIR}/files/mcp-gateway-env.ts" container/agent-runner/src/mcp-gateway-env.ts
```

In `container/agent-runner/src/index.ts`, import it next to the
`McpServerConfig` type import:

```ts
import { withMcpGatewayEnv } from './mcp-gateway-env.js';
```

and pass the servers through it where the provider is created:

```ts
  const provider = createProvider(providerName, {
    assistantName: config.assistantName || undefined,
    // Fork: codex-credential-lockdown — route codex's MCP servers through the gateway.
    mcpServers: withMcpGatewayEnv(providerName, mcpServers),
```

`withMcpGatewayEnv` merges the proxy + CA env into each stdio server's `env`
**last** (a plugin-declared `HTTPS_PROXY` must never shadow the real one) and
returns the map unchanged for any provider other than codex. The codex
provider's renderer already writes each server's `env` into
`[mcp_servers.<name>.env]`, so nothing in the provider needs to change.

**Why not in `codex-app-server.ts`, where this used to live.** That file, like
everything the `/add-codex` skill copies from the `providers` registry branch,
is reinstalled wholesale by `/update-nanoclaw`'s skill refresh, which silently
dropped the old edits. Every piece of this skill now lives in a file the update
*merges* (the Dockerfile, `index.ts`) or one upstream doesn't own at all.

### 4. Tests: the drift alarm

```bash
cp "${CLAUDE_SKILL_DIR}/files/codex-credential-lockdown.test.ts" \
   container/agent-runner/src/codex-credential-lockdown.test.ts
```

It lives at a path upstream doesn't own. It checks the managed config's three
`[features]` lines, the Dockerfile `COPY`, the env merge order, the `index.ts`
call, and that the forwarded env comes out of the real
`renderCodexConfigToml`. Removing the Dockerfile line or the `index.ts` call
turns it red.

### 5. Rebuild and verify

```bash
cd container/agent-runner && bun install --frozen-lockfile && bun test && cd ../..
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
./container/build.sh
docker run --rm --entrypoint codex nanoclaw-agent-<slug>:latest features list | grep -E '^(apps|plugins|remote_plugin) '
ncl groups restart --id <group-id>
```

All three must show `false`. After the next spawn,
`data/v2-sessions/<group-id>/.codex-shared/config.toml` must list the proxy
vars under each stdio `[mcp_servers.*.env]`. Then ask the agent something that
previously used a connector and check the new rollout JSONL contains **no
`codex_apps` calls**.

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
| `codex features list` shows `apps true` in the image | Dockerfile `COPY` lost, or a hardened image was pulled | re-apply step 2; for hardened images see its note |
| Codex errors or retry-loops after the rules | it polls `/backend-api/ps/plugins/list` often and may handle a block badly | `onecli rules update --enabled false` to confirm the cause, then narrow the path pattern |
| MCP server still bypasses the proxy | `[mcp_servers.<name>.env]` has no `HTTPS_PROXY` | the `index.ts` call was lost; re-apply step 3 and re-run the tests |
| Tests red after an upstream merge | exactly what they are for | re-apply this skill |
| Stale connector tools still offered | `.codex-shared/cache/codex_apps_tools/` holds the old catalogue | remove that cache dir and respawn |

The `config.toml` now carries the gateway proxy URL — which includes basic-auth
userinfo — once per MCP server. It is mode 0600 under gitignored `data/`, but it
is readable by any MCP server in that group. Weigh that before adding a
third-party MCP server you do not trust.
