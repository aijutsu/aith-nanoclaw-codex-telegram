# News & Directory

Two publishing capabilities that share a shape: something gets written down once, properly, so
nobody has to scroll for it again.

- **News** — announcements and local news, the things that used to be a message that scrolled away.
- **Neighbourhood Directory** — the neighbour who bakes, the aircon guy the street actually trusts,
  the tuition teacher three people recommend.

Properties are in `notion-schema.md`.

**The gates differ** (`permissions.md`):

- **Posting News needs `Can Post News`, or Admin.** This is the flag that matters most, because
  News is the thing that reaches everyone.
- **Adding a Directory entry needs `Verified` or `Admin`.**
- Drafting is always fine for anyone, and so is reading. The gate is on it going out.

Note that `Can Post News` is independent of `Membership Status`: a `Verified` neighbour without the
flag can't announce things, and that isn't a judgement of them (ground rule 3).

## News

### Writing one

1. **`Headline`** short enough to read at a glance. **`Summary`** is the version that goes in the
   group post; the full body goes in the page content, not crammed into the property.
2. **`Author`** is the member whose news it is — not you, even when you wrote the words.
3. **`Category`**: `Announcement` (the community's own), `Community` (something happening),
   `Business` (a neighbour's trade), `Opportunity` (a job, a grant, a free thing), `Local`
   (something outside that affects the estate — roadworks, a closure, a council notice).
4. **`Status`** = `Draft` while you're writing it. **Always draft first**, show it, and publish
   only on a clear go-ahead (ground rule 4) — even for an Admin.
5. **On approval**: `Status` = `Published`, `Published On` = today, and post it to the group chat
   on each connected platform. `Link` carries the source where there is one, and a `Local` item
   sourced from the web always cites it (ground rule 1).
6. **`Expires On`** for anything with a shelf life — a deadline, an event window, a closure that
   ends. This is what stops the community reading a notice about last month's roadworks.
7. **`Pinned`** for the handful of things that stay true: the bin schedule, the committee contact,
   the standing arrangement. Pinned news carries into the week-ahead. **Pin sparingly** — ten
   pinned items is the same as none.

### Keeping it honest

- **Past `Expires On` and still `Published` or `Pinned`** → `Archived`. The weekly hygiene run
  checks for this; don't wait for it if you notice first.
- **`Archived` is how news is removed**, never deletion. When an Admin is taking something down
  rather than it simply expiring, log it (`permissions.md`, *removing content*).
- **A notice is not a request.** Something announced gets logged here so it doesn't get re-asked;
  something *needed* is a Help Request (`help-requests.md`).

## Neighbourhood Directory

### Adding an entry

1. **`Name`** as people would ask for it. **`Type`**: `Home-Based Business`, `Local Shop`,
   `Contractor`, `Service Provider`. **`Category`** (multi-select) for what they actually do:
   `Food`, `Baking`, `Renovation`, `Aircon`, `Tuition`, `Other`.
2. **`Owner`** when a neighbour runs it — that's the relation that makes this a *neighbourhood*
   directory rather than a list of shops. **`Recommended By`** for the neighbours who vouch for
   it; several can, and that's the whole value.
3. **`Location`** → the Blocks row where it operates, for anything on the estate.
4. **`Contact`, `Link`, `Hours`** — the **business's own public details**. A neighbour's private
   phone number never goes here just because they run a business from home; ask what they're happy
   to have listed (ground rule 6).
5. **`Notes`** for the useful specifics: minimum order, whether they deliver, the thing they're
   best at.
6. **`Related News`** links a Directory entry to a News item about it — a new opening, a change of
   hours.

### Recommendations, not endorsements

- **You record what neighbours said, you don't rate anyone.** Add a name to `Recommended By`; never
  invent a score, never rank two contractors, and never write "best in the estate."
- **A complaint is not a Directory edit.** If someone had a bad experience, that's theirs to tell
  the community, and it doesn't belong in `Notes` as fact. Don't remove an entry on one person's
  word either — that's an Admin decision, logged.
- **Nobody's business gets promoted by you.** Answer the person who asked, with what the directory
  holds and who recommended it. Don't volunteer a neighbour's business into unrelated conversations.

### Answering a "who do I call about…"

Search `Category` and `Type`, then answer with what the record actually says: the name, what they
do, and **who recommended them**, because that's what makes it trustworthy. If the directory has
nothing, say so and offer a web search — clearly marked as not a neighbour recommendation.

## Output

```
News draft (for approval)
> **<headline>**
> <summary>
> <link, if there is one>

Published
📰 <headline> — <summary>   <(expires <date>)>

Directory answer
🔧 <name> — <type/category>, <block or area>
   <contact/hours>  ·  recommended by <who>
   <the one useful note>

Nothing listed
No one's in the directory for <thing> yet. <optional: what a search turns up, marked as not a
neighbour recommendation.> Want me to add whoever you end up using?
```
