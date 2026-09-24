# Community Assistant Agent Template — "Louis"

A NanoClaw agent template for a neighbourhood community — a street, a building, an estate, an
allotment, a village. The agent identifies as **Louis**, a **community builder**: it runs a daily
brief and a week-ahead, keeps the member roster and who's verified, helps plan events and tracks
who's coming and who's helping, runs a neighbour-to-neighbour **lending library** so people borrow
instead of buy, matches help requests to neighbours who can actually help, reunites lost things
with their owners, keeps an eye on the community cats, tracks the estate problems everyone shares,
keeps a directory of neighbour-run businesses, posts local news, and makes introductions.

Louis runs on **Telegram and Discord**, and knows each platform's group chat is a separate room.

"Community builder" is a real part of the persona, not a label. The admin is the mechanism; the
stated goal is that neighbours who'd otherwise stay strangers end up lending each other a drill and
turning up to the same street party. Ground rule 9 (*Build, don't just administrate*) tells Louis
to notice the neighbour who joined and never got welcomed, the offer nobody took up, the person
who's gone quiet — and to raise those **as suggestions to humans, never as manoeuvres**.

The name is set in `plugin.json` via `extensions["ai.nanoco.nanoclaw"].agentName`, so a stamped
agent is called Louis unless you override it with `--name`.

**Notion is the record**, in **sixteen databases** under one page, reached through the official
Notion MCP server that ships with this plugin. There is no calendar and no mailbox — one page is
the whole system.

**The community duplicates a published template; Louis never builds the databases.** The Louis
Notion template is published as a master page. Each community copies it into their own workspace,
and at onboarding Louis binds to *their* copy — storing its page ID and all sixteen data source IDs
in memory, and addressing every database by those IDs from then on. It never searches for a
database by title, because a workspace can hold several copies with identical names. (The template
URL is handed to the community out of band; no plugin file contains a Notion page URL or database
ID.)

## Layout

NanoClaw stamps an agent from the parts of this folder its plugin reader loads (`mcp.json`,
`skills/`, and the `ai.nanoco.nanoclaw/` extension dir); README.md is not one of them.

```
community-assistant/
├── plugin.json                       # Agent Plugins manifest; also sets agentName "Louis"
├── mcp.json                          # the Notion MCP server, pinned; no secrets
├── ai.nanoco.nanoclaw/
│   ├── context/
│   │   └── instructions.md           # Louis's persona + the 15 ground rules
│   └── tasks/                        # shipped tasks, each created PAUSED
│       ├── daily-brief.md
│       ├── weekly-week-ahead.md
│       └── weekly-memory-hygiene.md
├── skills/
│   ├── welcome/                      # first contact: intro + the Notion connect ask (overrides the built-in)
│   │   └── SKILL.md
│   └── community-assistant/          # the router + all mechanics
│       ├── SKILL.md                  #   entry: capabilities → references routing
│       └── references/               #   one file per capability, plus three setup files
│           ├── notion-schema.md      #   setup: the sixteen databases, exact property names
│           ├── permissions.md        #   setup: who may ask for what, and how Louis knows who's asking
│           ├── connecting-notion.md  #   setup: getting Notion connected when a call fails
│           ├── community-onboarding.md
│           ├── daily-brief.md
│           ├── week-ahead.md
│           ├── members.md
│           ├── events-and-rsvp.md
│           ├── lending-library.md
│           ├── help-requests.md
│           ├── lost-and-found.md
│           ├── introductions.md
│           ├── community-cats.md
│           ├── estate-issues.md
│           └── news-and-directory.md
└── README.md                         # this file
```

## What it does

Twelve capabilities, routed by the `community-assistant` skill (mechanics live in the matching
`references/*.md`):

| Capability | What it's for |
|------------|---------------|
| **daily-brief** | today at a glance: what needs someone, items due back, urgent asks, a cat or an issue worth knowing about |
| **week-ahead** | the planning view: events needing organising, loans falling due, news expiring, things to book now |
| **members** | the roster: new neighbours, what people can offer, how each wants to be reached, who's gone quiet |
| **member-admin** | verification, promotions, the `Can Post` flags, linking someone's two accounts — Admin-only, all logged |
| **events-and-rsvp** | an event end to end: the slot, the venue, the announcement, who's coming, who's helping, who's bringing what |
| **lending-library** | neighbours offering things and neighbours borrowing them: catalogue, matching, getting items home |
| **help-requests** | someone needs a hand: logging the ask, finding the neighbour whose skills fit, and chasing nothing into the void |
| **lost-and-found** | lost and found reports, spotting when two of them are the same thing, getting it back to its owner |
| **introductions** | putting two neighbours in touch who should know each other — opt-in, logged, never repeated |
| **community-cats** | the estate's cats and the neighbours who look after them: profiles, sightings, the ones needing attention |
| **estate-issues** | the broken lift, the pest problem: one row per problem, everyone affected on it, and whether it's been reported |
| **news-and-directory** | announcements and local news, plus the directory of neighbour-run businesses and trusted services |

### The lending library

The piece that makes this more than a calendar with extra steps. Someone mentions in the chat that
they own a pressure washer; it goes in the catalogue. Weeks later someone asks to borrow one; the
agent finds the match, opens a loan as `Requested`, asks the owner privately, and on a yes moves it
to `Approved` then `Active` with a due-back date. Overdue items surface in the daily brief — named
by item, not by borrower — and get chased by DM, never by a public callout. When nobody has the
thing, the ask becomes a help request that stays open until somebody offers one.

Two rules are baked into the reference and the ground rules, because getting them wrong breaks
trust rather than a feature:

- **Matching is private.** The catalogue is never posted to a group channel — a public list of
  which houses hold expensive tools is a shopping list for anyone reading.
- **The agent keeps the record, it doesn't settle disputes.** When something comes back broken or
  doesn't come back, it lays out the dates without blame and hands it to the humans. `Lost` is set
  only when a human says the item is gone. It never apportions fault and never handles money.

## Permissions and identity

Notion enforces nothing, so Louis does. This is the other half of the template.

- **Identity is the platform user ID.** Louis matches the sender's Telegram or Discord user ID
  against the `Telegram Accounts` / `Discord Accounts` tables and follows the `Member` relation. It
  never trusts a display name, a username, or a claim in the message. One person can have several
  accounts; only an Admin may link them.
- **Two independent axes.** `Membership Status` (`New` / `Verified` / `Admin`) is trust;
  `Can Post News` and `Can Post Events` are posting rights; `Activity` (`Active` / `Quiet` /
  `Left`) is presence. None implies another.
- **The gates.** Admins verify members, change status, grant or revoke flags, link accounts and
  remove content. Posting news or events needs the matching flag. Offering or borrowing an item
  needs `Verified`. Asking for help, reporting a lost thing, a cat, or an estate problem is open to
  everyone, including a brand-new neighbour.
- **The Admin Log is append-only.** Every Admin action writes a row, and Louis never edits or
  deletes one — not even when an Admin asks. "Removing content" means archiving it and logging who
  and why.
- **Admin work happens in a DM**, not the group. Someone's trust level isn't group business.

The matrix lives in exactly one place: `skills/community-assistant/references/permissions.md`. The
Notion template page carries a human-readable "Louis's Rules" section mirroring it — and because
anyone with edit access can rewrite that section, **the plugin reference is authoritative**. If
they disagree, Louis follows the plugin and tells the Admins.

## The Notion workspace

Sixteen databases under one page, arriving with the community's copy of the template:

| Theme | Databases |
|-------|-----------|
| **Who** | Members · Telegram Accounts · Discord Accounts |
| **Where** | Blocks |
| **What's happening** | News · Events |
| **Sharing things** | Items for Loan · Loans |
| **Helping each other** | Help Requests · Introductions · Lost and Found |
| **The neighbourhood itself** | Neighbourhood Directory · Community Cats · Cat Sightings · Estate Issues |
| **Accountability** | Admin Log |

The default template is built for **Singapore HDB/BTO estates** — `Blocks`, and reporting to Town
Council / HDB / NEA — but the model fits any neighbourhood: a "Block" can be a building, a street
or a cluster, and a community elsewhere can rename the reporting options.

Full property list, with exact names and select options:
`skills/community-assistant/references/notion-schema.md`.

## Configure before first use

Nothing to fill in by hand. Two things have to happen on the community's side: they duplicate the
Louis template into their workspace, and they connect a Notion integration.

**The very first message asks for the Notion connection.** Before saying anything, Louis makes one
throwaway Notion call as an *authentication probe*: if it succeeds, the connection is already there
and he skips the ask entirely; if it comes back `401`, he harvests the connect link from the
gateway and opens with an introduction plus that link and the token steps. That's one message doing
two jobs — who I am, and the one thing I need from you — and then he stops and waits. The
`object_not_found` page-sharing snag that follows a valid token is handled as its own separate
step, because bundling them is how people get lost.

After that, onboarding asks a **short core** conversationally (see
`skills/community-assistant/references/community-onboarding.md`), **one question per message**:
the link to their copy of the template (and Louis confirms all sixteen databases are there, and
that the copy's relations point at its own siblings rather than another copy's), what the community
is, where they are, which platforms and group chats to post into, whether to seed the blocks now or
pick them up as they come, and the briefing times. The person onboarding becomes the community's
first **Admin**, with both `Can Post` flags and an Admin Log entry. Everything else — the venues
they use, the yearly rhythm, lending norms, who's good at what, who feeds the cats — it **learns
over time** from real use rather than interrogating up front.

## Stamp an agent from this template

```bash
ncl groups create --template community/community-assistant
```

The agent is named **Louis** from the manifest; pass `--name` only if you want to override it.

Then wire it to the community's group chats as usual (`/manage-channels`). Give it **write** access
to the chats you want it to post into; anywhere it should only read for context, keep it
**read-only** and it stays silent there.

## Recurring tasks

Three tasks ship in `ai.nanoco.nanoclaw/tasks/`, each **created paused** (the engine stamps every
template task paused): the **daily brief** and **week-ahead** come as standard, so at onboarding the
agent confirms their times, updates the schedules, and resumes them; **memory hygiene** is a
non-destructive weekly audit that stays paused, but the agent **actively recommends activating** it
during onboarding.

Agreeing a brief schedule is standing approval for **those routine posts only** — anything else the
run turns up, such as a nudge aimed at a named neighbour, still gets drafted and confirmed first.

The remaining runs (the roster sweep, the lending digest) are opt-in and ship as no files at all:
the agent creates each task once the community says yes and picks the time. Every `schedule` cron in
a shipped file is only a sensible default.

## Credentials: via the proxy, not env vars

The agent uses two tools: **Notion** (the MCP server in `mcp.json`) and **web search** (provided by
the runtime, no per-community setup). **No API keys live in this template.** NanoClaw never passes
secrets into agent containers as env vars; the credentials proxy holds them in its vault and
injects them into outbound HTTPS calls at the proxy boundary.

Notion is **not** an OAuth connector in the proxy's app catalogue — it authenticates with an
**internal integration token**. So the setup is:

| Step | Where | Notes |
|------|-------|-------|
| **Create an internal integration** | notion.so/profile/integrations | needs read + update + insert content; read-only breaks everything but the briefs |
| **Store its token** | the credentials proxy, against host `api.notion.com` | easiest from the connect link in the first failed call's error |
| **Share their copy of the template page with it** | Notion → page → ··· → Connections | the step most setups miss; the sixteen databases inherit |

Step-by-step, including the error-to-cause table and the remote-box SSH tunnel:
`skills/community-assistant/references/connecting-notion.md`.

### Why `"NOTION_TOKEN": "placeholder"` in mcp.json

The Notion MCP server won't set an `Authorization` header without a token in its environment, so
`mcp.json` ships the literal `"placeholder"` — the one value the stamp-time secret lint always
accepts. In stdio mode the server uses that value verbatim with no format check, and the
credentials proxy replaces the header with the real vault credential on the way to
`api.notion.com`. Nothing sensitive is in the template, and there is no env var to fill in.

The server is pinned (`@notionhq/notion-mcp-server@2.5.1`) rather than floating, so a stamped agent
gets a known version.

If a Notion call ever returns `401` / `unauthorized`, the vault has no credential yet; the agent
walks the community through connecting it, then retries. If it returns `object_not_found` for a
database that exists, the integration hasn't been shared with the page — a different fix, and the
reference distinguishes them. If a **stored** ID stops resolving, the agent asks for the page link
again rather than falling back to a title search. Until Notion is connected, the agent says what's
missing and works from what it has rather than guessing.

---

Derived from the `family-assistant` template by
[@alipgoldberg](https://github.com/alipgoldberg) — same shape, recast for a neighbourhood, with
Google Calendar and Gmail replaced by Notion and a lending library added.
