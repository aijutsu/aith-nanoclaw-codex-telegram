# Remove: group-personality

Reverses everything `SKILL.md` applied. Safe: nothing else depends on it. Voice
requests then go back into `instructions.prepend.md`.

1. **Fold personalities back first.** For each `groups/<folder>/personality.md`,
   append its content to that group's `instructions.prepend.md` if the voice
   should be kept, then delete `personality.md`. After step 2 the host ignores
   the file, so an unfolded voice silently disappears.
2. **Revert `src/project-doc-compose.ts`:** drop the `./group-personality.js`
   import and the two `Personality` lines after the persona push, and restore
   the doc comment to name only `instructions.prepend.md`.
3. **Delete** `src/group-personality.ts` and `src/group-personality.test.ts`.
4. **Revert `container/CLAUDE.md`:** remove the `personality.md` sentence from
   `## Memory`, and change "Changes to either file" back to "Changes to standing
   instructions".
5. **Revert `container/skills/self-customize/SKILL.md`:** remove the "Voice,
   personality or language preference" bullet.
6. Remove the `personality.md` sentence from any template persona that has it
   (community-assistant rule 12).
7. **Revert the reload (step 7).** Delete `scripts/reload-community-agent.ts`
   and its `Makefile` target and `.PHONY` entry. In `src/container-restart.ts`
   drop `stopUnownedGroupContainers` and `clearAgentGroupChatThreads` plus the
   four imports they added (`INSTALL_SLUG`, `getSessionDriver`,
   `SupervisedSnapshot`, `getMessagingGroup`) and restore the module's doc
   comment. In `src/cli/resources/groups.ts` restore the single-name import, the
   `--fresh` mentions in the verb description, the agent-caller refusal, and the
   host branch's `return { restarted: count, rebuilt: !!args.rebuild }`. In
   `container/agent-runner/src/poll-loop.ts` unwrap the `Session cleared.` write
   from its `isSystemOriginated` guard and drop that import; delete
   `isSystemOriginated` from `formatter.ts`.
8. **Drop the mock entries** the reload added to the three `container-restart.js`
   `vi.mock` factories (`src/cli/resources/groups.test.ts`,
   `src/cli/resources/groups-restart-rebuild.test.ts`, `setup/templates.test.ts`)
   and the `stopUnownedGroupContainers` / `clearAgentGroupChatThreads` blocks in
   `src/container-restart.test.ts`, then revert the restart-payload expectation
   in `src/cli/resources/groups.test.ts` to `{ restarted: 3, rebuilt: false }`.
9. `pnpm run build`, restart the host, and restart affected groups.

Without the reload, an edited `personality.md` takes effect whenever the group's
containers next stop and respawn — `ncl groups restart --id <id>` plus the next
message, with no preflight and no conversation reset.
