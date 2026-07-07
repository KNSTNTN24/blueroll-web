-- Estate invites can target a specific site (Team → Invite member → Site).
-- Nullable = whole-group (owner/estate) invite. Set after create_invite() by token.
alter table public.invites add column if not exists site_id uuid references public.sites(id) on delete set null;
