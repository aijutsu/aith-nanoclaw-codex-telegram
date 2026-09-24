# Lost and Found

Someone drops their keys by the lift; someone else picks them up and has no idea whose they are.
Both of them tell the chat, three days apart, and nothing happens. This capability closes that gap:
one row per report, and your job is to notice when two of them are the same thing.

Runs on the **Lost and Found** database (`notion-schema.md`). **Anyone may report, including a
`New` member** (`permissions.md`).

## Logging a report

- **`Item`** as a neighbour would say it ("black house keys with a bottle opener"), and the detail
  that identifies it in `Description`.
- **`Report Type`**: `Lost` or `Found`. This is the only property that decides which way round the
  story runs, so get it right.
- **`Reported By`**, `Date` (when it was lost or found, not when they told you), `Category`,
  `Platform`, and `Location` resolved to a Blocks row with the specifics in `Location Detail` ("by
  the lift lobby on the ground floor").
- **`Status`** = `Open`.
- **`Photo`** whenever they sent one. For a found item a photo does most of the work, and it lets
  you avoid describing it precisely enough for someone to claim it falsely.

**`Currently Held At` is private.** For a found item, record where it is — "with the reporter",
"handed to the guardhouse" — and then **never post it to the group**. It can reveal where someone
lives. It goes to the likely owner, once, when they've identified the thing (ground rule 6,
*Privacy in a semi-public place*).

## Matching

Every new report gets checked against the open ones on the other side: a new `Found` against open
`Lost` reports, and a new `Lost` against open `Found` ones. Compare `Category`, `Location`, `Date`
and the description — a lost phone on Tuesday by the playground and a found phone on Tuesday by the
playground is a match worth raising even if the descriptions don't line up word for word.

When you think two reports are the same thing:

1. Set **`Status` = `Possible Match`** on both rows.
2. Set **`Matched Report` on both rows.** This relation is **one-way**, so setting it on one row
   does *not* set it on the other. Two writes, every time. A half-linked pair is the single most
   common mess in this table, and the weekly hygiene run checks for it.
3. **Go to the likely owner privately** with what was found and where — not `Currently Held At`
   yet — and ask whether it sounds like theirs.
4. **Let them confirm it.** You never declare a match, and you never tell the finder whose it is
   before the owner has said so.

Being wrong here is cheap and fine. Not looking is what costs someone their keys.

## Closing one

- **Reunited** → `Status` = `Returned`, `Returned To` set to the owner's Members row, `Resolved On`
  = today. Do the same on the paired row so both sides close together.
- **Went nowhere** → `Status` = `Closed` with `Resolved On`, after checking with the reporter. An
  unclaimed found item eventually belongs to whoever's holding it, and that's their call, not
  yours.
- **Never delete a row.** `Closed` is the ending (`notion-schema.md`, *Working with them*).

## In the daily brief

Reports that are `Open` or `Possible Match` carry into the brief (`daily-brief.md`) — the item and
where, never who's holding it. A `Possible Match` waiting on someone to confirm is the more useful
line of the two, because it's one message away from being solved.

## Output

```
Logged
🔎 Lost: <item>, <where>, <when>   ·   🧤 Found: <item>, <where>, <when>

Possible match  (to the likely owner, privately)
Someone found <item> near <block> on <date> — does that sound like yours?

Reunited
✅ <item> back with <owner> — thanks <finder>

Still open
- <item> (<lost/found> <date>, <block>)
```

Never put `Currently Held At` in any of these except the private message to a confirmed owner.
