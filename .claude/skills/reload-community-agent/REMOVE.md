# Remove: reload-community-agent

Reverses everything `SKILL.md` applied.

1. **Delete the copied files.**

   ```bash
   rm -f scripts/reload-community-agent.ts scripts/reload-community-agent.test.ts
   ```

2. **Remove the Make target.** Delete the `reload-community-agent` recipe and
   its `##` comment, and drop its name from `.PHONY`. If the `Makefile` was
   created by this skill and now holds nothing else, delete the file.

3. **Check nothing dangles.**

   ```bash
   grep -rn "reload-community-agent" Makefile scripts/ 2>/dev/null   # expect no hits
   pnpm test                                                          # no new failures
   ```
