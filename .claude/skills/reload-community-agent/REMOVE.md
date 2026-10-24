# Remove: reload-community-agent

Reverses everything `SKILL.md` applied.

Leaves `group-personality` step 7's plumbing in place, because that skill owns
it: `ncl groups restart --fresh` keeps working by hand after this, it is just no
longer wrapped in a `make` target. Remove it through that skill's `REMOVE.md`
if you want it gone too.

1. **Delete the copied files.**

   ```bash
   rm -f scripts/reload-community-agent.ts scripts/reload-community-agent.test.ts
   ```

2. **Remove the Make target.** Delete the `reload-community-agent` recipe
   (including its `$(FOLDER)` argument) and its `##` comment, and drop its name
   from `.PHONY`. If the `Makefile` was created by this skill and now holds
   nothing else, delete the file.

3. **Check nothing dangles.**

   ```bash
   grep -rn "reload-community-agent" Makefile scripts/ 2>/dev/null   # expect no hits
   pnpm test                                                          # no new failures
   ```
