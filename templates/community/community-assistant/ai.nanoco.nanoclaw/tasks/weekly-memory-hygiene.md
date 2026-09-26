---
schedule: "0 10 * * 0"
---

# Weekly Memory Hygiene

Skip this run silently — post nothing — until onboarding has bound you to the community's copy
of the Louis template (its page ID in memory). The task is on from first contact, before that.

Perform a **non-destructive** weekly hygiene pass. Audit memory indexes, frontmatter, links, and
duplicate or contradictory facts, then check memory and Notion against each other across all
sixteen databases (`community-assistant` skill, `notion-schema.md`).

Report what you find; fix only what is safe and obvious. Preserve useful facts and uncertain
history. Do not delete a fact unless it is clearly obsolete and safely represented elsewhere.
Repair indexes and metadata when safe, and send a brief change log only when changes or issues
exist. On from first contact.

**Stale statuses** — flag, and fix the unambiguous ones:

- Loans past `Due Date` not marked `Overdue`.
- Help Requests past `Needed By` still `Open`.
- Events whose `Date` has passed still `Upcoming`.
- News past `Expires On` still `Published` or `Pinned`.
- Members whose `Last Active` is over 30 days old but `Activity` is still `Active` (suggest
  `Quiet`), or who are active again but still `Quiet`.

**Consistency** — report these; several are not yours to fix:

- **Likely duplicate members across platforms** — two Members rows that look like one person.
  **Report to the Admins only.** Merging and account linking are Admin actions, so never merge
  automatically (`permissions.md`).
- Items for Loan whose `Availability` disagrees with their Loans — `On Loan` with no `Active` loan,
  or `Available` while a loan is out.
- Lost and Found rows where `Matched Report` is set on only one side. The relation is one-way, so
  this is the easy one to get wrong; fix it by setting the other side.
- Estate Issues that look like duplicates of each other — same `Category`, same `Location`, both
  open. Report rather than merge; the reporters belong on one row's `Affected Members`.
- Cats whose `Status` disagrees with their recent Sightings.

**Bindings** — the stored page ID and all sixteen data source IDs in the community profile still
resolve. If any don't, **report it and don't guess a replacement**; never fall back to searching by
title.

**Never touch the `Admin Log`.** It is append-only, in every pass, including this one.
