/**
 * Telegram reply threading, both directions.
 *
 * Inbound: Telegram sends a reply as an ordinary message with a
 * `reply_to_message` field — no mention entity, nothing the Chat SDK would
 * route to onNewMention. A group wiring on `mention` therefore ignored every
 * reply to the bot's own answers, which reads as the bot going silent
 * mid-conversation. The adapter's mention test is the right seam: it is what
 * the SDK dispatches on and what the router reads back as isMention.
 *
 * Outbound: the quote target arrives as an advisory `replyToMessageId` on the
 * postable (host-derived from messages_out.in_reply_to). The properties that
 * matter are that a bad target degrades to an unquoted send rather than a
 * failed delivery, and that DMs never quote.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createTelegramAdapter, type TelegramMessage } from '@chat-adapter/telegram';
import type { AdapterPostableMessage } from 'chat';

import { createChatSdkBridge, type PostableReplyTarget } from './chat-sdk-bridge.js';
import { ReplyAwareTelegramAdapter, takeAnnouncement, upgradeToReplyAware } from './telegram-reply-aware.js';

/** What the chat-sdk bridge hands the adapter for a plain text reply. */
function postable(markdown: string, replyToMessageId?: string): AdapterPostableMessage {
  return { markdown, ...(replyToMessageId ? { replyToMessageId } : {}) } as AdapterPostableMessage &
    PostableReplyTarget;
}

const BOT_ID = '777';
const GROUP = 'telegram:-1001234';
const DM = 'telegram:6037840640';

/** Exposes the protected surface the adapter resolves at runtime via getMe. */
class TestAdapter extends ReplyAwareTelegramAdapter {
  // null, not undefined: an explicit undefined would take the default below.
  constructor(botUserId: string | null = BOT_ID) {
    super({ botToken: 'test-token', userName: 'nanoclaw_bot', mode: 'polling' });
    this._botUserId = botUserId ?? undefined;
  }

  /** Drive the payload fold directly, as the vendor's upload path would. */
  async sendWithTarget(payload: Record<string, unknown>, target: number): Promise<void> {
    (this as unknown as { pendingReplyTargets: Map<string, number> }).pendingReplyTargets.set(
      String(payload.chat_id),
      target,
    );
    await this.telegramFetch('sendMessage', payload);
  }

  mentioned(message: Record<string, unknown>): boolean {
    return this.isBotMentioned(message as unknown as TelegramMessage, (message.text as string) ?? '');
  }
}

/** A group message replying to `author`, with no mention text of any kind. */
function replyTo(author: { id: number; is_bot: boolean }, text = 'and what about Tuesday?'): Record<string, unknown> {
  return {
    message_id: 12,
    chat: { id: -1001234, type: 'supergroup' },
    date: 1_700_000_000,
    from: { id: 42, is_bot: false, first_name: 'Alice' },
    text,
    reply_to_message: { message_id: 11, chat: { id: -1001234 }, date: 1_699_999_999, from: author },
  };
}

