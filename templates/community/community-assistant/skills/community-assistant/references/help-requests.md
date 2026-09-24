# Help Requests

Somebody needs a hand moving a sofa, somebody's stuck with a router, somebody's mum needs looking
in on. In a chat these scroll away and three days later they're forty messages up and gone. This
capability is the standing watch that stops that happening: you log the ask, you find the neighbour
whose skills actually fit, and you make sure nothing quietly dies.

Runs on the **Help Requests** database (`notion-schema.md`). **Anyone may ask, including a `New`
member** — this is the most open table in the workspace, and deliberately so (`permissions.md`).

## Logging an ask

When a message is an ask, log it. The judgement is *is this a thing that needs an answer* — not
who asked or how politely:

- **`Request`** in the asker's own words, trimmed to the ask itself. Don't summarise it into
  officialese; "can anyone help me get a wardrobe up to the 8th floor" is the request.
- **`Type`**: `Errand`, `Moving/Lifting`, `Pet Care`, `Tech Help`, `Childcare`,
  `Elderly Check-in`, `Advice`, or `Other`. A borrow request that found nothing in the catalogue
  lands here as `Other` (`lending-library.md`); a problem with the estate itself is an Estate Issue
  instead (`estate-issues.md`).
- **`Requested By`**, `Status` = `Open`, `Platform`, and `Location` resolved to their Blocks row.
- **`Needed By` and `Urgency`** where they said or where it's obvious. A date is what makes this
  answerable later — "before Saturday" is worth capturing; "sometime" isn't worth inventing one for.
- **`Relevant Skills`** — the honest guess at what would let someone help. This is the property
  that does the matching, so fill it even when nobody's asked you to.
- **Don't log chatter.** A community chat is mostly conversation; a database full of "morning all"
  is a database nobody trusts. When in doubt, it's not a request.

There's no created-time property here, so when you need to know how long something's been sitting,
read the page's own creation time from the API rather than guessing.

## Finding someone

This is the part that makes you useful rather than a form.

1. **Match `Relevant Skills` against Members' `Skills`.** Skip anyone whose `Activity` is `Left`.
2. **Ask them privately**, through their `Reach Me By` preference, one at a time or a few in
   parallel — and **as a question, never an assignment**. "Tom, Aisha needs a hand shifting a
   wardrobe on Saturday morning — any chance?" A name in a database is not a commitment.
3. **Never volunteer someone publicly.** It's the fastest way to lose a volunteer, and it puts
   them on the spot in front of the street.
4. **On a yes**, add them to `Helpers` and set `Status` = `Helper Found`. Several people can help;
   `Helpers` is a list, so don't overwrite it.
5. **When it's actually happened**, `Status` = `Done`. If it stops mattering, `Cancelled` — after
   checking with the asker, and that's a clean ending, not a failure.
6. **Nobody fits?** Say so plainly and ask the room in general terms. Then leave it `Open`; a
   matching skill may walk in next week.

`Helper Found` means someone said yes. `Done` means the thing actually happened. A sofa still needs
moving after three people say "I'd help but I'm away."

## The stale check

What counts as stale depends on the ask, and this judgement is the whole capability:

- **`Urgent`, or past `Needed By` and still `Open`** — that's the daily brief's business, today
  (`daily-brief.md`).
- **A dated ask** is stale the moment there isn't time left to arrange it. Say that plainly rather
  than carrying it silently.
- **An undated ask** is stale after a couple of days unanswered — long enough that the chat has
  clearly moved on.
- **A borrow-shaped `Other`** waits as long as it takes; it's not stale, it's pending a lender.
  Don't nag about it, just pick it up when something matching gets offered.

**Surface each stale request once**, not every morning. A watch that repeats itself daily gets
muted, and then it isn't a watch. If nothing has gone stale, say nothing at all — silence is the
correct output most days.

## Escalating

When something's been open a while and it's real, don't just re-list it. Do one of:

- **Name a likely person**, from `Skills`, as a question to them — a proposal, never an assignment.
- **Answer it yourself** where a web search genuinely answers it (the council number, the opening
  hours, who to report a streetlight to). Cite the source.
- **Ask the asker whether it still matters.** Often it doesn't, and that's a clean close.

## Output

```
📬 Still open

- <request> — asked by <who>, <how long ago> <(needed by <date>)>
  <the next step: a name worth asking, an answer you found, or "still need someone">
```

On ask ("what's outstanding?"), list the open requests with the urgent and time-bound ones first,
who asked, and how long they've been waiting. Otherwise this only speaks up when something's
genuinely gone quiet.
