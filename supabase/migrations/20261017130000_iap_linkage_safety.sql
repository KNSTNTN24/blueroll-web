set search_path = public;

alter table public.businesses
  add column if not exists signup_trial boolean not null default false;

do $$
begin
  if exists (
    select 1 from public.businesses where iap_purchase_token is not null
    group by iap_purchase_token having count(*) > 1
  ) then
    raise exception 'Duplicate Google purchase tokens exist; reconcile them before applying IAP linkage safety';
  end if;
  if exists (
    select 1 from public.businesses where iap_original_transaction_id is not null
    group by iap_original_transaction_id having count(*) > 1
  ) then
    raise exception 'Duplicate Apple original transaction ids exist; reconcile them before applying IAP linkage safety';
  end if;
  if exists (
    select 1 from public.businesses
    where (iap_provider='apple' and iap_purchase_token is not null)
       or (iap_provider='google' and iap_original_transaction_id is not null)
       or (iap_provider is null and (iap_purchase_token is not null or iap_original_transaction_id is not null))
  ) then
    raise exception 'Inconsistent IAP provider identifiers exist; reconcile them before applying IAP linkage safety';
  end if;
end
$$;

create unique index if not exists uq_businesses_iap_purchase_token
  on public.businesses(iap_purchase_token) where iap_purchase_token is not null;
create unique index if not exists uq_businesses_iap_original_transaction_id
  on public.businesses(iap_original_transaction_id) where iap_original_transaction_id is not null;

create table if not exists public.iap_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('apple','google')),
  event_id text not null,
  event_type text not null,
  product_id text,
  external_reference text,
  token_sha256 text,
  token_ciphertext text,
  token_iv text,
  token_delete_after timestamptz,
  store_status text,
  expires_at timestamptz,
  business_id uuid references public.businesses(id) on delete set null,
  business_id_snapshot uuid,
  resolution text not null default 'processing'
    check (resolution in ('processing','matched','unmatched','conflict','error')),
  error_code text,
  received_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  attempt_count integer not null default 1 check (attempt_count > 0),
  processed_at timestamptz,
  unique(provider, event_id)
);

create index if not exists idx_iap_events_resolution_received
  on public.iap_events(resolution, received_at desc);
create index if not exists idx_iap_events_business
  on public.iap_events(business_id) where business_id is not null;

alter table public.iap_events enable row level security;
revoke all on public.iap_events from anon, authenticated;

create or replace function public.protect_business_entitlement()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') and (
       new.manual_status is distinct from old.manual_status
    or new.manual_until is distinct from old.manual_until
    or new.stripe_status is distinct from old.stripe_status
    or new.stripe_until is distinct from old.stripe_until
    or new.iap_status is distinct from old.iap_status
    or new.iap_expires_at is distinct from old.iap_expires_at
    or new.iap_provider is distinct from old.iap_provider
    or new.iap_product_id is distinct from old.iap_product_id
    or new.iap_purchase_token is distinct from old.iap_purchase_token
    or new.iap_original_transaction_id is distinct from old.iap_original_transaction_id
    or new.signup_trial is distinct from old.signup_trial
    or new.subscription_id is distinct from old.subscription_id
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.subscription_status is distinct from old.subscription_status
    or new.trial_ends_at is distinct from old.trial_ends_at
  ) then
    raise insufficient_privilege using message = 'entitlement columns are server-managed';
  end if;
  return new;
end
$$;

drop trigger if exists trg_protect_business_entitlement on public.businesses;
create trigger trg_protect_business_entitlement
  before update on public.businesses
  for each row execute function public.protect_business_entitlement();

