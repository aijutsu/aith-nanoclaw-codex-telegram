# Open Requests

Things get asked in a community chat and then scroll away. Somebody needs a hand moving a sofa,
somebody asks who to call about the streetlight, somebody offers help nobody picks up — and three
days later it's forty messages up and gone. This capability is the standing watch that stops that
happening. Different from the daily brief, which carries today: this is the *ongoing* accounting
of what's been asked and not answered.

It runs on the Requests database (`notion-workspace.md`), and it's mostly ambient: you log asks as
they happen, and surface the stale ones when they've genuinely gone quiet.

## Logging an ask

When a message is an ask, log it. The judgement is *is this a thing that needs an answer* — not
who asked or how politely:

- **`What`** in the asker's own words, trimmed to the ask itself. Don't summarise it into
  officialese; "does anyone know why the water's off on Bell Street" is the request.
- **`Kind`** — `Borrow` (hand it to `lending-library.md`), `Help needed`, `Question`, `Notice`
  (something announced, not asked — log it so it doesn't get re-asked), or `Offer` (someone
  offering; an unanswered offer is as sad as an unanswered ask).
- **`Asked by`**, `Opened` = today, `Status` = `Open`, and `Thread` where the platform gives you a
  link back.
- **Don't log chatter.** A community chat is mostly conversation; a database full of "morning
  all" is a database nobody trusts. When in doubt, it's not a request.

## Closing one

- **Watch for the answer in the chat.** Most requests get answered by a neighbour within the hour
  and nobody tells you. When you see it, set `Status` = `Answered`, `Owner` to whoever stepped up,
  and `Resolved`. A request left `Open` after it was handled is worse than not logging it — it
  makes every later report noise.
- **`Resolved` vs `Answered`**: answered means someone replied, resolved means the thing actually
  happened. A sofa still needs moving after three people say "I'd help but I'm away."
- **`Dropped` is a legitimate ending.** Some asks stop mattering. Marking one dropped, after
  checking, is better than carrying it forever.

## The stale check

What counts as stale depends on the kind, and this judgement is the whole capability:

- A **`Help needed`** with a date attached is stale the moment there isn't time left to arrange it.
- A **`Question`** is stale after a day or two unanswered — long enough that the chat has clearly
  moved on.
- A **`Borrow`** waits as long as it takes; it's not stale, it's pending a lender
  (`lending-library.md`). Don't nag about it, just pick it up when something matching gets offered.
- An **`Offer`** nobody took up is worth one surface, then let it go — chasing it embarrasses the
  person who offered.

**Surface each stale request once**, not every morning. A watch that repeats itself daily gets
muted, and then it isn't a watch. If nothing has gone stale, say nothing at all — silence is the
correct output most days.

## Escalating

When something's been open a while and it's real, don't just re-list it. Do one of:

- **Name a likely person**, from Members' `Can offer`, as a question to them or to the room —
  a proposal, never an assignment.
- **Answer it yourself** where a web search genuinely answers it (the council number, the opening
  hours, who to report a streetlight to). Cite the source.
- **Ask the asker whether it still matters.** Often it doesn't, and that's a clean close.

## Output

```
📬 Still open

- <request> — asked by <who>, <how long ago>
  <the next step: a name worth asking, an answer you found, or "still need someone">
```

On ask ("what's outstanding?"), list the open requests oldest first with who asked and how long
they've been waiting. Otherwise this only speaks up when something's genuinely gone quiet.
