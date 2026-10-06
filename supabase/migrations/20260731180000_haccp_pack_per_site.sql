-- HACCP packs become per-site: every site keeps its own answers.
-- Existing business-level rows seed each site's pack so nothing is lost.
alter table public.haccp_pack_data
  drop constraint if exists haccp_pack_data_business_id_key;

alter table public.haccp_pack_data
  add constraint uq_haccp_pack_business_site unique (business_id, site_id);

insert into public.haccp_pack_data (business_id, site_id, data, updated_at)
select b.business_id, s.id, b.data, b.updated_at
from public.haccp_pack_data b
join public.sites s on s.business_id = b.business_id
where b.site_id is null
  and not exists (
    select 1 from public.haccp_pack_data x
    where x.business_id = b.business_id and x.site_id = s.id
  );

-- Business-level originals are superseded wherever the business has sites.
delete from public.haccp_pack_data b
where b.site_id is null
  and exists (select 1 from public.sites s where s.business_id = b.business_id);
