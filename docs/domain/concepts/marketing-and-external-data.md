# Marketing leads and external data (not product data)

> Four tables in the product database hold data that is not about a customer's kitchen: the free-HACCP-template lead
> list with its email drip, and a cached copy of Toronto's DineSafe inspections used by mobile onboarding.

**Touches:** [Business](../entities/business.md) (onboarding lookups) · **Last verified:** 2026-10-13 against `main`, mobile `origin/main` and the live DB

## Lead magnet: `template_leads`, `template_email_log`

| Table | What it holds | Writers / readers |
|---|---|---|
| `template_leads` | People who downloaded the free HACCP template on the landing site (email, `source`, `page`, `note`, `unsubscribed_at`). 47 rows (2026-04-10 → 2026-10-13). | Insert: anon policy `template_leads_insert`, from the landing pages (`/free-haccp-template.html`, `/haccp-template-scotland.html`, repo `mariaiontseva/blueroll-landing`). Read: RPCs `list_template_leads()`, `count_template_leads()`. |
| `template_email_log` | The 3-letter follow-up drip per lead: `letter` 1–3, `sent_at`, `opened_at`, `clicked_at`, `click_target`, `resend_id`, `error`. 116 rows since 2026-08-26. | Live cron `haccp-drip-hourly` → edge function `drip?a=send` (deployed, **in no repo** — #59; secret in plain text — #68). |

**Personal data.** These are customers' prospects' emails. `list_template_leads()` is SECURITY DEFINER and executable
by `anon`, so anyone with the public anon key can read the whole list — [#112](https://github.com/KNSTNTN24/blueroll-web/issues/112).
The mobile repo's older `capture-lead` function and `leads` table (`haccp-mobile/supabase/migrations/20260403_create_leads.sql`)
do not match this schema and are not used.

## DineSafe cache: `dinesafe_cache`, `dinesafe_refresh_meta`

| Table | What it holds | Writers / readers |
|---|---|---|
| `dinesafe_cache` | A snapshot of Toronto's public DineSafe inspection dataset (establishment, address, status, last inspection, counts). 22,254 rows, refreshed once on 2026-04-05. | Read: RPC `search_dinesafe(q)` from mobile Canada/US onboarding city search (`haccp-mobile/lib/features/onboarding/data/supabase_inspection_client.dart`). |
| `dinesafe_refresh_meta` | Singleton (`id = 1`) with the last refresh status. | Refresh: edge function `dinesafe-refresh` (source in `haccp-mobile/supabase/functions/`, deployed, **not scheduled** — data is stale since April). |

The web app does not use DineSafe; UK onboarding looks up the FSA rating (FHRS) instead — see [Business](../entities/business.md).

## Gotchas

1. The lead list is readable without login until #112 is fixed.
2. The drip function and the DineSafe refresh live outside this repo (#59); changing the tables can break them unseen.
3. DineSafe data is a stale public snapshot — don't present it as current.
