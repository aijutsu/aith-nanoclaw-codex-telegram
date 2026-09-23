# The Notion Workspace

Notion is the community's record, and this is its shape. Every capability reads and writes these
five databases; when a capability says "the roster" or "the catalogue," it means the database
below. **Read this before your first write of a session** so you use the real property names
rather than inventing them.

The databases live under one parent page (call it whatever the community calls itself). Cache the
parent page id and each database id in memory after onboarding so you don't re-search for them
every run; if a cached id ever returns `object_not_found`, re-search by name and update memory.

## Members

Who is in the community. The hub the other four relate to.

| Property | Type | Notes |
|----------|------|-------|
| Name | title | how the community refers to them |
| Handle | rich_text | their handle in the group chat, so you can match a message to a member |
| Street / block | rich_text | the coarse location only; a full address belongs in a private note, not here (ground rule 4) |
| Joined | date | when they turned up |
| Status | select | `Active`, `Quiet`, `Left` |
| Can offer | multi_select | skills, help, and the kinds of things they lend — what makes them findable |
| Reach me by | select | `Group chat`, `DM`, `Email`, `Doorbell` — how they want to be contacted |
| Notes | rich_text | the soft knowledge: who they know, what they care about, what to leave alone |

## Events

Anything the community gathers for. Replaces the shared calendar.

| Property | Type | Notes |
|----------|------|-------|
| Name | title | |
| When | date | use the date range when it has a start and end |
| Place | rich_text | the venue or the corner of the street |
| Status | select | `Idea`, `Planned`, `Announced`, `Done`, `Cancelled` |
| Organiser | relation → Members | who owns it |
| Going | relation → Members | RSVPs |
| Helpers needed | rich_text | the roles still unfilled — the daily brief reads this |
| Bringing | rich_text | who said they'd bring what |
| Notes | rich_text | |

## Items

The lending catalogue: what neighbours have offered to lend.

| Property | Type | Notes |
|----------|------|-------|
| Item | title | plain name, the way someone would ask for it ("pressure washer", not "Kärcher K5") |
| Owner | relation → Members | whose it is |
| Category | select | `Tools`, `Garden`, `Kitchen`, `Kids`, `Outdoor`, `Media`, `Other` |
| Condition | select | `Good`, `Worn`, `Needs care` |
| Availability | select | `Available`, `On loan`, `Unavailable`, `Retired` |
| Lend terms | rich_text | how long, any conditions, whether the owner wants to hand it over in person |
| Notes | rich_text | the quirks: what it doesn't fit, what it needs, what breaks it |

## Loans

One row per borrow. The history lives here, so never overwrite a loan to record a new one.

| Property | Type | Notes |
|----------|------|-------|
| Loan | title | `<Item> → <Borrower>`, so the row is readable on its own |
| Item | relation → Items | |
| Borrower | relation → Members | |
| Lent on | date | |
| Due back | date | what the daily brief checks against |
| Returned on | date | empty until it comes home |
| Status | select | `Out`, `Returned`, `Overdue`, `Lost` |
| Condition back | rich_text | filled in at return, factually and without blame (ground rule 5) |

## Requests

Every ask the community makes, so none of them quietly dies in the chat.

| Property | Type | Notes |
|----------|------|-------|
| What | title | the ask in the asker's own words, trimmed |
| Asked by | relation → Members | |
| Kind | select | `Borrow`, `Help needed`, `Question`, `Notice`, `Offer` |
| Opened | date | |
| Status | select | `Open`, `Answered`, `Resolved`, `Dropped` |
| Owner | relation → Members | who picked it up, once someone has |
| Resolved | date | |
| Thread | url | a link back to the message, where the platform gives you one |

## Creating them

At onboarding, **search first**: a community that already keeps a Notion workspace may have some
of this under other names, and reusing what exists beats a parallel set of empty databases. Map
what you find onto the roles above, note the real property names in memory, and only create what's
genuinely missing.

When you do create, make the parent page first, then the databases in this order — Members, Items,
Events, Requests, Loans — so each relation has something to point at. Create them in one pass and
tell the community what you made in one short message, not a running commentary.

## Working with them

- **Query, don't scan.** Filter on the property you care about (`Status`, `Due back`, `Availability`)
  rather than pulling every row and sorting in your head; these grow.
- **A relation needs the page id**, so resolve a name to its Members row before you write, and
  create the member if they're genuinely new (`members` capability) rather than leaving the
  relation empty.
- **Write the change, don't narrate it.** When a loan comes back, set `Returned on`, flip `Status`
  to `Returned`, and set the item's `Availability` back to `Available` — all three, or the next
  brief lies.
- **Don't delete.** Archive or set a terminal status (`Left`, `Retired`, `Dropped`, `Cancelled`);
  the community's history is worth more than a tidy table.
