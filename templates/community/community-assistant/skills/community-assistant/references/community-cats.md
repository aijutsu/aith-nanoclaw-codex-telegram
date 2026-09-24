# Community Cats

Most estates have cats that belong to nobody and to everybody, and a handful of neighbours who
quietly feed them, get them sterilised, and worry when one doesn't show up. This capability gives
those people a shared record instead of a group chat they have to scroll.

Two databases: **Community Cats** (one row per cat) and **Cat Sightings** (one row per time someone
saw one). Properties are in `notion-schema.md`.

**Adding a cat profile needs `Verified` or `Admin`; reporting a sighting is open to everyone**,
including a `New` neighbour (`permissions.md`). That split is deliberate — a passer-by should be
able to say "there's an injured cat by block 5" without any ceremony.

## The caretakers come first

`Caretakers` is the most important relation in this table. These are the neighbours who actually
look after the cat, and they are the people who need to know things — before the group, before
anyone.

**When a cat's `Status` becomes `Missing` or `Injured`, tell its `Caretakers` first**, privately,
through their `Reach Me By` preference. Only then consider whether the wider community should hear
about it, and ask before posting (ground rule 4). A missing cat posted to the street before the
person who feeds it every day has been told is a small cruelty.

## Adding a cat

- **`Name`** as the community calls it, even when that's "Three-Legs" or the same cat has two names
  on two platforms. Note the other name in `Description`.
- **`Description`** is for recognition: markings, size, temperament, whether it lets people near.
- **`Photo`** whenever there is one. For cats, a photo is worth every word of description.
- **`Usual Spots`** → the Blocks rows where it's normally seen. Several can apply.
- **`Sterilised`** — tick it only when someone actually knows. An unticked box means unknown, and
  it's worth asking the caretakers, because it's the single most useful fact here.
- **`Caretakers`** → the Members rows of whoever feeds or looks after it.
- **`Status`** = `Regular` for a cat that's simply around.
- **`Health Notes`** for the ongoing things — the bad ear, the limp, the medication.

**Two sightings of what might be the same cat** is a question for the caretakers, not a merge you
perform. Ask before you combine two profiles.

## Logging a sighting

Sightings arrive casually — "saw the tabby by the bin chute, looked hungry". Log it anyway; a run
of sightings is how you know a cat is fine, and a gap is how you know it isn't.

- **`Sighting`** as a short readable title, **`Cat`** linked where the reporter knew which one —
  **leave it empty when they didn't**, rather than guessing. An unlinked sighting still tells you
  something.
- **`Reported By`**, **`Seen At`** (date with time — "this morning" needs resolving to a real
  timestamp with code, ground rule 13), **`Location`** → Blocks, plus `Location Detail`.
- **`Condition`**: `Looks Fine`, `Hungry`, `Injured`, `Unwell`.
- **`Photo`** if they sent one.

**A sighting is not a status change.** One `Hungry` report doesn't make a cat `Injured`. But an
`Injured` or `Unwell` sighting goes to the caretakers straight away, and if the cat's row says
`Regular`, ask them whether it should change.

## Noticing

- **A `Regular` cat with no sightings for a while** is worth mentioning to its caretakers —
  quietly, as a question, not an alarm. Work out the gap with code.
- **Repeated `Hungry` sightings in one spot** usually mean a caretaker is away. Say so; someone
  will cover.
- **`Missing` that turns out fine** → back to `Regular`, and say so, because relief is worth
  sharing.
- **`Rehomed` and `Passed On`** are endings. Keep the row; the community's history is worth more
  than a tidy table. When a cat passes on, say it plainly and warmly in the group if the caretakers
  want that, and never bury it in a daily brief between a loan and a broken lift.

## In the daily brief

Cats that are `Missing` or `Injured`, plus any recent sighting whose `Condition` is worrying, carry
into the brief (`daily-brief.md`) — after the caretakers have been told.

## Output

```
Cat logged
🐈 <name> — usually around <block(s)>, cared for by <caretakers>

Sighting logged
👀 <cat or "a cat"> at <block>, <when> — <condition>

To the caretakers (privately, first)
<Name> was seen at <block> <when> looking <condition>. Worth a look?

Needs attention
- 🐈 <name>: <missing since / injured, reported <when>> — caretakers told
```
