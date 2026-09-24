# Remove: add-notion-credentials

Reverses everything `SKILL.md` applied.

1. **Remove the vaulted credential first**, while the tooling still exists:

   ```bash
   make remove-notion-connection
   ```

   Skip this only if the Notion secret should stay in the vault. If the targets
   are already gone, delete it by hand — `onecli secrets list` to find the id,
   then `onecli secrets delete --id <id>`.

2. **Delete the copied files.**

   ```bash
   rm -f scripts/notion-connection.ts scripts/notion-connection.test.ts
   ```

3. **Remove the Make targets.** Delete the `add-notion-connection`,
   `list-notion-connections` and `remove-notion-connection` recipes and drop
   their names from `.PHONY`. If the `Makefile` was created by this skill and
   now holds nothing else, delete the file.

4. **Verify nothing dangles.**

   ```bash
   grep -rn "notion-connection" Makefile scripts/ 2>/dev/null   # expect no hits
   pnpm test                                                     # no new failures
   ```

Nothing else is touched: no dependency is installed (`@clack/prompts` and `tsx`
are already NanoClaw's), no env var is set, and no core file is edited.
