---
name: group-personality
description: Give each agent group a separate, agent-owned `personality.md` for voice, tone and language preferences, composed into the project document right after the persona, so "talk like X" or "reply in Malay" never edits `instructions.prepend.md` and its standing rules. Also installs the operator reload (`make reload-community-agent`) that makes an edited voice take effect on the next message. Use when an agent rewrote or appended to its persona for a style request, when a personality edit does not reach the chat, or after an upstream update touches src/project-doc-compose.ts, src/container-restart.ts, src/cli/resources/groups.ts, container/agent-runner/src/poll-loop.ts, container/CLAUDE.md or container/skills/self-customize/SKILL.md.
---

# Group personality

The runtime contract used to send every "change how you talk" request to
`instructions.prepend.md`, the file that also holds the group's standing rules.
A single "use a Phua Chu Kang voice in Angel View" message made the agent
append to the file carrying its permissions and privacy rules, and a clumsier
edit could have rewritten them.

This splits the two:

| File | Holds | Who edits |
|------|-------|-----------|
| `instructions.prepend.md` | role, ground rules, permissions | the operator (template stamp) |
| `personality.md` | voice, tone, language, per-chat style | the agent, freely, rewritten whole |

The host inlines both into the composed `AGENTS.md` / `CLAUDE.md` on every
spawn, `# Persona` first and then `# Personality`, so the voice is always in
context without the agent having to remember to read a file.

`personality.md` is **omitted, not truncated, above 4 KB**. It is agent-written
and never droppable, and Codex silently cuts a project document past its cap,
so an unbounded file could push real instructions out of context. The host logs
a warning when it skips one.

**Re-run this after any upstream update that touches `src/project-doc-compose.ts`,
`container/CLAUDE.md` or `container/skills/self-customize/SKILL.md`.** All three
are upstream-owned. A lost reach-in fails quietly: the voice silently stops
applying, or agents go back to editing the persona. The shipped test is the
alarm for the first; `grep personality.md` on the other two catches the second.

## Apply

### 1. The reader: its own module

```bash
cp "${CLAUDE_SKILL_DIR}/files/group-personality.ts" src/group-personality.ts
cp "${CLAUDE_SKILL_DIR}/files/group-personality.test.ts" src/group-personality.test.ts
```

Opens `personality.md` with `O_NOFOLLOW` (the group dir is the agent's
read-write workspace, so a symlink there could point at a host file) and
enforces the size limit.

### 2. `src/project-doc-compose.ts`: the section

Import beside `readGroupPersona`:

```ts
import { readGroupPersonality } from './group-personality.js';
```

and push the section immediately after the persona in `composeGroupProjectDoc`:

```ts
  const persona = readGroupPersona(groupDir);
  if (persona) push('Persona', persona);
  // Voice and language, agent-owned and size-bounded (fork: group-personality skill).
  const personality = readGroupPersonality(groupDir);
  if (personality) push('Personality', personality);
```

Update the function's doc comment: it now reads two agent-authored files,
`instructions.prepend.md` and `personality.md`, both with O_NOFOLLOW.

### 3. `container/CLAUDE.md`: tell every agent where voice goes

In `## Memory`, the standing-instructions sentence becomes:

