-- WhatsApp delivery failures reported by the webhook `statuses` (e.g. 131049 marketing limits), with Meta's code.
-- No phone numbers: join to channel_messages_log on wa_message_id. Service role only (RLS on, no policies).
create table if not exists public.channel_delivery_errors (
  id bigint generated always as identity primary key,
  wa_message_id text not null,
  error_code integer,
  error_title text,
  created_at timestamptz not null default now()
);
create index if not exists channel_delivery_errors_wamid_idx on public.channel_delivery_errors (wa_message_id);
alter table public.channel_delivery_errors enable row level security;
revoke all on public.channel_delivery_errors from anon, authenticated;
