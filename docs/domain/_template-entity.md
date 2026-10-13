# <Entity name> (`<main_table>`)

> One sentence: what this is in the product, in the words a kitchen owner would use.

**Tables:** `main_table`, `child_table` · **Scope:** business / site / person · **Last verified:** YYYY-MM-DD against `main@<sha>` and the live DB

## What it is for

Two or three sentences: the job it does for the customer and why it exists (link the spec it came from).

## Parameters

| Field (UI label) | DB column | Meaning | Allowed values | Enforced by |
|---|---|---|---|---|
| | | | | DB `CHECK` / code `path:line` / nowhere |

### Known drift

Values in live data that break the rule above (with counts and date checked), and what the canonical value is.

## Lifecycle

How it is created (every path: web, mobile, edge function, RPC, trigger, seed), changed, deactivated and deleted.
What happens to dependent rows (FK `ON DELETE` behaviour).

## Who can do what

| Action | Rule | Enforced in |
|---|---|---|
| See | | RLS policy `...` |
| Create / edit | | |
| Delete | | |

## Related

- **Entities:** links to other entity pages and how they connect.
- **Concepts:** links.

## Where in code

| Area | Location |
|---|---|
| Web pages | |
| Shared logic | |
| Mobile | |
| Edge functions / cron | |
| DB objects | |

## Gotchas

Numbered list. Surprising behaviour, traps, legacy columns, web/mobile differences, open bugs (link issues).

## History

Specs and PRs that shaped it, newest first (one line each).
