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
7. `pnpm run build`, restart the host, and restart affected groups.
