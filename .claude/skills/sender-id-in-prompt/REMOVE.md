# Remove: sender-id-in-prompt

Reverses everything `SKILL.md` applied. Nothing else in the codebase depends on
it, but any agent whose instructions key records on `sender_id` (the
community-assistant template from `1.2.0`) can no longer identify senders. It
will refuse to create or link member records, as it did before.

1. **Revert the reach-in** in `container/agent-runner/src/formatter.ts`: in
   `formatSingleChat`, drop the `senderId` / `senderIdAttr` consts and their
   comment, and remove `${senderIdAttr}` from the returned `<message …>` string.
   Leave `extractSenderId` alone; command gating uses it.

2. **Delete the test.** Do this *with* step 1, never before: on its own, it's
   the only thing that would tell you the reach-in is gone.

   ```bash
   rm -f container/agent-runner/src/sender-id-in-prompt.test.ts
   ```

3. **Revert the template text** if nothing else will supply the ID: the
   `sender_id` passages in `templates/community/community-assistant/`
   (`permissions.md`, `members.md`, `notion-schema.md`,
   `context/instructions.md`), then restamp.

4. **Verify and rebuild.**

   ```bash
   cd container/agent-runner && bun test src/formatter.test.ts && cd ../..
   pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
   ./container/build.sh
   ```

   Restart affected groups (`ncl groups restart --id <id>`) so they drop the old
   image.

Not touched by this removal: `author.userId` in `inbound.db` (the bridge still
stores it), admin-command gating, and any Notion rows already keyed on IDs.
