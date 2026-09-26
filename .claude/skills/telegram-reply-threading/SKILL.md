---
name: telegram-reply-threading
description: Make a Telegram bot quote the message it is answering, open that person's reply box on its answer (force-reply), and hear replies to its own messages. Use when the bot ignores replies to its answers in a group (engage_mode 'mention'), when its replies land as loose messages with no visible target, or after an upstream update touches src/delivery.ts, src/channels/chat-sdk-bridge.ts, src/channels/adapter.ts or src/channels/channel-registry.ts.
---

# Telegram reply threading

Two halves of one conversation problem, in opposite directions:

- **Inbound** — replying to the bot in a group did nothing. Telegram sends a
  reply as an ordinary message carrying `reply_to_message`; there is no mention
  entity, so the Chat SDK routed it to `onNewMessage` with `isMention: false`
  and a `mention` wiring dropped it. You had to re-`@`-mention the bot on every
  single turn, which reads as the bot going silent mid-conversation.
- **Outbound** — the bot's answers arrived as loose messages. In a busy group,
  an answer several messages below the question is unattributable.
- **Follow-up** — even with the inbound fix, the person had to remember to hit
  "Reply" on the bot's answer. The answer now carries Telegram's ForceReply
  (selective), so that person's reply box opens on it and whatever they type
  next is a reply to the bot.

**Re-run this after any upstream update that touches `src/delivery.ts`,
`src/channels/channel-registry.ts`, `src/channels/chat-sdk-bridge.ts` or
`src/channels/adapter.ts`.** All four are upstream-owned. A lost reach-in fails
quietly: the bot just goes back to ignoring replies. The shipped tests are the
alarm.

**Nothing here edits `src/channels/telegram.ts`**, deliberately. It is
reinstalled from the `channels` registry branch by `/add-telegram` *and* by
every `/update-nanoclaw` skill refresh, which silently dropped the wiring when
it lived there. The bridge upgrades whatever adapter that file builds instead.

## How it works

The causal link already existed end to end and stopped one hop short of the
adapter. The container stamps `messages_out.in_reply_to` with the
`messages_in.id` it answered (`extractRouting`, `container/agent-runner/src/formatter.ts`),
and the host reads that column at delivery time — but only ever used it for
agent-to-agent return routing. Nothing handed it to a channel adapter.

```
messages_in.id ──router──> "<platform msg id>:<agent_group_id>"
      │                     (messageIdForAgent — one inbound fans out into
      │                      several session DBs where id is PRIMARY KEY)
      ▼
container stamps messages_out.in_reply_to
      ▼
delivery.ts  platformReplyTarget()  strips the ":<agent_group_id>" suffix
      ▼
OutboundMessage.replyToMessageId ──bridge──> postable.replyToMessageId
      ▼
ReplyAwareTelegramAdapter ──> sendMessage { reply_parameters }
```

The value is **advisory at every hop**. The router synthesizes an inbound id
when an adapter reports none, an agent can address a different chat than the
one it was asked in, and a quoted message can be deleted before the answer
lands. Every consumer degrades to an unquoted send; none may fail a delivery.

Inbound is a separate, simpler seam: the vendor adapter's own `isBotMentioned`,
which is what the Chat SDK dispatches on (`onNewMention` vs `onNewMessage`) and
what the router reads back as `event.message.isMention`. Replying to a message
the bot wrote IS addressing the bot, so it folds in there — and whether to
engage on it stays the wiring's decision, unchanged.

## Apply

### 1. The Telegram subclass: its own module, not a reach-in

```bash
cp "${CLAUDE_SKILL_DIR}/files/telegram-reply-aware.ts" src/channels/telegram-reply-aware.ts
```

`@chat-adapter/telegram` (4.29.0) has no reply concept at all and its
`postMessage` builds the Bot API payload internally, so there is no hook to
pass `reply_parameters` through. The seam is the vendor's own protected
`telegramFetch`: `postMessage` records the target for the chat it is about to
send to, and the fetch override folds it in. Everything in between — markdown
conversion, MarkdownV2 escaping, inline keyboards, uploads — stays the
vendor's, so this survives their changes to any of it.

Quoting is groups-only, decided in `replyTarget()` by the chat id's leading
`-`. A 1:1 DM has nothing to disambiguate and a quote block on every turn is
clutter. To quote in DMs too, drop that check.

**Force-reply** rides the same fold: whenever a send quotes a message, it also
gets `reply_markup: { force_reply: true, selective: true }`. `selective` limits
it to the sender of the quoted message (and anyone @mentioned in the text), so
only the person being answered gets their reply box opened; the rest of the
group sees nothing. It never displaces markup the send already carries (an
inline keyboard on a question or approval card), and unquoted sends (DMs,
scheduled posts) never get it. To turn force-reply off and keep quoting,
delete the two `FORCE_REPLY` uses in `foldReplyParameters`.

`upgradeToReplyAware(adapter)` at the bottom of the module re-prototypes a
vendor-built `TelegramAdapter` into a `ReplyAwareTelegramAdapter` in place,
and returns every other adapter untouched. The subclass has no constructor and
initializes its one piece of state lazily, which is what makes an upgraded
instance behave exactly like one built with `new`.

### 2. One line in `src/channels/chat-sdk-bridge.ts`

Import the upgrade next to the other local imports:

```ts
import { upgradeToReplyAware } from './telegram-reply-aware.js';
```

and apply it where `createChatSdkBridge` takes the adapter:

