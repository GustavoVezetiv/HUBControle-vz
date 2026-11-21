begin;

-- Merchant associations use the same owner-isolated metadata store as rules.
-- Canonical transactions, the inbox ledger and source snapshots are untouched.
create or replace function public.save_pluggy_merchant(p_change jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  u uuid := auth.uid();
  association_id uuid := nullif(p_change->>'id','')::uuid;
  source_key text := nullif(p_change->>'sourceKey','');
  expected timestamptz := nullif(p_change->>'expectedUpdatedAt','')::timestamptz;
  display_name text := btrim(p_change->>'name');
  cat uuid := nullif(p_change->>'categoryId','')::uuid;
  metadata jsonb;
  evidence jsonb;
  stored public.import_batches%rowtype;
  source_metadata jsonb;
  active_category boolean;
  candidate_ids uuid[];
begin
  if u is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  if coalesce(length(display_name),0) not between 2 and 140 or cat is null
    or jsonb_typeof(p_change->'active') is distinct from 'boolean'
    or coalesce(p_change->>'channel','') not in ('web','mcp')
  then raise exception 'Associação inválida.' using errcode='22023'; end if;
  active_category := exists(select 1 from public.categories where user_id=u and id=cat and type='expense' and is_active);
  perform pg_advisory_xact_lock(hashtextextended('pluggy:'||u::text,0));
  if association_id is null then
    if not active_category then raise exception 'Categoria de despesa indisponível.' using errcode='42501'; end if;
    select r.mapped_data into source_metadata from public.import_rows r where r.user_id=u
      and r.mapped_data->>'source'='pluggy' and r.mapped_data->>'source_key'=source_key and r.updated_at=expected;
    if not found then raise exception 'A movimentação de origem mudou.' using errcode='40001'; end if;
    evidence := p_change->'evidence';
    if jsonb_typeof(evidence) is distinct from 'object'
      or coalesce(length(evidence->>'original'),0) not between 1 and 300
      or (evidence->>'pattern' is not null and (length(evidence->>'pattern') not between 3 and 300 or evidence->>'pattern' !~ '^[a-z0-9 ]+$'))
      or (evidence->>'cnpj' is not null and evidence->>'cnpj' !~ '^[A-Z0-9]{12}[0-9]{2}$')
      or (evidence->>'merchantKey' is not null and evidence->>'merchantKey' !~ '^(nubank|xp|sicredi|caixa|mercado_pago):[A-Za-z0-9_.-]{3,100}$')
      or (evidence->>'mcc' is not null and evidence->>'mcc' !~ '^[0-9]{4}$')
      or coalesce(evidence->>'pattern',evidence->>'cnpj',evidence->>'merchantKey') is null
    then raise exception 'Evidência comercial insuficiente.' using errcode='22023'; end if;
    if (evidence->>'cnpj' is not null and (evidence->>'cnpj') is distinct from regexp_replace(source_metadata#>>'{latest_raw,merchant,cnpj}','[. /-]','','g'))
      or (evidence->>'merchantKey' is not null and evidence->>'merchantKey' is distinct from
        ((source_metadata->>'institution')||':'||coalesce(source_metadata#>>'{latest_raw,merchant,id}',
          source_metadata#>>'{latest_raw,merchantId}',source_metadata#>>'{latest_raw,creditCardMetadata,merchantId}')))
      or (evidence->>'mcc' is not null
        and evidence->>'mcc' is distinct from source_metadata#>>'{latest_raw,creditCardMetadata,payeeMCC}'
        and evidence->>'mcc' is distinct from source_metadata#>>'{latest_raw,merchant,mcc}')
    then raise exception 'Identificador diverge da origem.' using errcode='40001'; end if;
    select array_agg(b.id) into candidate_ids from public.import_batches b where b.user_id=u
      and b.mapping_config->>'source'='pluggy' and b.mapping_config->>'kind'='merchant_association'
      and (b.mapping_config->>'pattern'=evidence->>'pattern' or b.mapping_config->>'cnpj'=evidence->>'cnpj'
        or b.mapping_config->>'merchantKey'=evidence->>'merchantKey');
    if coalesce(cardinality(candidate_ids),0) > 0 then
      if cardinality(candidate_ids)=1 and exists(select 1 from public.import_batches b where b.id=candidate_ids[1]
        and b.user_id=u and b.mapping_config->>'name'=display_name and b.mapping_config->>'categoryId'=cat::text
        and b.mapping_config->'active'=p_change->'active'
        and (b.mapping_config->>'cnpj' is null or evidence->>'cnpj' is null or b.mapping_config->>'cnpj'=evidence->>'cnpj')
        and (b.mapping_config->>'merchantKey' is null or evidence->>'merchantKey' is null
          or split_part(b.mapping_config->>'merchantKey',':',1)<>split_part(evidence->>'merchantKey',':',1)
          or b.mapping_config->>'merchantKey'=evidence->>'merchantKey'))
      then return candidate_ids[1]; end if;
      raise exception 'Associação existente ou conflitante. Edite a associação cadastrada.' using errcode='23505';
    end if;
    association_id := gen_random_uuid();
    metadata := jsonb_build_object('source','pluggy','kind','merchant_association','sourceKey',source_key,
      'original',evidence->>'original','pattern',evidence->>'pattern','cnpj',evidence->>'cnpj',
      'merchantKey',evidence->>'merchantKey','mcc',evidence->>'mcc');
  else
    select * into stored from public.import_batches b where b.id=association_id and b.user_id=u
      and b.mapping_config->>'source'='pluggy' and b.mapping_config->>'kind'='merchant_association' for update;
    if not found then raise exception 'Associação indisponível.' using errcode='42501'; end if;
    if not active_category and ((p_change->>'active')::boolean or stored.mapping_config->>'categoryId' is distinct from cat::text)
    then raise exception 'Categoria de despesa indisponível.' using errcode='42501'; end if;
    if stored.mapping_config->>'name'=display_name and stored.mapping_config->>'categoryId'=cat::text
      and stored.mapping_config->'active'=p_change->'active' then return association_id; end if;
    if stored.updated_at is distinct from expected then raise exception 'Associação alterada.' using errcode='40001'; end if;
    metadata := stored.mapping_config;
  end if;
  metadata := metadata || jsonb_build_object('name',display_name,'categoryId',cat,'active',p_change->'active','channel',p_change->>'channel');
  if stored.id is null then
    insert into public.import_batches(id,user_id,module,target_type,file_name,file_type,status,mapping_config)
    values(association_id,u,'categories','pluggy_merchants','Meu Pluggy - associação comercial','json','parsed',metadata);
  else
    update public.import_batches set mapping_config=metadata where id=association_id and user_id=u;
  end if;
  insert into public.audit_logs(user_id,module,record_id,action,old_value,new_value)
  values(u,'imports',association_id,'confirm_merchant_association',stored.mapping_config,metadata);
  return association_id;
end $$;

revoke all on function public.save_pluggy_merchant(jsonb) from public,anon;
grant execute on function public.save_pluggy_merchant(jsonb) to authenticated;
commit;
