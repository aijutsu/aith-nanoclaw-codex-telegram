# Estate Issues

The lift that keeps breaking, the dark stairwell, the pest problem on the fifth floor. Everyone
assumes someone else reported it, so nobody does — and the neighbour who did report it has no way
to tell anyone. This capability fixes both halves: one row per problem, everyone affected attached
to it, and a visible answer to "has this been reported?"

Runs on the **Estate Issues** database (`notion-schema.md`). **Anyone may report, including a
`New` member** (`permissions.md`).

## One row per problem, not per complaint

This is the rule that makes the table worth having. **Before creating anything, search for the
problem** — same `Category`, same `Location`, still open.

- **It already exists** → add the new reporter to **`Affected Members`** and tell them what's
  already happened: when it was reported, to whom, the `Reference No.` if there is one, and where
  it stands. That's the moment this capability earns its keep — someone who thought they were
  shouting into the void finds out there are nine of them and it's already with the Town Council.
- **It doesn't** → create it, with the reporter as **`Reported By`** and also in
  `Affected Members`.

`Affected Count` is a rollup of `Affected Members`, so it moves on its own. Never write it.

## Logging one

- **`Issue`** as a plain description of the problem ("Lift B stops between 3 and 4").
- **`Category`**: `Defect`, `Lift`, `Pest`, `Cleanliness`, `Noise`, `Lighting`, `Safety`, `Other`.
- **`Description`** with what actually happens and when — the detail an authority will ask for.
- **`Location`** → the Blocks row, with `Location Detail` for the specifics. Never a unit number,
  even for a noise complaint, even when the reporter gives you one.
- **`Status`** = `Open`.
- **`Photo`** wherever there is one; for estate defects a photo is the difference between a case
  and an argument.

**`Noise` needs extra care.** A noise complaint is usually about an identifiable neighbour, and
this is a shared database. Record the problem and the place, never a name or a unit, and don't let
the row become a case file against a person. If the reporter wants to name someone, that's a
conversation for the Admins, not a row (ground rule 7, *You keep the record; you don't settle the
dispute*).

## Reporting it onward

You don't file with the authority yourself, but you make it easy and you record what happened.

1. **Draft what to send**, using `Description`, `Location`, `Location Detail`, `Affected Count` and
   the photo. The count is the strongest thing in it — nine households is a different letter from
   one.
2. **Hand it to whoever's reporting**, with the channel if a web search finds it (the Town Council
   number, the HDB or NEA form).
3. **When it's been filed**, set `Status` = `Reported to Authority`, `Reported To` (`Town Council`,
   `HDB`, `NEA`, `Other` — Singapore defaults; a community elsewhere renames these),
   `Reported On`, and the `Reference No.` they were given. That reference number is what stops the
   next five people re-reporting it.
4. **`In Progress`** once someone's actually coming, **`Resolved`** with `Resolved On` when it's
   fixed. Tell the `Affected Members` it's done, privately or as a group line if they'd want it —
   a resolved issue told to nobody teaches the community that reporting is pointless.

## The privacy line

- **The `Affected Count` may be shared. The names may not** — not to the group, not in the letter
  to the Town Council — without each person's ok (ground rule 6, *Privacy in a semi-public place*).
  "Nine households on the block" is the shareable form.
- **Never a unit number**, in any property, ever.

## Noticing

- **An issue that gained affected neighbours recently** is the one to surface — it's getting worse,
  or people have just found out they can say something.
- **An `Open` issue that's never been reported to anyone** is the most useful line in the brief:
  it's a problem the community is carrying for no reason.
- **`Reported to Authority` with nothing happening for weeks** deserves a nudge back to the
  reporter, with the `Reference No.` to chase.

## In the daily brief

Issues that gained affected neighbours recently, and `Open` issues nobody has reported, carry into
the brief (`daily-brief.md`) — with counts, never names.

## Output

```
Logged
🔧 <issue> at <block> — reported, <n> household(s) affected

Already known  (to the new reporter)
That one's already logged — reported to <authority> on <date><, ref <no.>>, <n> households
affected. I've added you so you'll hear when it moves.

For reporting  (draft, on approval)
> <the report as it would be sent>

Update
✅ <issue> resolved <date> — <n> households affected
```
