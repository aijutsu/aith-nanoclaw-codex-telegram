---
name: reload-community-agent
description: Add `make reload-community-agent`, which stops every container of the community-assistant agent (Louis, folder `louis`) — including containers this host process does not own — and queues a conversation reset on each chat session, so edited `instructions.prepend.md`, `personality.md` or other standing instructions are followed on its next message instead of merely being in context. Preflights the agent image and `personality.md` and refuses rather than reporting a reload it did not perform. Use when an operator or the agent itself changed Louis's instructions and he still answers the old way, or after an upstream update touches src/cli/resources/groups.ts, src/container-restart.ts or src/cli/socket-client.ts.
---

# Reload the community agent

An agent reads its standing instructions when its container starts, never
mid-session. After Louis rewrites his `personality.md`, or an operator edits his
files, he keeps answering the old way until the container stops. This skill
gives the operator one command for that:

```bash
make reload-community-agent                 # the louis group
make reload-community-agent FOLDER=helper   # any other group, by its folder
```

It asks the running host for its agent groups (`groups-list`), picks the one
whose folder matches, preflights, then restarts it with `--fresh`. It prints
what it actually did:

```
Louis (louis)
  image        nanoclaw-agent:latest
  personality  142 bytes
  stopped      2 containers owned, 1 unowned
  reset queued 2 chat sessions
The next message in each chat starts a fresh conversation on the current instructions.
```

It refuses to guess: with zero groups in the folder it names the folders this
install does have, and with several it stops and points at
`pnpm ncl groups list`.

## Prerequisite

**Apply the `group-personality` skill's step 7 first.** It adds the three
host-side reach-ins this command drives: `stopUnownedGroupContainers` and
`clearAgentGroupChatThreads` in `src/container-restart.ts`, the `--fresh` flag
and the `{ restarted, stoppedUnowned, cleared, rebuilt }` payload in
`src/cli/resources/groups.ts`, and the `isSystemOriginated` guard in
`container/agent-runner/src/poll-loop.ts` that keeps a reload from posting
"Session cleared." into the group chat.

The dependency does not fail loudly, which is why it is stated here: `restart`
deliberately has no `args` array, so an unplumbed host does not reject
`--fresh`. It ignores it, returns the old `{ restarted, rebuilt }`, and this
command then reports `undefined` for two of its counts while resetting nothing.

## Apply

1. **Copy the script and its test into the project's tree.**

   ```bash
   cp "${CLAUDE_SKILL_DIR}/files/reload-community-agent.ts" scripts/reload-community-agent.ts
   cp "${CLAUDE_SKILL_DIR}/files/reload-community-agent.test.ts" scripts/reload-community-agent.test.ts
   ```

   This skill carries the only copy. `group-personality` documents the plumbing
   but ships no script of its own — two skills writing the same path would
   race, and whichever applied last would win silently.

2. **Add the Make target.** If the project has no `Makefile`, create one:

   ```make
   PNPM ?= pnpm
   TSX := $(PNPM) exec tsx

   .PHONY: reload-community-agent

   ## Stop every container of the community agent and reset its chat conversations,
   ## so the next message starts fresh on the current instructions. Refuses (and
   ## stops nothing) if the agent image is missing or personality.md won't compose.
   ## Override the group with FOLDER=<slug>.
   reload-community-agent:
   	@$(TSX) scripts/reload-community-agent.ts $(if $(FOLDER),--folder $(FOLDER),)
   ```

   If a `Makefile` already exists, **append the target and add its name to the
   existing `.PHONY`** rather than overwriting the file. The recipe must be
   TAB-indented, and stays a single `$(TSX)` call so it behaves the same under
   `sh` and `cmd.exe`.

3. **Run the test.**

   ```bash
   pnpm exec vitest run scripts/reload-community-agent.test.ts
   ```

   It drives the script through the real CLI dispatcher and a migrated test DB,
   faking only the Docker restart and the `docker image inspect` the preflight
   shells out to, so it goes red if either command is renamed, the group row
   loses its `folder`, or the restart payload stops carrying `stoppedUnowned` /
   `cleared`. `personality.md` is a real file read by the real
   `readGroupPersonality`, because the drop rules are what the preflight exists
   for.

Safe to re-run: step 1 overwrites, step 2 skips a target already present.

## The preflights are the point

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

Do not "improve" the script by restarting anyway and warning. The version that
did reported `stopped 0 running container(s). Updated instructions will load on
the next message.` through an eleven-day outage.

## Why `--fresh`, not just a kill

A resumed Codex thread does re-read `AGENTS.md` — it records the document in
`world_state` and emits a fresh `agents_md` delta on resume — so a kill alone is
enough for an edited voice to be *in context*. `--fresh` exists because being in
context is not the same as being followed: a long thread's own precedent
competes with it. The continuation lives in `session_state` in the session's
`outbound.db`, whose single writer is the container, so the host asks for the
reset via `/clear` rather than writing it.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| A socket or connection error | The NanoClaw host isn't running | Start the service, then run it again |
| `Agent image … is not present` | Docker was pruned or reset | `./container/build.sh`, then re-run the reload |
| `… will not be composed into the project document` | `personality.md` is missing, empty, a symlink or over 4 KB | Check `logs/nanoclaw.log` for the warning naming which, fix the file, re-run |
| `No agent group has folder "louis"` | Louis wasn't made from the community-assistant template | Use the folder the message lists, or `pnpm ncl groups list` |
| `undefined` in the stopped or reset counts | the prerequisite above was never applied, or lost in a merge | re-apply `group-personality` step 7 |
| `0 containers owned, 0 unowned` | Louis was idle; normal | the next message spawns a fresh container — check the composed doc after it |
| "Session cleared." appears in the chat on every reload | the `isSystemOriginated` guard was lost in a merge | re-apply it in `poll-loop.ts` |
| Exits 0 but the voice is unchanged | the thread was not reset | `session_state` should have no `continuation:*` row afterwards |
| Make errors with "missing separator" | Recipe indented with spaces | Re-indent with a TAB |
