-- Reuse the import ledger and existing finance tables. No bank/transfer module,
-- reimbursement mutation, service-role bypass or source-account recreation.
alter table public.import_batches drop constraint if exists import_batches_module_check;
alter table public.import_batches add constraint import_batches_module_check check (module in (
  'credit_card_transactions','accounts_payable','reimbursements','income_sources',
  'people','categories','planned_purchases','goals','system_goals_purchases','organizze'
));
alter table public.import_batches drop constraint if exists import_batches_file_type_check;
alter table public.import_batches add constraint import_batches_file_type_check check (file_type in ('csv','xlsx','json'));
alter table public.accounts_payable drop constraint if exists accounts_payable_source_type_check;
alter table public.accounts_payable add constraint accounts_payable_source_type_check check (source_type in (
  'manual','recurring','installment','reimbursement','invoice_payment','organizze'
));
create unique index if not exists import_rows_organizze_source_key
  on public.import_rows (user_id, (mapped_data->>'source_key'))
  where mapped_data->>'source' = 'organizze';

create or replace function public.organizze_import_ready() returns boolean
language sql stable security invoker set search_path = ''
as $$ select auth.uid() is not null $$;

create or replace function public.confirm_organizze_import(p_rows jsonb, p_period jsonb, p_ownership text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  u uuid := auth.uid();
  batch uuid := gen_random_uuid();
  r jsonb; v jsonb; links jsonb; mapped jsonb := '{}'::jsonb;
  source_key text; target text; existing uuid; destination uuid; origin_id uuid;
  stored public.import_rows%rowtype;
  parent_id uuid; category_id uuid; card_id uuid; invoice_id uuid;
  own boolean; n integer := 0; created integer := 0; reused integer := 0; retained integer := 0;
begin
  if u is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200000 or jsonb_array_length(p_rows) = 0 then
    raise exception 'Lote Organizze inválido.';
  end if;
  if p_ownership is null or p_ownership not in ('personal','third_party','shared','family') then
    raise exception 'Escolha explicitamente a titularidade das novas compras.';
  end if;
  if (p_period->>'start')::date > (p_period->>'end')::date then raise exception 'Período inválido.'; end if;
  -- Serialize imports per user. The unique source-key index also prevents
  -- accidental duplicate origins across batches and concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended('organizze:' || u::text, 0));
  insert into public.import_batches (id,user_id,module,target_type,file_name,file_type,status,total_rows,mapping_config)
  values (batch,u,'organizze','organizze','organizze-backup.json','json','parsed',jsonb_array_length(p_rows),jsonb_build_object('source','organizze','period',p_period,'ownership',p_ownership));
  for r in select value from jsonb_array_elements(p_rows) loop
    n := n + 1; source_key := r->>'sourceKey'; target := r->>'target'; v := coalesce(r->'values','{}');
    if source_key is null or source_key !~ '^(account|card|category|transaction):[1-9][0-9]*$|^invoice:[1-9][0-9]*:[1-9][0-9]*$' or r->'source'->>'key' is distinct from source_key then
      raise exception 'Identificador de origem inválido.';
    end if;
    if target is null or target not in ('source_only','categories','credit_cards','credit_card_invoices','credit_card_transactions','accounts_payable','income_sources') then
      raise exception 'Destino de importação inválido.';
    end if;
    select * into stored from public.import_rows ir where ir.user_id=u and ir.mapped_data->>'source'='organizze' and ir.mapped_data->>'source_key'=source_key;
    if found then
      own := case stored.target_entity_type
        when 'source_only' then stored.target_entity_id=stored.id
        when 'categories' then exists(select 1 from public.categories where id=stored.target_entity_id and user_id=u)
        when 'credit_cards' then exists(select 1 from public.credit_cards where id=stored.target_entity_id and user_id=u)
        when 'credit_card_invoices' then exists(select 1 from public.credit_card_invoices where id=stored.target_entity_id and user_id=u)
        when 'credit_card_transactions' then exists(select 1 from public.credit_card_transactions where id=stored.target_entity_id and user_id=u)
        when 'accounts_payable' then exists(select 1 from public.accounts_payable where id=stored.target_entity_id and user_id=u)
        when 'income_sources' then exists(select 1 from public.income_sources where id=stored.target_entity_id and user_id=u)
        else false end;
      if not coalesce(own,false) then raise exception 'Origem com destino removido ou de outro usuário; revisar vínculo.' using errcode='42501'; end if;
      mapped := mapped || jsonb_build_object(source_key,jsonb_build_object('id',stored.target_entity_id,'target',stored.target_entity_type));
      reused := reused + 1;
      continue;
    end if;
    origin_id := gen_random_uuid(); destination := gen_random_uuid(); existing := nullif(r->>'existingId','')::uuid;
    parent_id := null; category_id := null; card_id := null; invoice_id := null;
    links := coalesce(r->'links','{}');
    if target <> 'source_only' then
      if links ? 'parent' then
        if mapped->(links->>'parent')->>'target' is distinct from 'categories' then raise exception 'Categoria pai indisponível.'; end if;
        parent_id := (mapped->(links->>'parent')->>'id')::uuid;
      end if;
      if links ? 'category' then
        if mapped->(links->>'category')->>'target' is distinct from 'categories' then raise exception 'Categoria indisponível.'; end if;
        category_id := (mapped->(links->>'category')->>'id')::uuid;
      end if;
      if links ? 'card' then
        if mapped->(links->>'card')->>'target' is distinct from 'credit_cards' then raise exception 'Cartão indisponível.'; end if;
        card_id := (mapped->(links->>'card')->>'id')::uuid;
      end if;
      if links ? 'invoice' then
        if mapped->(links->>'invoice')->>'target' is distinct from 'credit_card_invoices' then raise exception 'Fatura indisponível.'; end if;
        invoice_id := (mapped->(links->>'invoice')->>'id')::uuid;
      end if;
      if parent_id is not null and not exists(select 1 from public.categories where id=parent_id and user_id=u) then raise exception 'Categoria pai de outro usuário.' using errcode='42501'; end if;
      if category_id is not null and not exists(select 1 from public.categories where id=category_id and user_id=u) then raise exception 'Categoria de outro usuário.' using errcode='42501'; end if;
      if card_id is not null and not exists(select 1 from public.credit_cards where id=card_id and user_id=u) then raise exception 'Cartão de outro usuário.' using errcode='42501'; end if;
      if invoice_id is not null and not exists(select 1 from public.credit_card_invoices where id=invoice_id and user_id=u) then raise exception 'Fatura de outro usuário.' using errcode='42501'; end if;
    end if;
    if existing is not null then
      own := case target
        when 'categories' then exists(select 1 from public.categories where id=existing and user_id=u)
        when 'credit_cards' then exists(select 1 from public.credit_cards where id=existing and user_id=u)
        when 'credit_card_invoices' then exists(select 1 from public.credit_card_invoices where id=existing and user_id=u and credit_card_id=card_id and due_date=(v->>'due_date')::date and total_amount=(v->>'total_amount')::numeric)
        when 'credit_card_transactions' then exists(select 1 from public.credit_card_transactions where id=existing and user_id=u and credit_card_id=card_id and transaction_date=(v->>'transaction_date')::date and amount=(v->>'amount')::numeric)
        when 'accounts_payable' then exists(select 1 from public.accounts_payable where id=existing and user_id=u and due_date=(v->>'due_date')::date and amount=(v->>'amount')::numeric)
        when 'income_sources' then exists(select 1 from public.income_sources where id=existing and user_id=u and expected_date=(v->>'expected_date')::date and amount=(v->>'amount')::numeric)
        else false end;
      if not own then raise exception 'Vínculo mudou ou não pertence ao usuário.' using errcode='42501'; end if;
      destination := existing; reused := reused + 1;
    elsif target='source_only' then
      destination := origin_id; retained := retained + 1;
    elsif target='categories' then
      insert into public.categories (id,user_id,name,type,parent_category_id,color,is_active)
      values(destination,u,v->>'name',(v->>'type')::public.category_type,parent_id,v->>'color',coalesce((v->>'is_active')::boolean,true));
      created := created + 1;
    elsif target='credit_cards' then
      insert into public.credit_cards (id,user_id,name,issuer,closing_day,due_day,limit_amount,is_active,notes)
      values(destination,u,v->>'name',v->>'issuer',(v->>'closing_day')::integer,(v->>'due_day')::integer,(v->>'limit_amount')::numeric,coalesce((v->>'is_active')::boolean,true),v->>'notes');
      created := created + 1;
    elsif target='credit_card_invoices' then
      if card_id is null then raise exception 'Fatura sem cartão.'; end if;
      insert into public.credit_card_invoices (id,user_id,credit_card_id,reference_month,due_date,closing_date,total_amount,paid_amount,status,personal_amount,notes)
      values(destination,u,card_id,(v->>'reference_month')::date,(v->>'due_date')::date,(v->>'closing_date')::date,(v->>'total_amount')::numeric,(v->>'paid_amount')::numeric,(v->>'status')::public.invoice_status,case when p_ownership='personal' then (v->>'total_amount')::numeric else 0 end,v->>'notes');
      created := created + 1;
    elsif target='credit_card_transactions' then
      if card_id is null then raise exception 'Lançamento sem cartão.'; end if;
      if invoice_id is not null and not exists(select 1 from public.credit_card_invoices where id=invoice_id and user_id=u and credit_card_id=card_id) then raise exception 'Fatura de outro cartão.'; end if;
      insert into public.credit_card_transactions (id,user_id,credit_card_id,invoice_id,category_id,description,amount,transaction_date,ownership_type,is_reimbursable,reimbursement_status,installment_number,installment_total,notes)
      values(destination,u,card_id,invoice_id,category_id,v->>'description',(v->>'amount')::numeric,(v->>'transaction_date')::date,p_ownership::public.ownership_type,false,'not_applicable',(v->>'installment_number')::integer,(v->>'installment_total')::integer,v->>'notes');
      created := created + 1;
    elsif target='accounts_payable' then
      insert into public.accounts_payable (id,user_id,category_id,title,amount,due_date,status,source_type,source_id,paid_at,notes)
      values(destination,u,category_id,v->>'title',(v->>'amount')::numeric,(v->>'due_date')::date,(v->>'status')::public.record_status,'organizze',origin_id,case when v->>'status'='paid' then ((v->>'due_date') || 'T12:00:00Z')::timestamptz else null end,v->>'notes');
      created := created + 1;
    elsif target='income_sources' then
      insert into public.income_sources (id,user_id,category_id,name,amount,expected_date,status,source_type,received_date,received_at,notes)
      values(destination,u,category_id,v->>'name',(v->>'amount')::numeric,(v->>'expected_date')::date,(v->>'status')::public.expected_status,'organizze',(v->>'received_date')::date,(v->>'received_at')::timestamptz,v->>'notes');
      created := created + 1;
    end if;
    insert into public.import_rows (id,user_id,import_batch_id,row_number,raw_data,parsed_data,mapped_data,status,target_entity_type,target_entity_id)
    values(origin_id,u,batch,n,r->'source',v,jsonb_build_object('source','organizze','source_key',source_key,'tags',coalesce(r->'tags','[]'),'source_links',links,'resolved_links',(select coalesce(jsonb_object_agg(e.key,mapped->e.value),'{}'::jsonb) from jsonb_each_text(links) e),'reason',r->'reason','recurrence',r->'source'->'raw'->'recurrence_id'),case when target='source_only' or existing is not null then 'skipped'::public.import_row_status else 'imported'::public.import_row_status end,target,destination);
    mapped := mapped || jsonb_build_object(source_key,jsonb_build_object('id',destination,'target',target));
  end loop;
  update public.import_batches set status='imported',valid_rows=created,confirmed_at=now(),imported_at=now(),notes=format('Organizze: %s criados, %s vinculados/repetidos, %s preservados na origem.',created,reused,retained) where id=batch and user_id=u;
  return jsonb_build_object('batchId',batch,'created',created,'reused',reused,'sourceOnly',retained,'total',n);
end;
$$;
revoke all on function public.confirm_organizze_import(jsonb,jsonb,text) from public, anon;
revoke all on function public.organizze_import_ready() from public, anon;
grant execute on function public.confirm_organizze_import(jsonb,jsonb,text) to authenticated;
grant execute on function public.organizze_import_ready() to authenticated;
