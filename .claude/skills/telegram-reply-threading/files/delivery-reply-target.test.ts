/**
 * Recovering the platform message id a reply should quote.
 *
 * The container stamps `messages_out.in_reply_to` with the `messages_in.id`
 * it answered, and the router namespaces inbound ids per agent group
 * (messageIdForAgent) because one inbound fans out into several session DBs
 * where `id` is a PRIMARY KEY. Stripping our own suffix is the whole job —
 * but only our own: an id that never went through that namespacing is not an
 * inbound the platform can be asked to quote.
 */
import { describe, expect, it } from 'vitest';

import { platformReplyTarget } from './delivery.js';

describe('platformReplyTarget', () => {
  it('strips the agent-group namespace the router added', () => {
    expect(platformReplyTarget('-1001234:11:ag-community', 'ag-community')).toBe('-1001234:11');
  });

  it('strips only the trailing suffix, leaving ids that contain colons intact', () => {
    expect(platformReplyTarget('discord:guild:chan:88:ag-1', 'ag-1')).toBe('discord:guild:chan:88');
  });

  it('has no target when the row carries no in_reply_to', () => {
    expect(platformReplyTarget(null, 'ag-1')).toBeUndefined();
  });

  it('has no target for an id namespaced to a DIFFERENT agent group', () => {
    // Not ours to decode — an id minted for another group's session DB.
    expect(platformReplyTarget('-1001234:11:ag-other', 'ag-community')).toBeUndefined();
  });

  it('has no target for an id that never went through router namespacing', () => {
    // Agent-to-agent return paths and direct writes stamp their own ids.
    expect(platformReplyTarget('out-42', 'ag-1')).toBeUndefined();
  });

  it('has no target when stripping would leave nothing', () => {
    expect(platformReplyTarget(':ag-1', 'ag-1')).toBeUndefined();
  });
});