create or replace function public.record_iap_purchase(
  p_token text,
  p_product_id text,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses%rowtype;
  v_role text;
begin
  if auth.uid() is null then raise insufficient_privilege using message='Not authenticated'; end if;
  if p_provider not in ('apple','google') then raise check_violation using message='Invalid provider'; end if;
  if nullif(btrim(p_token),'') is null or length(p_token) > 4096 then raise check_violation using message='Invalid purchase identifier'; end if;
  if nullif(btrim(p_product_id),'') is null or length(p_product_id) > 255 then raise check_violation using message='Invalid product id'; end if;

  select b.* into v_business
  from public.profiles p join public.businesses b on b.id=p.business_id
  where p.id=auth.uid()
  for update of b;
  select role into v_role from public.profiles where id=auth.uid();
  if v_business.id is null then raise check_violation using message='User has no business'; end if;
  if v_role <> 'owner' then raise insufficient_privilege using message='Only the owner can record a purchase'; end if;
  if v_business.iap_provider is not null and v_business.iap_provider <> p_provider then
    raise check_violation using message='A different store purchase is already linked';
  end if;

  if p_provider='google' and exists(select 1 from public.businesses where iap_purchase_token=p_token and id<>v_business.id) then
    raise unique_violation using message='Google purchase token already belongs to another business';
  end if;
  if p_provider='apple' and exists(select 1 from public.businesses where iap_original_transaction_id=p_token and id<>v_business.id) then
    raise unique_violation using message='Apple transaction already belongs to another business';
  end if;

  if p_provider='google' then
    update public.businesses set iap_provider='google', iap_product_id=p_product_id, iap_purchase_token=p_token where id=v_business.id;
  else
    update public.businesses set iap_provider='apple', iap_product_id=p_product_id, iap_original_transaction_id=p_token where id=v_business.id;
  end if;
  return jsonb_build_object('success',true,'business_id',v_business.id);
end
$$;

revoke all on function public.record_iap_purchase(text,text,text) from public;
grant execute on function public.record_iap_purchase(text,text,text) to authenticated;

create or replace function public.begin_iap_event(
  p_provider text, p_event_id text, p_event_type text, p_product_id text,
  p_token_sha256 text, p_token_ciphertext text, p_token_iv text,
  p_store_status text, p_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_event public.iap_events%rowtype;
begin
  if p_provider not in ('apple','google') or nullif(p_event_id,'') is null then
    raise check_violation using message='Invalid IAP event identity';
  end if;
  select * into v_event from public.iap_events
  where provider=p_provider and event_id=p_event_id for update;
  if v_event.id is not null then
    if v_event.event_type is distinct from p_event_type
       or v_event.product_id is distinct from p_product_id
       or v_event.token_sha256 is distinct from p_token_sha256 then
      raise check_violation using message='IAP event id collision';
    end if;
    update public.iap_events set last_attempt_at=now(), attempt_count=attempt_count+1
    where id=v_event.id;
    return v_event.id;
  end if;

  insert into public.iap_events(provider,event_id,event_type,product_id,token_sha256,token_ciphertext,token_iv,token_delete_after,store_status,expires_at)
  values(p_provider,p_event_id,p_event_type,p_product_id,p_token_sha256,p_token_ciphertext,p_token_iv,
    case when p_token_ciphertext is null then null else now()+interval '90 days' end,p_store_status,p_expires_at)
  returning * into v_event;
  return v_event.id;
end $$;

create or replace function public.finalize_iap_event(
  p_provider text, p_event_id text, p_store_identifier text, p_external_reference text,
  p_status text, p_product_id text, p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_event public.iap_events%rowtype;
  v_candidates uuid[];
  v_business public.businesses%rowtype;
  v_external_business uuid;
  v_resolution text;
begin
  select * into v_event from public.iap_events where provider=p_provider and event_id=p_event_id for update;
  if v_event.id is null then raise check_violation using message='IAP event must be begun before finalization'; end if;
  if v_event.resolution='matched' then
    return jsonb_build_object('resolution','matched','business_id',v_event.business_id);
  end if;

  select business_id into v_external_business from public.profiles
  where id::text=p_external_reference and business_id is not null
  for share;

  select coalesce(array_agg(distinct id),'{}'::uuid[]) into v_candidates from (
    select id from public.businesses where
      (p_provider='google' and iap_purchase_token=p_store_identifier)
      or (p_provider='apple' and iap_original_transaction_id=p_store_identifier)
    union
    select v_external_business where v_external_business is not null
  ) candidate where exists(select 1 from public.businesses b where b.id=candidate.id);

  if cardinality(v_candidates)=0 then v_resolution := 'unmatched';
  elsif cardinality(v_candidates)>1 then v_resolution := 'conflict';
  else
    select * into v_business from public.businesses where id=v_candidates[1] for update;
    if v_business.iap_provider is not null and v_business.iap_provider<>p_provider then
      v_resolution := 'conflict';
    else
      if p_provider='google' then
        update public.businesses set iap_provider='google',iap_product_id=p_product_id,iap_purchase_token=p_store_identifier,
          iap_status=p_status,iap_expires_at=p_expires_at where id=v_business.id;
      else
        update public.businesses set iap_provider='apple',iap_product_id=p_product_id,iap_original_transaction_id=p_store_identifier,
          iap_status=p_status,iap_expires_at=p_expires_at where id=v_business.id;
      end if;
      v_resolution := 'matched';
    end if;
  end if;

  update public.iap_events set resolution=v_resolution,
    business_id=case when v_resolution='matched' then v_candidates[1] else null end,
    business_id_snapshot=case when v_resolution='matched' then v_candidates[1] else business_id_snapshot end,
    external_reference=p_external_reference, store_status=p_status, product_id=p_product_id,
    expires_at=p_expires_at, processed_at=now(),
    error_code=case when v_resolution='conflict' then 'candidate_conflict' when v_resolution='unmatched' then 'no_candidate' else null end
  where id=v_event.id;
  return jsonb_build_object('resolution',v_resolution,'business_id',case when v_resolution='matched' then v_candidates[1] else null end);
end $$;

create or replace function public.purge_expired_iap_secrets()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  update public.iap_events
  set token_ciphertext=null, token_iv=null
  where token_delete_after <= now() and token_ciphertext is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.begin_iap_event(text,text,text,text,text,text,text,text,timestamptz) from public;
revoke all on function public.finalize_iap_event(text,text,text,text,text,text,timestamptz) from public;
revoke all on function public.purge_expired_iap_secrets() from public;
revoke all on function public.begin_iap_event(text,text,text,text,text,text,text,text,timestamptz) from anon, authenticated;
revoke all on function public.finalize_iap_event(text,text,text,text,text,text,timestamptz) from anon, authenticated;
revoke all on function public.purge_expired_iap_secrets() from anon, authenticated;
grant execute on function public.begin_iap_event(text,text,text,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.finalize_iap_event(text,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.purge_expired_iap_secrets() to service_role;

do $$ begin
  perform cron.unschedule('purge-expired-iap-secrets');
exception when others then null;
end $$;
select cron.schedule(
  'purge-expired-iap-secrets',
  '15 3 * * *',
  'select public.purge_expired_iap_secrets()'
);
