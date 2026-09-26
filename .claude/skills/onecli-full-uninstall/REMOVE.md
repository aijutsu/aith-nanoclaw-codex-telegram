# Remove: onecli-full-uninstall

Restores upstream behaviour: the uninstaller leaves the OneCLI gateway and its
vault untouched.

1. Revert the hooks in `setup/uninstall/flow.ts` (each marked
   `onecli-full-uninstall`, see `SKILL.md` step 2): the import, the `onecli`
   entry in `GROUPS`, the scan, `onecliRows`/`totalFound`, the dry-run note,
   the `onecliYes` confirm + kept note + logged decision, the early-exit
   condition, the `purgeOneCli` call, and `printLeftAlone`'s `gatewayPurged`
   parameter.
2. Delete the fork-owned files, together with step 1:
   ```bash
   rm -f setup/uninstall/onecli-purge.ts setup/uninstall/onecli-purge.test.ts
   ```
3. `pnpm exec vitest run setup/uninstall`
