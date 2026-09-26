---
name: onecli-full-uninstall
description: Make `bash uninstall.sh` (nanoclaw.sh --uninstall) also purge the local OneCLI gateway and vault — its containers, the vault database volume, network, image, ~/.onecli/ and the `onecli` CLI — as a fourth default-No group. Use when a reinstall keeps old vaulted secrets (e.g. a Notion token reappears on a "fresh" install), or after an upstream update touches setup/uninstall/flow.ts, or onecli-purge.test.ts goes red.
---

# OneCLI full uninstall

Upstream's uninstaller removes only what belongs to this checkout and
**deliberately leaves the gateway alone**, because one OneCLI instance can serve
several NanoClaw copies. The consequence: the vault lives in the Docker volume
`onecli_pgdata`, so uninstall + reinstall reattaches the old vault. Every secret,
OneCLI agent and rule comes back, and new agents (`secretMode: all`) get all of
it — a "fresh" install that is already connected to Notion.

This skill adds a fourth group to the uninstaller, **4) OneCLI gateway & vault**,
with its own default-No confirm. `--yes` includes it; `--dry-run` previews it.

What it removes, all found by the compose label
`com.docker.compose.project=onecli` (no compose file or plugin needed):

| Item | Where |
|------|-------|
| Containers | `onecli`, `onecli-postgres-1` |
| Volumes — the vault | `onecli_pgdata`, `onecli_app-data` |
| Network | `onecli_onecli` |
| Image | `ghcr.io/onecli/onecli` (every tag; `postgres` is left — other projects may use it) |
| Config & credentials | `~/.onecli/` |
| CLI | `~/.local/bin/onecli` and any `onecli.*` copy beside it |

It runs after the service group (so the host can't respawn containers against
the gateway mid-purge) and before `dist/`/`node_modules/` go.

## Apply

### 1. The fork-owned module and its test

```bash
cp "${CLAUDE_SKILL_DIR}/files/onecli-purge.ts" setup/uninstall/onecli-purge.ts
cp "${CLAUDE_SKILL_DIR}/files/onecli-purge.test.ts" setup/uninstall/onecli-purge.test.ts
```

Upstream owns neither path.

### 2. The reach-in: `setup/uninstall/flow.ts`

`flow.ts` is upstream-owned and merged by `/update-nanoclaw`, so keep the edit
to these hooks, each marked `onecli-full-uninstall`:

1. Import next to the `./plan.js` import:
   ```ts
   import { oneCliFound, oneCliNotes, oneCliRows, purgeOneCli, scanOneCli } from './onecli-purge.js';
   ```
2. Add a fourth entry to `GROUPS`:
   ```ts
   // Fork: onecli-full-uninstall skill.
   onecli: {
     title: '4) OneCLI gateway & vault',
     desc: 'The local OneCLI app and every secret in its vault (ChatGPT login, Notion and other tokens), its agents and rules. Shared by every NanoClaw copy on this machine — they stop working until OneCLI is set up again.',
     prompt: 'Delete OneCLI and everything in its vault shown above? (cannot be undone)',
   },
   ```
3. Right after `scanInstall(...)`, before `spinner.stop`:
   ```ts
   // Fork: onecli-full-uninstall skill.
   const onecli = scanOneCli({ home, runCommand, runtime: inv.containerRuntime });
   inv.notes.push(...oneCliNotes(onecli));
   ```
4. Count it: `const onecliRows = oneCliFound(onecli) ? oneCliRows(onecli, (p) => tilde(p, home)) : [];`
   and add `+ onecliRows.length` to `totalFound`.
5. Dry run: after the `userRows` note, `if (onecliRows.length > 0) note(groupBody(GROUPS.onecli.desc, onecliRows), GROUPS.onecli.title);`
6. Confirm phase: after the `userYes` block, the same pattern into `let onecliYes`;
   add its `kept by your choice` note, and `onecli: onecliYes` to the logged decisions.
7. Change the early exit to `if (actions.length === 0 && !onecliYes)`.
8. Right after `executePlan(head, deps)`:
   ```ts
   if (onecliYes) execNotes.push(...purgeOneCli(onecli, deps).notes);
   ```
9. `printLeftAlone(notes, gatewayPurged = false)` drops its
   `Shared gateway applications and credentials` line when `gatewayPurged`;
   pass `onecliYes` at the post-execution call.

### 3. Verify

```bash
pnpm exec vitest run setup/uninstall
bash uninstall.sh --dry-run     # group 4 lists the OneCLI rows; changes nothing
```

## After purging

`.env` still names `NANOCLAW_GATEWAY_PROVIDER=onecli`; if you kept NanoClaw,
the host refuses to start until a gateway is back. Run `/add-onecli` (or
`bash nanoclaw.sh`) for a new empty vault, then vault the Codex login again
and add Notion only where wanted (`make add-notion-connection`).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No group 4 in the uninstaller | `flow.ts` hooks lost in an upstream merge | re-apply step 2 |
| "OneCLI volumes: not removed" | a container still holds the volume | `docker ps -a --filter label=com.docker.compose.project=onecli`, `rm -f` it, re-run |
| Note says docker unavailable | daemon down during scan | start Docker, re-run; host files were still removed |
| Old secrets still there after reinstall | group 4 answered No | re-run `bash uninstall.sh` and confirm group 4 |
