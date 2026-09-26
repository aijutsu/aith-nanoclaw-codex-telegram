/**
 * Telegram reply threading, both directions — a subclass of the vendor
 * adapter, applied by the chat-sdk bridge (`upgradeToReplyAware`) to whatever
 * adapter instance telegram.ts builds. Nothing here touches telegram.ts: that
 * file is reinstalled from the `channels` registry branch on every
 * /update-nanoclaw, which silently dropped the wiring when it lived there.
 */
import { TelegramAdapter, type TelegramMessage } from '@chat-adapter/telegram';
import type { Adapter, AdapterPostableMessage } from 'chat';

import { log } from '../log.js';
import type { PostableReplyTarget } from './chat-sdk-bridge.js';

/**
 * Telegram message fields the vendor's `TelegramMessage` type omits but the
 * Bot API sends. `reply_to_message` is the quoted original on a reply.
 * @see https://core.telegram.org/bots/api#message
 */
interface TelegramReplyFields {
  reply_to_message?: { from?: { id?: number; is_bot?: boolean } };
}

/**
 * Bot API ForceReply. `selective` limits it to users @mentioned in the text and
 * the sender of the message being replied to.
 * @see https://core.telegram.org/bots/api#forcereply
 */
const FORCE_REPLY = { force_reply: true, selective: true } as const;

/**
 * Announcement marker: an agent opens a message body with `<announce/>` to
 * post it as a standalone message (no quote, no force-reply) and pin it.
 * Stripped before sending, so it never reaches the chat.
 */
const ANNOUNCE_MARKER = /^\s*<announce\s*\/?>\s*/i;

/**
 * The postable with its leading announcement marker removed, or undefined when
 * it carries none. Drops `replyToMessageId` too: an announcement is addressed
 * to the group, not an answer to whoever approved it.
 */
export function takeAnnouncement(message: AdapterPostableMessage): AdapterPostableMessage | undefined {
  if (typeof message === 'string') {
    return ANNOUNCE_MARKER.test(message) ? message.replace(ANNOUNCE_MARKER, '') : undefined;
  }
  if (!message || typeof message !== 'object') return undefined;
  const fields = message as unknown as Record<string, unknown>;
  for (const key of ['markdown', 'raw', 'text']) {
    const value = fields[key];
    if (typeof value !== 'string') continue;
    if (!ANNOUNCE_MARKER.test(value)) return undefined;
    const { replyToMessageId: _dropped, ...rest } = fields;
    return { ...rest, [key]: value.replace(ANNOUNCE_MARKER, '') } as unknown as AdapterPostableMessage;
  }
  return undefined;
}

/** Bot API send methods never carry a reply; excluded from the fold below. */
const NON_REPLY_SEND_METHODS = new Set(['sendChatAction']);

/**
 * Telegram adapter with reply threading in both directions.
 *
 * Outbound — the Bot API expresses "this answers that" as a `reply_parameters`
 * field on the send call. @chat-adapter/telegram 4.29.0 has no reply concept
 * at all and its `postMessage` builds the payload internally, so the seam is
 * the adapter's own `telegramFetch`: `postMessage` records the target for the
 * chat it is about to send to, and the fetch override folds it in. Everything
 * between those two points — markdown conversion, entity escaping, inline
 * keyboards, uploads — stays the vendor's, so this survives their changes to
 * any of it.
 *
 * Inbound — Telegram does not mark a reply as a mention, so replying to the
 * bot in a group arrived as a plain message that a `mention` wiring ignored:
 * the bot answered, you replied to its answer, and it went quiet. Replying to
 * a message the bot wrote IS addressing the bot, so it is folded into the
 * adapter's own mention test — the one the Chat SDK dispatches on
 * (onNewMention vs onNewMessage) and the router reads back as
 * `event.message.isMention`. Engaging on it stays the wiring's call.
 */
export class ReplyAwareTelegramAdapter extends TelegramAdapter {
  /**
   * Reply target per chat id: set by `postMessage`, consumed by that send's
   * `telegramFetch`. Keyed by chat rather than held in a single field so
   * concurrent deliveries to different chats can never take each other's
   * target. Two deliveries racing into the SAME chat still can (the vendor's
   * upload path awaits between the two points), and the cost is one reply
   * quoting the other's message — cosmetic, and bounded to that.
   */
  // Lazy, not a field initializer: `upgradeToReplyAware` re-prototypes an
  // instance the vendor constructor already built, so initializers never run.
  private _pendingReplyTargets?: Map<string, number>;
  private get pendingReplyTargets(): Map<string, number> {
    return (this._pendingReplyTargets ??= new Map());
  }

  /** A reply to the bot counts as addressing the bot. */
  protected isBotMentioned(message: TelegramMessage, text: string): boolean {
    return this.isReplyToSelf(message) || super.isBotMentioned(message, text);
  }

  async postMessage(threadId: string, message: AdapterPostableMessage) {
    const announcement = takeAnnouncement(message);
    if (announcement !== undefined) {
      const sent = await super.postMessage(threadId, announcement);
      await this.pinAnnouncement(threadId, sent.id);
      return sent;
    }
    const target = this.replyTarget(threadId, message);
    if (target === undefined) return super.postMessage(threadId, message);
    const { chatId } = this.resolveThreadId(threadId);
    this.pendingReplyTargets.set(chatId, target);
    try {
      return await super.postMessage(threadId, message);
    } finally {
      // Only if still ours: a concurrent send to this chat may have replaced
      // it, and dropping that one would silently cost it its quote. Consumed
      // targets are already gone.
      if (this.pendingReplyTargets.get(chatId) === target) this.pendingReplyTargets.delete(chatId);
    }
  }