```ts
export function createChatSdkBridge(config: ChatSdkBridgeConfig): ChannelAdapter {
  // Fork: telegram-reply-threading — upgrade the vendor adapter in place.
  const adapter = upgradeToReplyAware(config.adapter);
```

Every Telegram bot identity, default or named instance, goes through this
bridge, so all of them get it. `src/channels/telegram.ts` stays exactly as
`/add-telegram` ships it.

### 3. `src/channels/adapter.ts` — the carrier field

On `OutboundMessage`, after `files`:

```ts
replyToMessageId?: string;
```

Document it as advisory: adapters MUST fall back to an unquoted send rather
than fail delivery, and whether a quote is good UX is a per-channel decision
made in the adapter.

### 4. `src/delivery.ts` — recover the platform id

Add the exported helper (a test in step 7 pins it):

```ts
export function platformReplyTarget(inReplyTo: string | null, agentGroupId: string): string | undefined {
  if (!inReplyTo) return undefined;
  const suffix = `:${agentGroupId}`;
  if (!inReplyTo.endsWith(suffix)) return undefined;
  const id = inReplyTo.slice(0, -suffix.length);
  return id.length > 0 ? id : undefined;
}
```

Add a matching optional 8th parameter to the `ChannelDeliveryAdapter.deliver`
interface, and pass it at the one call site in `deliverMessage`:

```ts
    deliverInstance,
    platformReplyTarget(msg.inReplyTo, session.agent_group_id),
  );
```

Requiring our own suffix is the guard that matters: ids that never went through
router namespacing (agent-to-agent return paths, direct writes) are not
inbounds any platform can quote.

### 5. `src/channels/channel-registry.ts` — forward it

`createChannelDeliveryAdapter`'s `deliver` takes the new `replyToMessageId`
parameter and puts it on the `OutboundMessage` it builds.

### 6. `src/channels/chat-sdk-bridge.ts` — hand it to the SDK adapter

The Chat SDK's postable union has no reply concept, so there is no typed slot.
Name the extension rather than leaving it to spread semantics:

```ts
export interface PostableReplyTarget {
  replyToMessageId?: string;
}
```

In `deliver`, before the normal-message branch:

```ts
const replyTo = message.replyToMessageId ? { replyToMessageId: message.replyToMessageId } : {};
```

Spread it onto the postable for **the first chunk only** (`i === 0`) and onto
the files-only send, casting to `AdapterPostableMessage & PostableReplyTarget`.
A quote on every chunk of a long, split answer is noise, not context. Adapters
that don't look for the field ignore it.

### 7. Tests — the drift alarm

```bash
cp "${CLAUDE_SKILL_DIR}/files/telegram-reply-threading.test.ts" src/channels/telegram-reply-threading.test.ts
cp "${CLAUDE_SKILL_DIR}/files/delivery-reply-target.test.ts" src/delivery-reply-target.test.ts
```

Both live at paths upstream does not own, so they survive the merge that breaks
the wiring and fail instead of being clobbered alongside it. The Telegram one
drives the real adapter against a stubbed `fetch` and asserts on the actual Bot
API payload (quote, force-reply, markup preserved). Its wiring cases build the
adapter with the vendor's own `createTelegramAdapter`, exactly as `telegram.ts`
does, and pass it through `createChatSdkBridge`, so losing step 2 turns them
red.

Then add four cases to `src/channels/chat-sdk-bridge.test.ts` (upstream-owned,
merge-conflict prone — droppable if a future merge makes them painful), using
the existing `makePostCapture` helper: target passed through; head-of-split
only; files-only send carries it; no target leaves the postable clean.

### 8. Verify

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec vitest run src/channels src/delivery-reply-target.test.ts
pnpm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
# systemctl --user restart nanoclaw                # Linux
```

No container rebuild — this is all host-side.

In a group the bot is wired to: `@`-mention it once. Its answer should be
visibly attached to your message, and your reply box should open on it. Type a
follow-up without mentioning it: it should answer again. Others in the group
should see no reply prompt. In a DM the answer should carry no quote and no
reply prompt.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Reply to the bot still ignored | host not restarted, or the bridge hook lost in a merge | restart; check step 2 survived (`upgradeToReplyAware` in `chat-sdk-bridge.ts`) |
| Reply box doesn't open on the answer | the answer wasn't quoted (DM, or no `in_reply_to`), or it carried an inline keyboard | expected; force-reply only rides quoted sends without other markup |
| Everyone's reply box opens | `selective` dropped from `FORCE_REPLY` | restore `selective: true` |
| Ignored only in one group | that wiring's `engage_mode`/access gate, not this change | `ncl wirings get --id <id>`; check `dropped_messages` |
| Ignored right after a restart | `getMe` had not resolved the bot id yet on the first message | transient by design — `isReplyToSelf` claims nothing without an identity |
| Bot answers but never quotes | it's a DM (by design), or `in_reply_to` was NULL | check `messages_out.in_reply_to` in the session's `outbound.db` |
| Quotes the wrong message in a busy group | two agents delivering into one chat interleaved | cosmetic; documented on `pendingReplyTargets` |
| Replies to a *different* bot's message engage ours | shouldn't — ids are compared, not the `is_bot` flag alone | check `_botUserId`; file a bug with the raw update |
| Delivery failures after applying | an adapter treating the target as load-bearing | it is advisory at every hop — find the consumer that throws |

## Scope

Telegram only. The host-side half (steps 3–6) is channel-neutral and any other
adapter can start reading `replyToMessageId`; none do today, and one that
ignores it behaves exactly as before.
