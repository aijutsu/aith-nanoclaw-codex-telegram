# Lending Library

Neighbours own things they use twice a year. This is the capability that gets those things moving:
members offer what they're willing to lend, you keep the catalogue, and when someone needs
something you find who has it and put the two of them in touch. You run the *record* — the
handover happens between people.

Two databases carry it: **Items** (the catalogue) and **Loans** (one row per borrow, so the history
survives). Properties are in `notion-workspace.md`.

**Two rules sit above everything here:**

- **You match privately, you don't broadcast.** A public list of which houses hold expensive tools
  is a shopping list for anyone reading the channel. Answer a borrow request by going to the owner,
  or by telling the borrower who to ask — never by posting the catalogue (ground rule 4).
- **The owner always decides.** An item marked `Available` means "I'm open to lending this," not
  "yes." Every match is a question to the owner, never a booking you made for them.

## When someone offers an item

Usually it arrives as an aside in the chat — "I've got a pressure washer if anyone ever needs it."
Take it seriously; that's the catalogue growing.

1. **Catch the name they'd be asked for.** Log it the way a neighbour would ask ("pressure washer"),
   not the model on the box. Add the brand to `Notes` if it matters for what it fits.
2. **Ask the one thing that isn't obvious.** Usually that's the terms: how long is fine, does the
   owner want to hand it over in person, is there anything it must not be used for. One question —
   if they answered it while offering, don't ask again.
3. **Create the Item** with `Owner`, `Category`, `Availability` = `Available`. Leave `Condition`
   blank rather than inventing one.
4. **Don't announce it.** Say thanks to the offerer and let it surface when someone needs it. If
   the community wants a periodic "here's what's in the library" post, that's the opt-in digest at
   the bottom — and it names items, not addresses.

## When someone wants to borrow

1. **Log the ask first**, as a Request with `Kind` = `Borrow`, before you go looking. If no match
   turns up, that open request is what gets it answered later when somebody new offers.
2. **Search the catalogue** on what it's *for*, not just the word they used — someone asking for a
   "carpet cleaner" wants the pressure washer's cousin, and `Category` plus `Notes` will find it
   where an exact title match won't. Check `Availability` and check Loans for anything `Out`.
3. **Match, then ask the owner.** Message the owner privately with who's asking, what for, and
   when. If the owner's `Reach me by` says DM or doorbell, respect it. Wait for a yes — never tell
   the borrower it's sorted before the owner has said so.
4. **No match?** Say so plainly and leave the request `Open`. Then say what you *can* do: ask the
   community whether anyone has one (a general ask, naming no one's inventory), or look up what it
   costs to hire locally. Don't pad the gap with a near-match nobody wants.
5. **On a yes, open the Loan.** Create the row with `Item`, `Borrower`, `Lent on`, and a `Due back`
   the two of them agreed — **ask for it if it wasn't said**, because a loan with no date is how
   things go missing. Set the Item's `Availability` to `On loan` and mark the Request `Resolved`.
   All three writes, or the next brief lies.

## Getting things home again

- **The daily brief carries it.** Loans due today and anything overdue appear there
  (`daily-brief.md`); you don't need a separate chase task.
- **Nudge the borrower, not the room.** An overdue item is nearly always someone forgetting, and a
  public callout costs the community more than the item. Message them; offer to tell the owner it's
  on its way.
- **On return**, set `Returned on`, `Status` = `Returned`, `Condition back`, and put the Item's
  `Availability` back to `Available`. Tell the owner it's back.
- **When it comes back damaged, or doesn't come back**, write what the record shows —
  factually, no blame, no theory about what happened — set `Status` to `Lost` if that's where it
  landed, and hand it to the two of them. You don't adjudicate, you don't apportion cost, and you
  don't decide who owes what (ground rule 5). If they ask you to settle it, say plainly that's
  theirs to settle and offer to lay out the dates.
- **A long loan isn't automatically a problem.** Some things live at a neighbour's for months by
  agreement. Check the record before you treat a date as overdue.

## Output

```
Offer logged
📗 <item> from <owner> — in the library, <terms>

Match found  (to the owner, privately)
<Borrower> is after <item> for <when/what for>. Happy to lend it?

On loan
📕 <item>: <owner> → <borrower>, back by <date>

No match
Nobody's offered a <item> yet — I've kept the ask open and I'll pick it up if one turns up.
<optional: what it costs to hire locally, with the source>

Back home
✅ <item> returned to <owner> <(condition note, if there is one)>
```

On ask ("what's in the library?", "what have I got out?"), answer the person in front of you:
a borrower gets what's available in the category they want, an owner gets their own items and
who has them. Neither gets the whole catalogue posted to a group.

## The weekly digest (opt-in)

Once the catalogue has real items in it, offer a weekly or monthly post: what's newly offered,
what's out and coming back, and any borrow request still waiting on someone. Create it per the
`community-assistant` skill's *Turning on a scheduled run* — only on a clear yes. It names items
and the fact they exist, never who lives where.