  protected async telegramFetch<TResult>(
    method: string,
    payload?: Record<string, unknown> | FormData,
    request?: { signal?: AbortSignal },
  ): Promise<TResult> {
    return super.telegramFetch<TResult>(method, this.foldReplyParameters(method, payload), request);
  }

  /**
   * Pin a just-sent announcement. The bot needs the group's "pin messages"
   * admin right; without it the message still stands, only unpinned, so a
   * failure is logged and never fails the delivery.
   */
  private async pinAnnouncement(threadId: string, sentId: string): Promise<void> {
    try {
      const { chatId } = this.resolveThreadId(threadId);
      const { messageId } = this.decodeCompositeMessageId(sentId, chatId);
      await this.telegramFetch('pinChatMessage', { chat_id: chatId, message_id: messageId });
    } catch (err) {
      log.warn('Telegram announcement sent but not pinned (does the bot have the pin-messages admin right?)', {
        threadId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** The quoted message's author is this bot. Service messages (a forum
   *  topic's root, a pin notice) carry the acting human instead, so they
   *  cannot false-positive here. */
  private isReplyToSelf(message: TelegramMessage): boolean {
    const author = (message as TelegramMessage & TelegramReplyFields).reply_to_message?.from;
    if (!author || author.is_bot !== true) return false;
    // Undefined before initialize()'s getMe resolves — no identity to compare,
    // so no claim either way.
    return this.botUserId !== undefined && String(author.id) === this.botUserId;
  }

  /**
   * Decode the host's advisory reply target (OutboundMessage.replyToMessageId,
   * passed through by the chat-sdk bridge) into a Telegram message number, or
   * undefined when this send should not quote.
   *
   * Groups only: a 1:1 DM has nothing to disambiguate, and a quote block on
   * every turn is clutter rather than context.
   */
  private replyTarget(threadId: string, message: AdapterPostableMessage): number | undefined {
    const candidate = (message as AdapterPostableMessage & PostableReplyTarget).replyToMessageId;
    if (typeof candidate !== 'string' || !candidate) return undefined;
    try {
      const { chatId } = this.resolveThreadId(threadId);
      if (!chatId.startsWith('-')) return undefined;
      // Throws on a non-Telegram id (the router synthesizes one when an
      // adapter reports none) and on a target from another chat. Both mean
      // "no quote", never "fail the delivery".
      return this.decodeCompositeMessageId(candidate, chatId).messageId;
    } catch {
      return undefined;
    }
  }

  /** Fold this chat's pending reply target into an outgoing send and consume it. */
  private foldReplyParameters(
    method: string,
    payload?: Record<string, unknown> | FormData,
  ): Record<string, unknown> | FormData | undefined {
    if (!payload || !method.startsWith('send') || NON_REPLY_SEND_METHODS.has(method)) return payload;
    const chatId = payload instanceof FormData ? payload.get('chat_id') : payload.chat_id;
    const key = chatId == null ? '' : String(chatId);
    const target = this.pendingReplyTargets.get(key);
    if (target === undefined) return payload;
    this.pendingReplyTargets.delete(key);
    // allow_sending_without_reply: the quoted message can be deleted between
    // the user sending it and the agent answering. Send unquoted rather than
    // lose the reply.
    const replyParameters = { message_id: target, allow_sending_without_reply: true };
    // Force-reply, selective: opens the reply box of the person being answered
    // (and only theirs) on this message, so their next text is a reply to the
    // bot, which `isBotMentioned` counts as addressing it. Never displaces
    // markup the send already carries (an inline keyboard on a question card).
    const hasMarkup = payload instanceof FormData ? payload.has('reply_markup') : payload.reply_markup != null;
    if (payload instanceof FormData) {
      payload.append('reply_parameters', JSON.stringify(replyParameters));
      if (!hasMarkup) payload.append('reply_markup', JSON.stringify(FORCE_REPLY));
      return payload;
    }
    return { ...payload, reply_parameters: replyParameters, ...(hasMarkup ? {} : { reply_markup: FORCE_REPLY }) };
  }
}

/**
 * Give a vendor-built Telegram adapter reply threading, in place. Called by the
 * chat-sdk bridge on every adapter it wraps; anything that isn't a Telegram
 * adapter (or is already upgraded) comes back untouched.
 *
 * Re-prototyping rather than constructing a `ReplyAwareTelegramAdapter`
 * keeps telegram.ts, which builds the instance with its own config, entirely
 * vendor code. The subclass declares no constructor and initializes its only
 * state lazily, so an upgraded instance is indistinguishable from one built
 * with `new`.
 */
export function upgradeToReplyAware<T extends Adapter>(adapter: T): T {
  if (adapter instanceof TelegramAdapter && !(adapter instanceof ReplyAwareTelegramAdapter)) {
    Object.setPrototypeOf(adapter, ReplyAwareTelegramAdapter.prototype);
  }
  return adapter;
}
