---
name: reload-community-agent
description: Add `make reload-community-agent`, which restarts the containers of the community-assistant agent (Louis, folder `louis`) through the running host, so edited `instructions.prepend.md`, `personality.md` or other standing instructions load on its next message. Use when an operator or the agent itself changed Louis's instructions and he still answers the old way, or after an upstream update touches src/cli/resources/groups.ts or src/cli/socket-client.ts.
---

# Reload the community agent

An agent reads its standing instructions when its container starts, never
mid-session. After Louis rewrites his `personality.md`, or an operator edits
his files, he keeps the old instructions until the container stops. This skill
gives the operator one command for that:

```bash
make reload-community-agent
```

It asks the running host for its agent groups (`groups-list`), picks the one
whose folder is `louis`, and restarts it (`groups-restart`). Running containers
stop; the next message starts a fresh one with the new instructions. It prints
one line, which course material quotes:

```
Louis: stopped 1 running container(s). Updated instructions will load on the next message.
```

It refuses to guess: with zero or several groups in `louis`, it stops and
points at `pnpm ncl groups list`.

## Apply

1. **Copy the script and its test into the project's tree.**

   ```bash
   cp "${CLAUDE_SKILL_DIR}/files/reload-community-agent.ts" scripts/reload-community-agent.ts
   cp "${CLAUDE_SKILL_DIR}/files/reload-community-agent.test.ts" scripts/reload-community-agent.test.ts
   ```

2. **Add the Make target.** If the project has no `Makefile`, create one:

   ```make
   PNPM ?= pnpm
   TSX := $(PNPM) exec tsx

   .PHONY: reload-community-agent

   ## Restart Louis's containers; updated instructions load on the next message.
   reload-community-agent:
   	@$(TSX) scripts/reload-community-agent.ts
   ```

   If a `Makefile` already exists, **append the target and add its name to the
   existing `.PHONY`** rather than overwriting the file. The recipe must be
   TAB-indented, and stays a single `$(TSX)` call so it behaves the same under
   `sh` and `cmd.exe`.

3. **Run the test.**

   ```bash
   pnpm exec vitest run scripts/reload-community-agent.test.ts
   ```

   It drives the script through the real CLI dispatcher and a migrated test
   DB, faking only the Docker restart, so it goes red if either command is
   renamed or the group row loses its `folder`.

Safe to re-run: step 1 overwrites, step 2 skips a target already present.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| A socket or connection error | The NanoClaw host isn't running | Start the service, then run it again |
| `Expected exactly one agent group with folder "louis"` | Louis wasn't made from the community-assistant template, or two groups share the folder | `pnpm ncl groups list`, then `pnpm ncl groups restart --id <id>` for the right one |
| `stopped 0 running container(s)` | Louis was idle | Nothing to fix: his next message starts him with the new instructions |
| Make errors with "missing separator" | Recipe indented with spaces | Re-indent with a TAB |
