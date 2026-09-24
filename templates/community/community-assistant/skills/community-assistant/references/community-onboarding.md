# Community Onboarding

Run this the **first time** you meet a community (the `welcome` skill opens with it), then record
it in memory following your memory system: **one community concept as the entry point**, linked
from `memory/index.md`, holding the basics plus links out to the things that deserve their own
concept files (the organisers, the places the community uses, the standing arrangements). Details
live in the linked concepts, not in the hub.

Treat it as a starting point, not a fixed record. A neighbourhood is fluid — people move in and
out, the organiser changes, the hall gets a new booking rule — so when something you're doing
suggests a detail has changed, check and update it.

## First meeting

**Build the picture conversationally** (not as a form). Ask **one question at a time**, never more,
and let the answers lead. Tell them up front they can skip anything.

**Keep it short: onboard for tomorrow, not forever.** Ask only the few things you need to be useful
on day one (below, under *Ask now*). Everything else you learn in context, the first time it
actually comes up. A long interview before you've helped once is pure friction.

## Connect first

**Normally this is already done.** The `welcome` skill's first message asks for the Notion
connection before onboarding starts, so by the time you're here you can usually read and write.

Don't assume it, though — you also land here whenever you find no community profile in memory,
which can happen long after that first conversation. **Check** with one cheap Notion call. If it
works, you're in; say nothing about it and carry on. If it comes back `401`/unauthorized, or
`object_not_found` on a page that should exist, stop and fix that first via `connecting-notion.md`
— nothing below is worth asking for until you can write it down somewhere.

## Bind to their copy of the template

**This is the first thing you ask, and nothing else works until it's done.**

The Louis template is published as a master page, and each community **duplicates it into their own
workspace**. You work only on their copy — never the master, never another community's. A workspace
can hold several copies with identical titles, which is exactly why you never find a database by
searching for its name.

1. **Ask for the link to their copy.** One question, and be precise about which link you want: the
   page they duplicated into their own workspace, not the published template they copied it from.
   Nothing else in this step gets asked in the same message.
2. **Fetch the page and check what's there.** Confirm **all sixteen databases** are present as
   children of that page (`notion-schema.md` lists them). If any are missing, say which — by name,
   plainly — and stop. A copy missing its Loans database isn't something you can work around.
3. **Check the relations point at siblings.** Inside a correct copy, every relation targets a
   database on the same page: Members' `Block` should point at *this* copy's Blocks, not another
   copy's. Duplicating a page can leave relations aimed at the original, and it's invisible until
   something writes to the wrong workspace. Spot-check a few — Members `Block`, Loans `Item`,
   Cat Sightings `Cat` — and if any point elsewhere, **stop and tell them** rather than working
   around it.
4. **Store the page ID and all sixteen data source IDs** in the community profile in memory. From
   here on, address every database by its stored ID. Never search by title, not once, not as a
   fallback.
5. **If a stored ID ever stops resolving** — now or months later — say so and ask for the page link
   again. Don't guess a replacement and don't go looking by name.

**You never create these databases.** They arrive with the copy. If the community hasn't duplicated
the template yet, that's the one thing they have to do before you're any use; say so plainly and
wait.

## The first Admin

Once you're bound to their copy, the person you're talking to becomes the community's first Admin —
they're the one setting you up.

1. **Create their Members row**: `Membership Status` = `Admin`, `Can Post News` and
   `Can Post Events` both ticked, `Activity` = `Active`. This is the one time a member is created
   as an Admin; everyone after them starts as `New` (`permissions.md`).
2. **Create their account row** in `Telegram Accounts` or `Discord Accounts` — whichever platform
   they're writing from — with their platform user ID, and link it to that Members row.
3. **Write the `Admin Log` entry**: `Action Type` `Other`, `Summary` "first Admin created at
   onboarding", `Performed By` and `Target Member` both pointing at them.

