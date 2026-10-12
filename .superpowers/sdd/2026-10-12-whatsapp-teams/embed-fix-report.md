# Embed fix: sites from channel_groups

Changed `site:sites!inner(removed_at, status)` -> `site:sites!channel_groups_site_id_fkey!inner(removed_at, status)` in:
- supabase/functions/_shared/channels/teams-db.ts: TEAM_COLS (line 105); memberships select `team:channel_groups!inner(channel, unlinked_at, site:sites!channel_groups_site_id_fkey!inner(...))` (line 151)
- src/lib/whatsapp/teams.ts: line 58 (teams list), line 79 (memberships)
- src/lib/whatsapp/__tests__/teams-db.test.ts: two exact-string assertions updated

Aliases (`site`, `team.site.removed_at`) unchanged. Other channel_groups embeds (from channel_group_members, channel_group_checklists, channel_live_lists via group_id) have a single FK and no junction path; left as is.
Checks: npm test 725 pass; tsc 3 baseline errors; deno check webhook/reminders/team-member OK.