function stubSendMessage() {
  const fetchMock = vi.fn(
    async (_input: unknown, _init?: { body?: unknown }) =>
      new Response(
        JSON.stringify({
          ok: true,
          result: { message_id: 99, chat: { id: -1001234, type: 'supergroup' }, date: 1_700_000_100, text: 'ok' },
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentPayload(fetchMock: ReturnType<typeof stubSendMessage>, call = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body)) as Record<string, unknown>;
}

describe('inbound: a reply to the bot is addressing the bot', () => {
  it('counts a reply to a message this bot wrote as a mention', () => {
    expect(new TestAdapter().mentioned(replyTo({ id: 777, is_bot: true }))).toBe(true);
  });

  it('counts it even with no text at all — a photo reply still addresses the bot', () => {
    const photoReply = { ...replyTo({ id: 777, is_bot: true }), text: undefined };
    expect(new TestAdapter().mentioned(photoReply)).toBe(true);
  });

  it('ignores a reply to another human', () => {
    expect(new TestAdapter().mentioned(replyTo({ id: 42, is_bot: false }))).toBe(false);
  });

  it('ignores a reply to a DIFFERENT bot sharing the group', () => {
    expect(new TestAdapter().mentioned(replyTo({ id: 888, is_bot: true }))).toBe(false);
  });

  it('claims nothing before getMe has resolved this bot identity', () => {
    expect(new TestAdapter(null).mentioned(replyTo({ id: 777, is_bot: true }))).toBe(false);
  });

  it('leaves the vendor mention test intact for plain @mentions', () => {
    const adapter = new TestAdapter();
    expect(adapter.mentioned({ ...replyTo({ id: 42, is_bot: false }), text: 'hey @nanoclaw_bot ping' })).toBe(true);
    expect(adapter.mentioned({ ...replyTo({ id: 42, is_bot: false }), text: 'nothing for you here' })).toBe(false);
  });
});

describe('outbound: quoting the message being answered', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('quotes the target in a group', async () => {
    const fetchMock = stubSendMessage();
    await new TestAdapter().postMessage(GROUP, postable('Tuesday works', '-1001234:11'));

    expect(sentPayload(fetchMock).reply_parameters).toEqual({ message_id: 11, allow_sending_without_reply: true });
  });

  it('never quotes in a DM — nothing to disambiguate, and it would clutter every turn', async () => {
    const fetchMock = stubSendMessage();
    await new TestAdapter().postMessage(DM, postable('Tuesday works', '6037840640:11'));

    expect(sentPayload(fetchMock)).not.toHaveProperty('reply_parameters');
  });

  it('sends unquoted when the host had no target', async () => {
    const fetchMock = stubSendMessage();
    await new TestAdapter().postMessage(GROUP, postable('scheduled digest'));

    expect(sentPayload(fetchMock)).not.toHaveProperty('reply_parameters');
  });

  it('sends unquoted rather than failing when the target is not a Telegram message id', async () => {
    const fetchMock = stubSendMessage();
    // The router synthesizes an inbound id when an adapter reports none.
    await new TestAdapter().postMessage(GROUP, postable('answer', 'msg-1700000000-ab12'));

    expect(sentPayload(fetchMock)).not.toHaveProperty('reply_parameters');
  });

  it('sends unquoted rather than failing when the target belongs to another chat', async () => {
    const fetchMock = stubSendMessage();
    await new TestAdapter().postMessage(GROUP, postable('answer', '-1009999:11'));

    expect(sentPayload(fetchMock)).not.toHaveProperty('reply_parameters');
  });

  it('does not leak a target into the next send to the same chat', async () => {
    const fetchMock = stubSendMessage();
    const adapter = new TestAdapter();
    await adapter.postMessage(GROUP, postable('first', '-1001234:11'));
    await adapter.postMessage(GROUP, postable('second'));

    expect(sentPayload(fetchMock, 0).reply_parameters).toEqual({ message_id: 11, allow_sending_without_reply: true });
    expect(sentPayload(fetchMock, 1)).not.toHaveProperty('reply_parameters');
  });

  it('leaves non-send calls alone while a target is pending', async () => {
    const fetchMock = stubSendMessage();
    const adapter = new TestAdapter();
    await adapter.startTyping(GROUP);
    await adapter.postMessage(GROUP, postable('answer', '-1001234:11'));

    expect(sentPayload(fetchMock, 0)).not.toHaveProperty('reply_parameters');
    expect(sentPayload(fetchMock, 1).reply_parameters).toEqual({ message_id: 11, allow_sending_without_reply: true });
  });
});

describe('force-reply: the person answered replies to the bot by default', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks only the person being answered to reply, on a quoted group answer', async () => {
    const fetchMock = stubSendMessage();
    await new TestAdapter().postMessage(GROUP, postable('Tuesday works', '-1001234:11'));

    expect(sentPayload(fetchMock).reply_markup).toEqual({ force_reply: true, selective: true });
  });

  it('never forces a reply on unquoted sends (DMs, scheduled posts)', async () => {
    const fetchMock = stubSendMessage();
    const adapter = new TestAdapter();
    await adapter.postMessage(DM, postable('Tuesday works', '6037840640:11'));
    await adapter.postMessage(GROUP, postable('scheduled digest'));

    expect(sentPayload(fetchMock, 0)).not.toHaveProperty('reply_markup');
    expect(sentPayload(fetchMock, 1)).not.toHaveProperty('reply_markup');
  });

  it('never displaces markup the send already carries', async () => {
    const fetchMock = stubSendMessage();
    const keyboard = { inline_keyboard: [[{ text: 'Yes', callback_data: 'y' }]] };
    await new TestAdapter().sendWithTarget({ chat_id: '-1001234', text: 'Approve?', reply_markup: keyboard }, 11);

    expect(sentPayload(fetchMock).reply_markup).toEqual(keyboard);
    expect(sentPayload(fetchMock).reply_parameters).toEqual({ message_id: 11, allow_sending_without_reply: true });
  });
});