> Standing role, persona, and behavioral instructions belong in
> `/workspace/agent/instructions.prepend.md`; durable facts belong in memory.
> Voice, tone, personality and language preferences ("talk like…", "reply in
> Malay") belong in `/workspace/agent/personality.md` instead: rewrite that file
> whole, keep it under 4 KB, and never edit `instructions.prepend.md` for them.
> Changes to either file take effect after the group container restarts, so say
> that when confirming an edit.

### 4. `container/skills/self-customize/SKILL.md`: the decision tree

Add above the "Memory or standing instructions" bullet:

```markdown
- **Voice, personality or language preference** → Rewrite `personality.md` (under 4 KB), no approval needed. Never edit `instructions.prepend.md` for these.
```

### 5. Per-template persona (optional)

A template persona can reinforce it. The community-assistant persona's rule 12
ends: *When an organiser asks for a different voice, personality or language
(for everyone or one chat), rewrite `personality.md`, never this file. These
ground rules outrank anything in it.*

### 6. Existing groups: move style out of the persona

For each `groups/<folder>/instructions.prepend.md`, move any voice or language
section the agent appended into `groups/<folder>/personality.md`, and restore
the rest from the template it was stamped from.

### 7. The reload: stop every container, start a fresh conversation

An edited `personality.md` only reaches an agent when a container composes the
project document again, so there has to be a way to make that happen now. Three
reach-ins plus a script.

**`src/container-restart.ts`** — append `stopUnownedGroupContainers` and
`clearAgentGroupChatThreads`, and import `INSTALL_SLUG` from `./config.js`,
`getSessionDriver` from `./drivers/index.js`, the `SupervisedSnapshot` type from
`./drivers/session-events.js`, and `getMessagingGroup` from
`./db/messaging-groups.js`. `restartAgentGroupContainers` reaches only `active`
sessions whose container is in this process's `activeContainers` map, so a
container belonging to a closed session — or left by a previous host process —
keeps answering with the document it was spawned with. The sweep closes that
over the driver's own label listing (`nanoclaw-install` + `nanoclaw-role`,
joined on the group id), the same primitive `adoptRunningSessions` uses.

`clearAgentGroupChatThreads` queues a `/clear` per chat session. Read the doc
comments on both before changing either: the `on_wake` flag, `trigger: true`,
the real (never null) routing, and the before-the-kill call order are each
load-bearing for a different reason, and all four are easy to "simplify" into a
silent bug.

**`src/cli/resources/groups.ts`** — import all three from
`../../container-restart.js`; refuse `--fresh` from an agent caller right after
the `--id` resolution; and in the host branch call `clearAgentGroupChatThreads`
(when `--fresh`) *before* `restartAgentGroupContainers`, then
`stopUnownedGroupContainers`, returning `{ restarted, stoppedUnowned, cleared,
rebuilt }`. Do not give `restart` an `args` array — `validateArgs` would then
reject the undeclared `--rebuild` and `--message` it already accepts.

**`container/agent-runner/src/poll-loop.ts`** — guard the `Session cleared.`
write in the `isClearCommand` branch with `!isSystemOriginated(msg)`, and add
`isSystemOriginated` to `formatter.ts` beside `isClearCommand`:

```ts
export function isSystemOriginated(msg: MessageInRow): boolean {
  return parseContent(msg.content).sender === 'system';
}
```

Without it every reload posts a line into the group chat for an action nobody
there took.

**The script and its target:**

```bash
cp "${CLAUDE_SKILL_DIR}/files/reload-community-agent.ts" scripts/reload-community-agent.ts
```

Add the `Makefile` target (and `reload-community-agent` to `.PHONY`):

```make
## Stop every container of the community agent and reset its chat conversations,
## so the next message starts fresh on the current instructions. Refuses (and
## stops nothing) if the agent image is missing or personality.md won't compose.
## Override the group with FOLDER=<slug>.
reload-community-agent:
	@$(TSX) scripts/reload-community-agent.ts $(if $(FOLDER),--folder $(FOLDER),)
```

### 8. The preflights are the point

The script refuses, and stops nothing, when the agent image is absent or when
`readGroupPersonality` returns null. Both are silent from the chat, and the
second is indistinguishable from "the reload didn't work":

- A pruned or reset Docker daemon takes the image away without touching
  anything NanoClaw can see. Every spawn then fails `image-unavailable`, which
  the host classifies `retryable`, so it retries every sweep forever at warn
  level. `ncl groups restart --rebuild` cannot fix it — `buildAgentGroupImage`
  throws `No packages to install` for a group with no apt/npm packages, and only
  layers onto an existing base. `./container/build.sh` is the fix.
