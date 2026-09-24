# Remove: telegram-reply-threading

Reverses everything `SKILL.md` applied. Removing it is safe — nothing else
depends on it — but the bot goes back to ignoring replies to its own messages
in groups, so people have to `@`-mention it on every turn.

If the goal is only to stop the **quoting** and keep the bot hearing replies,
do step 4 alone and leave the rest in place.

1. **Revert the reach-in** in `src/channels/telegram.ts`:

   ```ts
   import { createTelegramAdapter } from '@chat-adapter/telegram';
   ```

   ```ts
   const telegramAdapter = createTelegramAdapter({
     botToken: token,
     mode: 'polling',
   });
   ```

   and drop the `./telegram-reply-aware.js` import.

2. **Delete the subclass and its tests.**

   ```bash
   rm -f src/channels/telegram-reply-aware.ts
   rm -f src/channels/telegram-reply-threading.test.ts
   rm -f src/delivery-reply-target.test.ts
   ```

   Do this *with* step 1, never before it: on their own those tests are the
   only thing that would tell you the reach-in is gone.

3. **Revert the host plumbing** — all four are inert once nothing reads the
   field, so they can also just be left in place:

   - `src/channels/adapter.ts` — drop `replyToMessageId` from `OutboundMessage`;
   - `src/delivery.ts` — drop `platformReplyTarget`, the 8th parameter on the
     `ChannelDeliveryAdapter.deliver` interface, and the argument at the
     `deliverMessage` call site;
   - `src/channels/channel-registry.ts` — drop the parameter and the field it
     puts on the `OutboundMessage`;
   - `src/channels/chat-sdk-bridge.ts` — drop `PostableReplyTarget`, the
     `replyTo` const in `deliver`, both spreads, and the two casts (restore the
     plain `{ markdown: chunk }` / `{ markdown: '', files: fileUploads }`
     postables and the `AdapterPostableMessage` import if unused).

4. **Revert the tests** added to `src/channels/chat-sdk-bridge.test.ts`: the
   four cases named in step 7 of `SKILL.md`.

5. **Verify and restart.**

   ```bash
   pnpm exec tsc --noEmit -p tsconfig.json
   pnpm exec vitest run src/channels
   pnpm run build
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
   # systemctl --user restart nanoclaw                # Linux
   ```

Not touched by this removal: `messages_out.in_reply_to` itself (written by the
container, still used for agent-to-agent return routing), any wiring's
`engage_mode`, and messages Telegram has already delivered — quotes already
sent stay in the chat history.