Don't make a ceremony of it. One line is enough: they can verify neighbours and post
announcements, and you'll walk them through it the first time.

## Community profile

Two tiers. **Ask now** is the short core you need to be useful tomorrow. **Learn over time** is
everything else, captured the first time it comes up, never interviewed for.

### Ask now (the core)

- **What this community is**: [the name, and one line on what holds it together — a street, a
  building, an estate, an allotment, a village]. This sets your whole register; get it first.
- **The link to their copy** of the Louis template (see *Bind to their copy*, above). Cache the
  page ID and the sixteen data source IDs in memory.
- **Where they are**: [town/area **and country**], so weather, opening hours, local services and
  search come out local — a bare place name defaults to the wrong one.
- **Which platforms and which group chats** you should post into. You may be wired to Telegram,
  Discord, or both, and each platform's group chat is a separate room. Ask which rooms the briefs
  and announcements belong in, and note that anywhere you're read-only you'll stay quiet.
- **The blocks, offered not required**: [one light question]. Populating `Blocks` up front makes
  every location relation work immediately, so it's worth *offering* — "want to give me the block
  numbers now, or shall I add them as they come up?" Either answer is fine; take the second
  cheerfully (ground rule 15, *Seed light*). Never turn this into data entry.
- **The standard briefings**: the daily brief (default 7:00 daily) and the week-ahead (default
  Sunday 18:00), both come as standard. Name both with their defaults in **one message** and ask a
  single question — keep these or change either? — then resume each (leave a declined one paused).
  Stating two defaults together is one confirmation, so this stays within one-question-per-message.
  Say plainly that agreeing a time means those routine posts go out without asking each morning,
  and that anything else still gets checked with them first.
- **The lending library, on or off**: [one light question]. The databases exist either way, so this
  isn't about setting anything up — it's whether the community wants to *use* it, because it only
  works if people actually offer things. If yes, say you'll start the catalogue the first time
  someone offers something — don't ask them to fill it now. Note the answer in memory.

### Learn over time (don't ask at onboarding)

Note these against the community the first time they surface, from a request, a message, or an
event — not by interrogating up front:

- **The places they use**: the hall, the green, the café that lets them book the back room, and
  each one's quirks (how to book it, what it costs, who holds the key). Learned the first time you
  help plan an event.
- **The rhythm**: the monthly meet, the seasonal clear-up, the thing that always happens in
  August. Learned from the calendar of events as it fills.
- **The people**: who turns up, who lends, who quietly does the work, who to ask about what. This
  is the memory that makes you useful rather than mechanical, so give it real care as you learn it.
  The soft knowledge lives here, in memory — Members `Bio` is member-facing.
- **Lending norms**: how long is normal, whether people want deposits, who prefers a doorstep
  handover. Learned from the first few loans, not decided up front.
- **How to help each person**: who wants it short, who wants the detail, who to nudge and who to
  leave alone. Their stated contact preference goes in Members `Reach Me By`; the judgement about
  them goes in memory.
- **The cats, and who feeds them.** Learned the first time someone mentions one.
- **The sore spots**: the recurring argument, the thing that divides the street. You don't take
  sides (ground rule 7), but knowing where the ground is soft keeps you from walking onto it.

## Close with a first look

Once the profile is saved and you're bound to their copy, don't just stop; show immediate value.
Tell them you'll take a first look, then sweep the workspace and hand back a short preview:

- Pull the next few `Upcoming` events, anything `Open` in Help Requests or Lost and Found, anything
  `Active` or `Overdue` in Loans, and any `Open` estate issue.
- Surface it as a mini daily brief ("Here's what I'm already seeing"), so they get the feel of it
  on day one.
- **A freshly duplicated template is empty, and that's the normal case** — not an edge case. Say so
  plainly, name what you'll do as things start landing, and make the value land anyway. Then offer
  one concrete first move: log the next thing they've got coming up as an event, and you'll take it
  from there.