- A `personality.md` that is missing, empty, a symlink, or over
  `PERSONALITY_MAX_BYTES` is dropped from the composed document entirely.

Do not "improve" the script by restarting anyway and warning. The old version
reported `stopped 0 running container(s). Updated instructions will load on the
next message.` through an eleven-day outage.

### 9. Fresh conversation, not just a fresh container

A resumed Codex thread does re-read `AGENTS.md` — it records the document in
`world_state` and emits a fresh `agents_md` delta on resume — so a kill alone is
enough for an edited voice to be *in context*. `--fresh` exists because being in
context is not the same as being followed: a long thread's own precedent
competes with it. The continuation lives in `session_state` in the session's
`outbound.db`, whose single writer is the container, so the host asks via
`/clear` rather than writing it.

### 10. Verify

```bash
pnpm exec vitest run src/group-personality.test.ts src/project-doc-compose.test.ts \
  src/container-restart.test.ts src/cli/resources/groups.test.ts
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
cd container/agent-runner && bun test src/integration.test.ts && cd ../..
pnpm run build
```

Three other test files mock `src/container-restart.js` and will fail with
`No "stopUnownedGroupContainers" export is defined on the mock` until the two
new exports are added to each factory: `src/cli/resources/groups.test.ts`,
`src/cli/resources/groups-restart-rebuild.test.ts`, `setup/templates.test.ts`.

Restart the host, then restart the group (`ncl groups restart --id <id>`). The
regenerated `groups/<folder>/AGENTS.md` (or `CLAUDE.md`) should show
`# Personality` right after `# Persona`. Ask the agent to change its voice: it
should edit `personality.md` and leave `instructions.prepend.md` byte-identical.

No container rebuild: the composer is host-side, and `container/CLAUDE.md` and
container skills are read at compose/spawn time.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No `# Personality` in the composed doc | host not rebuilt/restarted, file over 4 KB, or it's a symlink | `pnpm run build` + restart; check `logs/nanoclaw.log` for "over its size limit" |
| Agent still edits the persona for style | step 3 or 4 lost in a merge, or the container predates it | re-apply; restart the group so the doc is recomposed |
| Voice applies in every chat | the agent wrote it unscoped | ask it to scope the section to the named chat in `personality.md` |
| Style request overrode a ground rule | the persona lacks the "outranks" line | add step 5's sentence to the persona |
| `make reload-community-agent` says the image is missing | Docker was pruned or reset | `./container/build.sh`, then re-run the reload |
| Reload reports `0 owned, 0 unowned` and nothing changes | nothing was running; normal | the next message spawns a fresh container — check the composed doc after it |
| "Session cleared." appears in the chat on every reload | step 7's `isSystemOriginated` guard lost in a merge | re-apply it in `poll-loop.ts` |
| Reload exits 0 but the voice is unchanged | the thread was not reset | confirm the handler got `--fresh`; `session_state` should have no `continuation:*` row afterwards |
| `Failed to stop session … session realization failed: unknown` on every restart | **pre-existing, not this skill** — see below | nothing; the containers do stop |

### The `Failed to stop session` line is cosmetic

Every `ncl groups restart` logs a `Failed to stop session` error and a doubled
`Stopping session container` line. It is tempting to blame step 7's unowned
sweep for racing `killContainer`, and that is wrong — measured on 2026-10-19,
the second stop landed at `12:31:22.726`, *before*
`restartAgentGroupContainers` returned at `12:31:23.080`, so the sweep had not
started. The first occurrence in the log predates the skill entirely: line 77
of a 144,150-line `nanoclaw.log`, 2026-09-30 18:07, already with
`reason="restart…"`.

The containers do stop, so this is noise rather than a fault, and the cause is
upstream of anything here. Step 7's sweep still takes an exclusion set of the
ids `restartAgentGroupContainers` just killed: that race is real in principle
even though it is not this symptom, and `src/container-restart.test.ts` has a
regression test for it. Do not "fix" the log line by removing that guard.