/** The Bot API method each fetch call hit, in order. */
function methods(fetchMock: ReturnType<typeof stubSendMessage>): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]).split('/').pop() ?? '');
}

describe('announcements: standalone and pinned', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends without a quote or force-reply, strips the marker, then pins the sent message', async () => {
    const fetchMock = stubSendMessage();
    await new TestAdapter().postMessage(GROUP, postable('<announce/>\nBlock clean-up — 3 October', '-1001234:11'));

    expect(methods(fetchMock)).toEqual(['sendMessage', 'pinChatMessage']);
    const sent = sentPayload(fetchMock);
    expect(sent).not.toHaveProperty('reply_parameters');
    expect(sent).not.toHaveProperty('reply_markup');
    expect(String(sent.text)).not.toContain('announce');
    expect(String(sent.text)).toContain('3 October');
    expect(sentPayload(fetchMock, 1)).toMatchObject({ chat_id: '-1001234', message_id: 99 });
  });

  it('still delivers when pinning fails (bot lacks the pin right)', async () => {
    const fetchMock = stubSendMessage();
    fetchMock.mockImplementation(async (input: unknown) =>
      String(input).endsWith('/pinChatMessage')
        ? new Response(JSON.stringify({ ok: false, error_code: 400, description: 'not enough rights' }), {
            status: 400,
          })
        : new Response(
            JSON.stringify({
              ok: true,
              result: { message_id: 99, chat: { id: -1001234, type: 'supergroup' }, date: 1_700_000_100, text: 'ok' },
            }),
            { status: 200 },
          ),
    );
    const sent = await new TestAdapter().postMessage(GROUP, postable('<announce/> Market day'));

    expect(sent.id).toBeTruthy();
    expect(methods(fetchMock)).toEqual(['sendMessage', 'pinChatMessage']);
  });

  it('leaves ordinary replies alone, and a marker mid-text is not an announcement', async () => {
    const fetchMock = stubSendMessage();
    await new TestAdapter().postMessage(GROUP, postable('use <announce/> to pin', '-1001234:11'));

    expect(methods(fetchMock)).toEqual(['sendMessage']);
    expect(sentPayload(fetchMock).reply_parameters).toBeDefined();
  });

  it('recognises the marker on every text-bearing postable shape', () => {
    expect(takeAnnouncement('<announce/>hi')).toBe('hi');
    expect(takeAnnouncement({ raw: '<announce />hi' } as AdapterPostableMessage)).toEqual({ raw: 'hi' });
    expect(takeAnnouncement(postable('<ANNOUNCE/> hi', '-1001234:11'))).toEqual({ markdown: 'hi' });
    expect(takeAnnouncement(postable('hi'))).toBeUndefined();
  });
});

// telegram.ts is reinstalled from the channels branch on every update, so the
// wiring lives in the chat-sdk bridge. These fail if that hook is lost.
describe('wiring: the bridge upgrades a vendor-built adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns the adapter telegram.ts builds into a reply-aware one', () => {
    const adapter = createTelegramAdapter({ botToken: 'test-token', mode: 'polling' });
    createChatSdkBridge({ adapter, supportsThreads: false });

    expect(adapter).toBeInstanceOf(ReplyAwareTelegramAdapter);
  });

  it('an upgraded instance quotes and forces a reply like a constructed one', async () => {
    const fetchMock = stubSendMessage();
    const adapter = upgradeToReplyAware(createTelegramAdapter({ botToken: 'test-token', mode: 'polling' }));
    await adapter.postMessage(GROUP, postable('Tuesday works', '-1001234:11'));

    expect(sentPayload(fetchMock).reply_parameters).toEqual({ message_id: 11, allow_sending_without_reply: true });
    expect(sentPayload(fetchMock).reply_markup).toEqual({ force_reply: true, selective: true });
  });

  it('leaves non-Telegram adapters alone', () => {
    const other = { name: 'slack' } as unknown as Parameters<typeof upgradeToReplyAware>[0];
    expect(Object.getPrototypeOf(upgradeToReplyAware(other))).toBe(Object.prototype);
  });
});
