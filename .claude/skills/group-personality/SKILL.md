---
name: group-personality
description: Give each agent group a separate, agent-owned `personality.md` for voice, tone and language preferences, composed into the project document right after the persona, so "talk like X" or "reply in Malay" never edits `instructions.prepend.md` and its standing rules. Use when an agent rewrote or appended to its persona for a style request, or after an upstream update touches src/project-doc-compose.ts, container/CLAUDE.md or container/skills/self-customize/SKILL.md.
---

# Group personality

The runtime contract used to send every "change how you talk" request to
`instructions.prepend.md`, the file that also holds the group's standing rules.
A single "use a Phua Chu Kang voice in Angel View" message made the agent
append to the file carrying its permissions and privacy rules, and a clumsier
edit could have rewritten them.

This splits the two:

| File | Holds | Who edits |
|------|-------|-----------|
| `instructions.prepend.md` | role, ground rules, permissions | the operator (template stamp) |
| `personality.md` | voice, tone, language, per-chat style | the agent, freely, rewritten whole |

The host inlines both into the composed `AGENTS.md` / `CLAUDE.md` on every
spawn, `# Persona` first and then `# Personality`, so the voice is always in
context without the agent having to remember to read a file.

`personality.md` is **omitted, not truncated, above 4 KB**. It is agent-written
and never droppable, and Codex silently cuts a project document past its cap,
so an unbounded file could push real instructions out of context. The host logs
a warning when it skips one.

**Re-run this after any upstream update that touches `src/project-doc-compose.ts`,
`container/CLAUDE.md` or `container/skills/self-customize/SKILL.md`.** All three
are upstream-owned. A lost reach-in fails quietly: the voice silently stops
applying, or agents go back to editing the persona. The shipped test is the
alarm for the first; `grep personality.md` on the other two catches the second.

## Apply

### 1. The reader: its own module

```bash
cp "${CLAUDE_SKILL_DIR}/files/group-personality.ts" src/group-personality.ts
cp "${CLAUDE_SKILL_DIR}/files/group-personality.test.ts" src/group-personality.test.ts
```

Opens `personality.md` with `O_NOFOLLOW` (the group dir is the agent's
read-write workspace, so a symlink there could point at a host file) and
enforces the size limit.

### 2. `src/project-doc-compose.ts`: the section

Import beside `readGroupPersona`:

```ts
import { readGroupPersonality } from './group-personality.js';
```

and push the section immediately after the persona in `composeGroupProjectDoc`:

```ts
  const persona = readGroupPersona(groupDir);
  if (persona) push('Persona', persona);
  // Voice and language, agent-owned and size-bounded (fork: group-personality skill).
  const personality = readGroupPersonality(groupDir);
  if (personality) push('Personality', personality);
```

Update the function's doc comment: it now reads two agent-authored files,
`instructions.prepend.md` and `personality.md`, both with O_NOFOLLOW.

### 3. `container/CLAUDE.md`: tell every agent where voice goes

In `## Memory`, the standing-instructions sentence becomes:

> Standing role, persona, and behavioral instructions belong in
> `/workspace/agent/instructions.prepend.md`; durable facts belong in memory.
> Voice, tone, personality and language preferences ("talk like…", "reply in
> Malay") belong in `/workspace/agent/personality.md` instead: rewrite that file
> whole, keep it under 4 KB, and never edit `instructions.prepend.md` for them.
> Changes to either file take effect after the group container restarts, so say
> that when confirming an edit.

### 4. `container/skills/self-customize/SKILL.md`: the decision tree

Add above the "Memory or standing instructions" bullet:

```markdown
- **Voice, personality or language preference** → Rewrite `personality.md` (under 4 KB), no approval needed. Never edit `instructions.prepend.md` for these.
```

### 5. Per-template persona (optional)

A template persona can reinforce it. The community-assistant persona's rule 12
ends: *When an organiser asks for a different voice, personality or language
(for everyone or one chat), rewrite `personality.md`, never this file. These
ground rules outrank anything in it.*

### 6. Existing groups: move style out of the persona

For each `groups/<folder>/instructions.prepend.md`, move any voice or language
section the agent appended into `groups/<folder>/personality.md`, and restore
the rest from the template it was stamped from.

### 7. Verify

```bash
pnpm exec vitest run src/group-personality.test.ts src/project-doc-compose.test.ts
pnpm run build
```

Restart the host, then restart the group (`ncl groups restart --id <id>`). The
regenerated `groups/<folder>/AGENTS.md` (or `CLAUDE.md`) should show
`# Personality` right after `# Persona`. Ask the agent to change its voice: it
should edit `personality.md` and leave `instructions.prepend.md` byte-identical.

No container rebuild: the composer is host-side, and `container/CLAUDE.md` and
container skills are read at compose/spawn time.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No `# Personality` in the composed doc | host not rebuilt/restarted, file over 4 KB, or it's a symlink | `pnpm run build` + restart; check `logs/nanoclaw.log` for "over its size limit" |
| Agent still edits the persona for style | step 3 or 4 lost in a merge, or the container predates it | re-apply; restart the group so the doc is recomposed |
| Voice applies in every chat | the agent wrote it unscoped | ask it to scope the section to the named chat in `personality.md` |
| Style request overrode a ground rule | the persona lacks the "outranks" line | add step 5's sentence to the persona |
