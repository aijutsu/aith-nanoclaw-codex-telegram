# Community Assistant Agent Template

A NanoClaw agent template for a neighbourhood community — a street, a building, an estate, an
allotment, a village. It runs a daily brief and a week-ahead, keeps the member roster true, helps
plan events and tracks who's coming, runs a neighbour-to-neighbour **lending library** so people
borrow instead of buy, and makes sure open requests don't scroll away unanswered.

**Notion is the record.** Members, events, items, loans and requests all live in Notion databases,
reached through the official Notion MCP server that ships with this plugin. There is no calendar
and no mailbox — one workspace is the whole system.

## Layout

NanoClaw stamps an agent from the parts of this folder its plugin reader loads (`mcp.json`,
`skills/`, and the `ai.nanoco.nanoclaw/` extension dir); README.md is not one of them.

```
community-assistant/
├── plugin.json                       # Agent Plugins manifest (marks the folder as a plugin)
├── mcp.json                          # the Notion MCP server, pinned; no secrets
├── ai.nanoco.nanoclaw/
│   ├── context/
│   │   └── instructions.md           # persona + the ground rules
│   └── tasks/                        # shipped tasks, each created PAUSED
│       ├── daily-brief.md
│       ├── weekly-week-ahead.md
│       └── weekly-memory-hygiene.md
├── skills/
│   ├── welcome/                      # first contact: intro + onboarding (overrides the built-in)
│   │   └── SKILL.md
│   └── community-assistant/          # the router + all mechanics
│       ├── SKILL.md                  #   entry: capabilities → references routing
│       └── references/               #   one file per capability, plus two setup files
│           ├── notion-workspace.md   #   setup: the five databases every capability uses
│           ├── connecting-notion.md  #   setup: getting Notion connected when a call fails
│           ├── community-onboarding.md
│           ├── daily-brief.md
│           ├── week-ahead.md
│           ├── members.md
│           ├── events-and-rsvp.md
│           ├── lending-library.md
│           └── open-requests.md
└── README.md                         # this file
```

## What it does

Six capabilities, routed by the `community-assistant` skill (mechanics live in the matching
`references/*.md`):

| Capability | What it's for |
|------------|---------------|
| **daily-brief** | today at a glance: what's on, what still needs someone, items due back, asks nobody answered |
| **week-ahead** | the planning view: events needing organising, things to book now, volunteer gaps, loans falling due |
| **members** | the roster: new neighbours, what people can offer, how each wants to be reached, who's gone quiet |
| **events-and-rsvp** | an event end to end: the slot, the venue, the announcement, who's coming, who's bringing what |
| **lending-library** | neighbours offering things and neighbours borrowing them: catalogue, matching, getting items home |
| **open-requests** | the standing watch on asks that haven't been answered |

### The lending library

The piece that makes this more than a calendar with extra steps. Someone mentions in the chat that
they own a pressure washer; it goes in the catalogue. Weeks later someone asks to borrow one; the
agent finds the match, asks the owner privately, and on a yes opens a loan with a due-back date.
Overdue items surface in the daily brief and get chased by DM, never by a public callout.

Two rules are baked into the reference and the ground rules, because getting them wrong breaks
trust rather than a feature:

- **Matching is private.** The catalogue is never posted to a group channel — a public list of
  which houses hold expensive tools is a shopping list for anyone reading.
- **The agent keeps the record, it doesn't settle disputes.** When something comes back broken or
  doesn't come back, it lays out the dates without blame and hands it to the humans. It never
  apportions fault and never handles money.

## The Notion workspace

Five databases under one parent page, created by the agent at onboarding if they don't already
exist (it searches first and reuses what the community already keeps):

| Database | Holds |
|----------|-------|
| **Members** | the roster — handle, joined, status, what they can offer, how to reach them |
| **Events** | what the community gathers for — when, where, organiser, who's going, helpers still needed |
| **Items** | the lending catalogue — owner, category, availability, lend terms |
| **Loans** | one row per borrow — lent on, due back, returned, condition back |
| **Requests** | every ask — kind, who asked, status, who picked it up |

Full property list: `skills/community-assistant/references/notion-workspace.md`.

## Configure before first use

Nothing to fill in by hand. On first contact the agent asks a **short core** conversationally (see
`skills/community-assistant/references/community-onboarding.md`): what the community is, the Notion
connection, where they are, who's running it, the briefing times, and whether they want the lending
library. Everything else — the venues they use, the yearly rhythm, lending norms, who's good at
what — it **learns over time** from real use rather than interrogating up front.

## Stamp an agent from this template

```bash
ncl groups create --template community/community-assistant --name "Community Assistant"
```

Then wire it to the community's group chat as usual (`/manage-channels`). Give it **write** access
to the chat you want it to post into; anywhere it should only read for context, keep it
**read-only** and it stays silent there.

## Recurring tasks

Three tasks ship in `ai.nanoco.nanoclaw/tasks/`, each **created paused** (the engine stamps every
template task paused): the **daily brief** and **week-ahead** come as standard, so at onboarding the
agent confirms their times, updates the schedules, and resumes them; **memory hygiene** is a
non-destructive weekly audit that stays paused, but the agent **actively recommends activating** it
during onboarding.

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
| **Share the parent page with it** | Notion → page → ··· → Connections | the step most setups miss; child databases inherit |

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
reference distinguishes them. Until Notion is connected, the agent says what's missing and works
from what it has rather than guessing.

---

Derived from the `family-assistant` template by
[@alipgoldberg](https://github.com/alipgoldberg) — same shape, recast for a neighbourhood, with
Google Calendar and Gmail replaced by Notion and a lending library added.
