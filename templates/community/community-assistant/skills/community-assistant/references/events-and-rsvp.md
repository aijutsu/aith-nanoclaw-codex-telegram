# Events & RSVP

Help the community get something to actually happen: pin the slot, find the place, write the
announcement, and keep track of who's coming, who's helping, and who's bringing what. You take it
as far as the tools allow and hand off the last step you can't do. Never claim a booking you can't
point to a real reply for.

**Posting an event to the community needs `Can Post Events`, or Admin** (`permissions.md`).
Anyone can *ask* you to plan one, and drafting is always fine — the gate is on the post going out.

This covers **rescheduling** too: when the week-ahead flags an event that can't happen as planned —
the hall's taken, the host's away, nobody's coming — **propose** moving it. You can't decide for
the community. Once they say go, rebook it the same way and update the Notion row.

## Three statuses, and what carries the rest

Events `Status` is only `Upcoming`, `Cancelled`, `Completed`. The planning state lives in the
properties, not the status:

- **Is anyone running it?** `Host`.
- **Is it short-handed?** `Helpers Short` — the formula, `Helpers Needed` minus the people in
  `Helpers`. Never write it; change `Helpers Needed` or the `Helpers` list.
- **Is it full?** `Capacity` against the number of `Attendees`, counted with code (ground rule 13).
- **Has it been announced?** Nothing in Notion records this, so **note it in memory** against the
  event's page ID when the post goes out. Otherwise you'll offer to announce the same thing twice.

## Steps

1. **Nail down the ask**: what, when, for whom, roughly how many, and any constraints (budget,
   indoors, kid-friendly, accessible). Fill gaps from the profile, or ask — one question at a time.
   **Create the Events row early**, `Status` = `Upcoming`, rather than holding it in your head; a
   half-planned event that lives only in a chat message is the one that doesn't happen. `Location`
   here is plain text — the venue or the corner of the street.
2. **Find the place and how to book it**: web-search the venue, its booking path (an online form,
   an email, a phone number), its hours, and what it costs (`Cost`). If the community has used it
   before, memory knows the quirks — who holds the key, how far ahead they take bookings — so check
   there first and don't re-research what you already learned.
3. **Take the booking as far as the tools allow.**
   - **Email-bookable** (most halls, most community spaces): draft the request, show it, and send
     only on a clear go-ahead.
   - **Online form**: drive it with agent-browser — find the slot, fill the form, and stop before
     the final submit. Show exactly what you're about to book and finish only on their say-so. If
     it demands a login, payment, a CAPTCHA, or a verification code, tee everything up and hand
     them the link to finish.
   - **Phone only**: you can't call; hand them the number with the details to give.
   - **Money is theirs.** A venue that takes a deposit or a fee stops at the handoff, always
     (ground rule 7, *You keep the record; you don't settle the dispute*).
4. **Say what you need, then announce it once they approve.** Set `Helpers Needed` to the number of
   hands the host wants. Draft the post — what, when, where, what to bring, how to say you're
   coming, and what's still needed — show it, and post only on approval (ground rule 4), as an
   announcement (`SKILL.md`, *Output style*: standalone and pinned). An online event gets its
   `Online Link` in the post. Then record in memory that it's been announced, and on
   which platforms; each platform's group chat is a separate room (ground rule 11).
5. **Track sign-ups as they land, in the right property.**
   - Coming → add to **`Attendees`**.
   - Helping → add to **`Helpers`**, which is what `Helpers Short` counts. Someone doing both goes
     in both.
   - Bringing something → add it to **`Bringing`**, as a readable line ("Sarah: chairs; Tom:
     drinks"), so the host can see the gaps at a glance.
   - New face → create the Member row first (`members.md`), don't leave the relation empty.
6. **Chase the gap, not the crowd.** A week out, if `Helpers Short` is above 0, that's what goes in
   the brief — with a name worth asking, drawn from Members' `Skills` (or `Interests` where it's
   about enthusiasm rather than skill), as a proposal, reached through their `Reach Me By`
   preference. Don't chase RSVPs for their own sake; a headcount is only urgent when catering or
   `Capacity` depends on it, and then say why you're asking. A person free in Notion is not a
   person who said yes.
7. **Close it out.** After the day, set `Status` = `Completed`. Put what's worth knowing next time
   in the event's page content — the turnout, what ran out, the thing everyone said should be
   different — and carry the short version into memory. That note is the whole reason next year's
   version goes better.

**Cancelling** is `Status` = `Cancelled`, never deleting the row. If an Admin is removing it rather
than the host calling it off, log it (`permissions.md`, *removing content*).

## Output

```
For approval (before anything sends, submits, or posts)
> <the booking request, or the announcement as it would appear>

Once it's moving
📅 <event>: <date · time> at <place> — <status: held / booked / awaiting reply>
👍 Going: <n>/<capacity> · 🙋 Helpers: <n> of <needed> · Bringing: <what's covered>

Can't-finish handoff (login, payment, CAPTCHA, or phone)
Here's everything teed up; finish here: <link or number>, <details to give them>

After
✅ <event> done — <n> came. <the one thing worth remembering for next time>
```

Show the draft first and wait; the held/booked/handoff lines follow, depending on how the booking
goes.

## Tracking a reply

You aren't woken when a venue emails back, so when a booking is pending, schedule a one-time
follow-up task to check for the reply (and check again on later runs if it hasn't arrived). When it
lands, update the Events row and tell the host. If it's declined or offers another time, bring it
back to them — don't accept an alternative slot on the community's behalf.
