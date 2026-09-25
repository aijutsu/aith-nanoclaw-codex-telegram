---
name: sender-id-in-prompt
description: Show the agent each sender's stable platform ID (a `sender_id="telegram:123"` attribute on every `<message>`), not just their display name. Use when an agent that keys records on who is speaking (member rosters, per-user permissions — e.g. the community-assistant template) says the channel "isn't passing the sender's account ID", or after an upstream update touches container/agent-runner/src/formatter.ts.
---

# Sender ID in prompt

The agent only ever saw a sender's **display name**:

```xml
<message id="7" sender="Ada" time="…">add me to the members list</message>
```

Display names are neither unique nor fixed, so an agent told to identify people
by platform user ID (the community-assistant template's `permissions.md`) has
nothing to go on and correctly refuses to link records. The ID was never
missing from the pipeline: the Chat SDK bridge stores `author.userId` in every
inbound row, and the formatter already extracts it (`extractSenderId`,
`container/agent-runner/src/formatter.ts`), but only for admin-command gating. It
never reached the prompt.

After this skill:

```xml
<message id="7" sender="Ada" sender_id="telegram:123456789" time="…">add me to the members list</message>
```

Stock NanoClaw doesn't need this. The host resolves identity itself for its
access gates (`senderResolver` / `accessGate` in `src/router.ts`) and never
hands it to the agent. It's needed only when the agent keeps its own records
keyed on the sender.

**Re-run this after any upstream update that touches
`container/agent-runner/src/formatter.ts`.** A lost reach-in fails quietly: the
agent just goes back to refusing to identify people. The shipped test is the
alarm.

## Trust

`sender_id` comes from the platform's own author field, set by the adapter on
the host. Nothing the sender types can change it. Message text is escaped into
the element body, and the attribute is XML-escaped too. That is what makes it
safe to key permissions on, and it's why an agent must never accept an ID typed
into a message instead.

It is still an identifier: the agent's instructions should say never to repeat
it in a reply. The community-assistant template already does (`SKILL.md`,
"Never put these in a message").

## Apply

### 1. `container/agent-runner/src/formatter.ts` — one attribute

In `formatSingleChat`, after `const fromAttr = originAttr(msg);`:

```ts
  // Stable platform identity (`<channel>:<raw id>`), for agents that key
  // records on who is speaking — display names are neither unique nor fixed.
  const senderId = extractSenderId(msg, content);
  const senderIdAttr = senderId ? ` sender_id="${escapeXml(senderId)}"` : '';
```

and put `${senderIdAttr}` straight after the `sender="…"` attribute in the
returned `<message …>` string.

Reuse `extractSenderId` rather than reading `author.userId` again. It already
namespaces the raw chat-sdk ID as `<channel_type>:<id>`, which is the form
`users.id` uses in the central DB, and it passes pre-namespaced `senderId`s from
native adapters through unchanged. Cross-session echo rows go through
`formatEchoMessage`, not here, so they get no ID. That's intended: the speaker
isn't in this conversation.

### 2. The test — the drift alarm

```bash
cp "${CLAUDE_SKILL_DIR}/files/sender-id-in-prompt.test.ts" container/agent-runner/src/sender-id-in-prompt.test.ts
```

It lives at a path upstream doesn't own, so it survives the merge that clobbers
step 1 and fails instead. It covers chat-sdk namespacing, native pass-through,
omission when no ID is known, escaping, and that text in the body can't pose as
the attribute.

### 3. Tell the agent what the attribute means

A new attribute the agent's instructions don't mention might be ignored or
misread. For the community-assistant template this is already done in
`templates/community/community-assistant/` (plugin `1.2.0`): `permissions.md`,
`members.md`, `notion-schema.md` and `context/instructions.md` name `sender_id`,
say to store the digits after the colon, and say that a message without one
can't be resolved. Restamp the agent afterwards:

```bash
ncl groups create --template community/community-assistant          # dry run
ncl groups create --template community/community-assistant --yes    # apply
```

For any other agent, add a line to its instructions saying what `sender_id` is
and which field it matches.

### 4. Verify

```bash
cd container/agent-runner && bun test src/sender-id-in-prompt.test.ts src/formatter.test.ts && cd ../..
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
./container/build.sh
```

**The image rebuild is required.** The formatter runs inside the container.
Running containers keep the old code until they respawn, so restart the
affected groups (`ncl groups restart --id <group-id>`) or wait for them to idle
out.

Then message the agent from Telegram and ask it who you are, or, for Louis, ask
to be added to the members list. It should link the record without asking for
an ID. To check the raw prompt, look at the session's `inbound.db`: the row's
`content.author.userId` is what becomes `sender_id`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent still says it has no account ID | container predates the rebuild, or the image wasn't rebuilt | `./container/build.sh`, then `ncl groups restart --id <id>` |
| Rebuilt, still missing | agent's instructions don't mention `sender_id` | step 3; restamp or edit the instructions |
| No `sender_id` on some messages | the adapter stored no `author.userId` / `senderId` for that row (system, task or echo messages) | expected; check the row in `inbound.db` |
| ID is `telegram:…` but Notion rows hold bare digits | by design: the template stores the digits after the colon | nothing to fix; agent strips the prefix |
| Agent repeats IDs in chat | its instructions lack a privacy rule | add one; the attribute is plumbing, not content |

## Scope

Every agent group on the install gets the attribute: the formatter is shared,
and there's no per-group switch. Agents whose instructions don't mention it
ignore it. The cost is a few tokens per message.
