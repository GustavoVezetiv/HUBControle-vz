-- Prepared only. Reuses import_batches/import_rows; no financial table writes,
-- new tables, service-role bypass, reimbursement creation or RLS changes.
create unique index if not exists import_rows_pluggy_source_key
  on public.import_rows(user_id,(mapped_data->>'source_key'))
  where mapped_data->>'source'='pluggy';
create unique index if not exists import_batches_pluggy_rule_pattern
  on public.import_batches(user_id,(mapping_config->>'pattern'))
  where mapping_config->>'source'='pluggy' and mapping_config->>'kind'='classification_rule';

create or replace function public.pluggy_inbox_ready() returns boolean
language sql stable security invoker set search_path='' as $$ select auth.uid() is not null $$;

create or replace function public.stage_pluggy_rows(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); b uuid; r jsonb; stored public.import_rows%rowtype;
  k text; cat uuid; own text; n integer:=0; created integer:=0; changed integer:=0; meta jsonb;
begin
  if u is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Lote inválido.'; end if;
  if jsonb_array_length(p_rows)>200000 then raise exception 'Lote excedido.'; end if;
  if jsonb_array_length(p_rows)=0 then return '{"created":0,"changed":0}'::jsonb; end if;
  perform pg_advisory_xact_lock(hashtextextended('pluggy:'||u::text,0));
  select id into b from public.import_batches where user_id=u and mapping_config->>'source'='pluggy' and mapping_config->>'kind'='inbox' order by created_at limit 1;
  if b is null then
    b:=gen_random_uuid();
    insert into public.import_batches(id,user_id,module,target_type,file_name,file_type,status,mapping_config)
    values(b,u,'accounts_payable','pluggy_inbox','Meu Pluggy - caixa de entrada','json','parsed','{"source":"pluggy","kind":"inbox"}');
  end if;
  select coalesce(max(row_number),0) into n from public.import_rows where import_batch_id=b and user_id=u;
  for r in select value from jsonb_array_elements(p_rows) loop
    k:=r->>'sourceKey'; cat:=nullif(r->>'categoryId','')::uuid; own:=nullif(r->>'ownership','');
    if r->>'institution' is null or r->>'institution' not in ('nubank','xp','sicredi','caixa','mercado_pago')
      or r->>'accountType' is null or r->>'accountType' not in ('BANK','CREDIT')
      or jsonb_typeof(r->'raw') is distinct from 'object'
      or coalesce(r->>'itemId','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
      or coalesce(r->>'accountId','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
      or coalesce(r->'raw'->>'id','') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
      or r->'raw'->>'accountId' is distinct from r->>'accountId'
      or k is distinct from 'pluggy:'||(r->>'itemId')||':'||(r->>'accountId')||':'||(r->'raw'->>'id')
    then raise exception 'Origem Pluggy inválida.'; end if;
    if cat is not null and not exists(select 1 from public.categories where id=cat and user_id=u) then raise exception 'Categoria de outro usuário.' using errcode='42501'; end if;
    if own is not null and own not in ('personal','third_party','family','shared') then raise exception 'Titularidade inválida.'; end if;
    meta:=jsonb_build_object('source','pluggy','source_key',k,'institution',r->>'institution','item_id',r->>'itemId','account_id',r->>'accountId','account_type',r->>'accountType','latest_raw',r->'raw','fetched_at',r->>'fetchedAt');
    select * into stored from public.import_rows where user_id=u and mapped_data->>'source'='pluggy' and mapped_data->>'source_key'=k for update;
    if found then
      if stored.mapped_data->>'institution' is distinct from r->>'institution' then raise exception 'Origem já pertence a outra instituição.'; end if;
      if stored.mapped_data->'latest_raw' is distinct from r->'raw' or
        (not coalesce((stored.mapped_data->>'reviewed')::boolean,false) and (stored.mapped_data->>'category_id' is distinct from cat::text or stored.mapped_data->>'ownership' is distinct from own)) then
        update public.import_rows set mapped_data=stored.mapped_data||meta||case when coalesce((stored.mapped_data->>'reviewed')::boolean,false) then '{}'::jsonb else jsonb_build_object('category_id',cat,'ownership',own,'rule_ids',r->'ruleIds') end where id=stored.id and user_id=u;
        changed:=changed+1;
      end if;
    else
      n:=n+1;
      insert into public.import_rows(user_id,import_batch_id,row_number,raw_data,mapped_data,status,target_entity_type)
      values(u,b,n,jsonb_build_object('source','pluggy','itemId',r->>'itemId','accountId',r->>'accountId','raw',r->'raw'),meta||jsonb_build_object('state',case when r->>'pending'='true' then 'pending' else 'new' end,'category_id',cat,'ownership',own,'reviewed',false,'rule_ids',r->'ruleIds'),'pending','source_only');
      created:=created+1;
    end if;
  end loop;
  update public.import_batches set total_rows=n,valid_rows=n where id=b and user_id=u;
  return jsonb_build_object('created',created,'changed',changed);
end $$;

create or replace function public.review_pluggy_row(p_source_key text,p_review jsonb,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); s public.import_rows%rowtype; v jsonb; state text; target text; destination uuid; cat uuid; own text; source_amount numeric; day date; matched boolean:=false;
begin
  if u is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pluggy:'||u::text,0));
  select * into s from public.import_rows where user_id=u and mapped_data->>'source'='pluggy' and mapped_data->>'source_key'=p_source_key for update;
  if not found then raise exception 'Movimentação indisponível.'; end if;
  if s.updated_at is distinct from p_expected_updated_at then raise exception 'Prévia desatualizada; recarregue.' using errcode='40001'; end if;
  state:=p_review->>'state'; target:=nullif(p_review->>'target',''); destination:=nullif(p_review->>'targetId','')::uuid; cat:=nullif(p_review->>'categoryId','')::uuid; own:=nullif(p_review->>'ownership','');
  if state is null or state not in ('new','pending','historical','reconciled','own_transfer','invoice_payment') then raise exception 'Situação inválida.'; end if;
  if own is not null and own not in ('personal','third_party','family','shared') then raise exception 'Titularidade inválida.'; end if;
  if cat is not null and not exists(select 1 from public.categories where id=cat and user_id=u) then raise exception 'Categoria de outro usuário.' using errcode='42501'; end if;
  if s.target_entity_id is not null and (destination is distinct from s.target_entity_id or target is distinct from s.target_entity_type) then raise exception 'Vínculo canônico existente deve ser preservado.'; end if;
  if state='reconciled' then
    v:=s.mapped_data->'latest_raw';
    if v->>'status' is distinct from 'POSTED' or v->>'currencyCode' is distinct from 'BRL' or v->>'type' not in ('DEBIT','CREDIT') or v->>'type' is null
      or v->>'operationType' in ('PAGAMENTO_FATURA','ESTORNO','CASHBACK') or (s.mapped_data->>'account_type'='CREDIT' and v->>'type'='CREDIT')
    then raise exception 'Pagamento, estorno ou pendência permanece como referência.'; end if;
    source_amount:=abs((v->>'amount')::numeric); day:=left(v->>'date',10)::date;
    if source_amount is null or source_amount=0 or day is null then raise exception 'Valor/data de origem inválidos.'; end if;
    if target='accounts_payable' and v->>'type'='DEBIT' then
      select exists(select 1 from public.accounts_payable where user_id=u and id=destination and amount=source_amount and abs(due_date-day)<=7) into matched;
    elsif target='credit_card_transactions' and v->>'type'='DEBIT' then
      select exists(select 1 from public.credit_card_transactions where user_id=u and id=destination and amount=source_amount and abs(transaction_date-day)<=7) into matched;
    elsif target='income_sources' and v->>'type'='CREDIT' and s.mapped_data->>'account_type'='BANK' then
      select exists(select 1 from public.income_sources where user_id=u and id=destination and amount=source_amount and (abs(expected_date-day)<=7 or abs(received_date-day)<=7)) into matched;
    end if;
    if not matched then raise exception 'Correspondência mudou ou não pertence ao usuário.' using errcode='42501'; end if;
  elsif destination is not null or target is not null then raise exception 'Destino exige conciliação explícita.';
  end if;
  update public.import_rows set mapped_data=s.mapped_data||jsonb_build_object('state',state,'category_id',cat,'ownership',own,'reviewed',true)||case when state='reconciled' then jsonb_build_object('linked_raw',coalesce(s.mapped_data->'linked_raw',v)) else '{}'::jsonb end,target_entity_type=coalesce(target,'source_only'),target_entity_id=destination,status=case when state in ('historical','reconciled','own_transfer','invoice_payment') then 'skipped'::public.import_row_status else 'pending'::public.import_row_status end where id=s.id and user_id=u;
  return jsonb_build_object('state',state,'targetId',destination,'financialWrites',0);
end $$;

create or replace function public.save_pluggy_rule(p_rule jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); rule_id uuid:=nullif(p_rule->>'id','')::uuid; pattern text:=lower(btrim(p_rule->>'pattern')); cat uuid:=nullif(p_rule->>'categoryId','')::uuid; own text:=nullif(p_rule->>'ownership',''); meta jsonb;
begin
  if u is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  if pattern is null or length(pattern)<3 or length(pattern)>120 or cat is null then raise exception 'Regra inválida.'; end if;
  if not exists(select 1 from public.categories where user_id=u and id=cat and type::text in ('expense','income')) then raise exception 'Categoria inválida ou de outro usuário.' using errcode='42501'; end if;
  if own is not null and own not in ('personal','third_party','family','shared') then raise exception 'Titularidade inválida.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pluggy:'||u::text,0));
  meta:=jsonb_build_object('source','pluggy','kind','classification_rule','pattern',pattern,'categoryId',cat,'ownership',own,'active',coalesce((p_rule->>'active')::boolean,true));
  if rule_id is not null then
    update public.import_batches set mapping_config=meta where id=rule_id and user_id=u and mapping_config->>'source'='pluggy' and mapping_config->>'kind'='classification_rule';
    if not found then raise exception 'Regra indisponível.' using errcode='42501'; end if;
  else
    rule_id:=gen_random_uuid();
    insert into public.import_batches(id,user_id,module,target_type,file_name,file_type,status,mapping_config)
    values(rule_id,u,'categories','pluggy_rules','Meu Pluggy - regra confirmada','json','parsed',meta);
  end if;
  return rule_id;
end $$;
revoke all on function public.pluggy_inbox_ready() from public,anon;
revoke all on function public.stage_pluggy_rows(jsonb) from public,anon;
revoke all on function public.review_pluggy_row(text,jsonb,timestamptz) from public,anon;
revoke all on function public.save_pluggy_rule(jsonb) from public,anon;
grant execute on function public.pluggy_inbox_ready(),public.stage_pluggy_rows(jsonb),public.review_pluggy_row(text,jsonb,timestamptz),public.save_pluggy_rule(jsonb) to authenticated;
