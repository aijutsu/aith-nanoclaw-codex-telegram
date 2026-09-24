/**
 * Telegram reply threading, both directions — a subclass of the vendor
 * adapter, kept in its own module so the reach-in into the skill-installed
 * telegram.ts is two lines (the import, and `new` in place of the factory)
 * and survives a channels-branch reinstall of that file.
 */
import { TelegramAdapter, type TelegramMessage } from '@chat-adapter/telegram';
import type { AdapterPostableMessage } from 'chat';

import type { PostableReplyTarget } from './chat-sdk-bridge.js';

/**
 * Telegram message fields the vendor's `TelegramMessage` type omits but the
 * Bot API sends. `reply_to_message` is the quoted original on a reply.
 * @see https://core.telegram.org/bots/api#message
 */
interface TelegramReplyFields {
  reply_to_message?: { from?: { id?: number; is_bot?: boolean } };
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
  private readonly pendingReplyTargets = new Map<string, number>();

  /** A reply to the bot counts as addressing the bot. */
  protected isBotMentioned(message: TelegramMessage, text: string): boolean {
    return this.isReplyToSelf(message) || super.isBotMentioned(message, text);
  }

  async postMessage(threadId: string, message: AdapterPostableMessage) {
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
    if (payload instanceof FormData) {
      payload.append('reply_parameters', JSON.stringify(replyParameters));
      return payload;
    }
    return { ...payload, reply_parameters: replyParameters };
  }
}
