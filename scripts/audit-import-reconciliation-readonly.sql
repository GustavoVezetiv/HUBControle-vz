-- Run on the intended project with a read-only audit connection. Returns
-- counts and catalog metadata only. No transaction identifiers or values.
with expected(signature) as (
  values ('public.organizze_reconciliation_ready()'),
         ('public.confirm_organizze_reconciliation(jsonb,jsonb)'),
         ('public.pluggy_inbox_ready()'),
         ('public.stage_pluggy_rows(jsonb)'),
         ('public.review_pluggy_row(text,jsonb,timestamptz)'),
         ('public.save_pluggy_rule(jsonb)'),
         ('public.confirm_organizze_import(jsonb,jsonb,text)'),
         ('public.mcp_execute_direct_write_v2(uuid,text,text,jsonb)'),
         ('public.mcp_recalculate_invoice_totals_v1(uuid,uuid,boolean)'),
         ('public.mcp_confirm_import_reviews(uuid,uuid,text)')
), routines as (
  select expected.signature, p.oid is not null as present,
         pg_get_function_result(p.oid) as returns,
         p.prosecdef as security_definer,
         has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
         has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
         has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
         md5(regexp_replace(p.prosrc,'[[:space:]]+','','g')) as normalized_body_hash
  from expected left join pg_proc p on p.oid=to_regprocedure(expected.signature)
), relation_access as (
  select tbl.name, c.oid is not null as present, c.relrowsecurity as rls,
         has_table_privilege('anon',c.oid,'SELECT') as anon_select,
         has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
         has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert,
         has_table_privilege('authenticated',c.oid,'UPDATE') as authenticated_update,
         has_table_privilege('service_role',c.oid,'SELECT') as service_select,
         has_table_privilege('service_role',c.oid,'INSERT') as service_insert,
         has_table_privilege('service_role',c.oid,'UPDATE') as service_update
  from (values ('import_rows'),('import_batches'),('mcp_oauth_records'),
               ('mcp_action_requests'),('mcp_write_operations'),('audit_logs')) tbl(name)
  left join pg_class c on c.oid=to_regclass('public.'||tbl.name)
), entries as (
  select r.id,r.user_id,r.import_batch_id,r.target_entity_type,r.target_entity_id,
         r.mapped_data->>'source' as source, r.mapped_data->>'source_key' as source_key,
         r.mapped_data->>'state' as state
  from public.import_rows r
  where r.mapped_data->>'source' in ('organizze','pluggy')
), checked as (
  select e.*,
         not exists(select 1 from auth.users u where u.id=e.user_id) as owner_missing,
         not exists(select 1 from public.import_batches b
                    where b.id=e.import_batch_id and b.user_id=e.user_id) as batch_missing,
         case
           when e.target_entity_type='source_only' then
             (e.target_entity_id is not null and e.target_entity_id<>e.id)
             or e.state in ('reconciled','imported')
           when e.target_entity_type='accounts_payable' then
             not exists(select 1 from public.accounts_payable x where x.id=e.target_entity_id and x.user_id=e.user_id)
           when e.target_entity_type='income_sources' then
             not exists(select 1 from public.income_sources x where x.id=e.target_entity_id and x.user_id=e.user_id)
           when e.target_entity_type='credit_card_transactions' then
             not exists(select 1 from public.credit_card_transactions x where x.id=e.target_entity_id and x.user_id=e.user_id)
           when e.target_entity_type='credit_card_invoices' then
             not exists(select 1 from public.credit_card_invoices x where x.id=e.target_entity_id and x.user_id=e.user_id)
           when e.target_entity_type='credit_cards' then
             not exists(select 1 from public.credit_cards x where x.id=e.target_entity_id and x.user_id=e.user_id)
           when e.target_entity_type='categories' then
             not exists(select 1 from public.categories x where x.id=e.target_entity_id and x.user_id=e.user_id)
           else true
         end as target_missing
  from entries e
), entry_totals as (
  select source,count(checked.id) as rows,
         count(checked.id) filter (where target_entity_type is distinct from 'source_only' and target_entity_id is not null) as canonical_links,
         count(checked.id) filter (where owner_missing) as missing_owner,
         count(checked.id) filter (where batch_missing) as missing_or_cross_owner_batch,
         count(checked.id) filter (where target_missing) as missing_or_cross_owner_target,
         count(checked.id) filter (where nullif(btrim(source_key),'') is null) as missing_source_key
  from (values ('organizze'),('pluggy')) expected_sources(source)
  left join checked using (source) group by source
), duplicate_keys as (
  select source,count(*) as duplicate_keys,sum(n-1) as extra_rows
  from (select source,user_id,source_key,count(*) as n from entries
        where nullif(btrim(source_key),'') is not null
        group by source,user_id,source_key having count(*)>1) repeated
  group by source
), objects_by_source as (
  select split_part(o.name,'/',2) as source,count(*) as objects
  from storage.objects o where o.bucket_id='hub-import-backups'
  group by split_part(o.name,'/',2)
)
select current_database() as db,
       (select jsonb_agg(to_jsonb(r) order by signature) from routines r) as rpcs,
       (select jsonb_agg(to_jsonb(a) order by name) from relation_access a) as grants_and_rls,
       (select jsonb_agg(to_jsonb(e) order by source) from entry_totals e) as reconciliation_rows,
       coalesce((select jsonb_agg(to_jsonb(d) order by source) from duplicate_keys d),'[]'::jsonb) as duplicates,
       (select not b.public from storage.buckets b where id='hub-import-backups') as private_backup_bucket,
       (select jsonb_agg(to_jsonb(s) order by source) from objects_by_source s) as stored_objects_by_source;
