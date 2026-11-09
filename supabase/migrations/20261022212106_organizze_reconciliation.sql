-- Explicit per-record review. Reuses the existing import ledger, no new tables.
-- Prepared only; do not apply to production without authorization.
create or replace function public.organizze_reconciliation_ready() returns boolean
language sql stable security invoker set search_path = ''
as $$ select auth.uid() is not null $$;

create or replace function public.confirm_organizze_reconciliation(p_rows jsonb, p_period jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  u uuid := auth.uid();
  batch uuid := gen_random_uuid();
  r jsonb; v jsonb; links jsonb; mapped jsonb := '{}'::jsonb;
  source_key text; target text; existing uuid; destination uuid; origin_id uuid;
  stored public.import_rows%rowtype;
  parent_id uuid; category_id uuid; card_id uuid; invoice_id uuid;
  ownership text; review_person_id uuid; action text; promoting boolean; metadata jsonb;
  own boolean; n integer := 0; created integer := 0; reused integer := 0; retained integer := 0;
begin
  if u is null then raise exception 'Autenticação obrigatória.' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Lote Organizze inválido.'; end if;
  if jsonb_array_length(p_rows) > 200000 or jsonb_array_length(p_rows) = 0 then
    raise exception 'Lote Organizze inválido.';
  end if;
  if jsonb_typeof(p_period) is distinct from 'object'
    or coalesce(p_period->>'start','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_period->>'end','') !~ '^\d{4}-\d{2}-\d{2}$'
  then raise exception 'Período inválido.'; end if;
  if (p_period->>'start')::date > (p_period->>'end')::date then raise exception 'Período inválido.'; end if;
  -- Serialize imports per user. The unique source-key index also prevents
  -- accidental duplicate origins across batches and concurrent requests.
  perform pg_advisory_xact_lock(hashtextextended('organizze:' || u::text, 0));
  insert into public.import_batches (id,user_id,module,target_type,file_name,file_type,status,total_rows,mapping_config)
  values (batch,u,'organizze','organizze','organizze-backup.json','json','parsed',jsonb_array_length(p_rows),jsonb_build_object('source','organizze','period',p_period,'mode','reviewed_reconciliation'));
  for r in select value from jsonb_array_elements(p_rows) loop
    n := n + 1; source_key := r->>'sourceKey'; target := r->>'target'; v := coalesce(r->'values','{}');
    if source_key is null or source_key !~ '^(account|card|category|transaction):[1-9][0-9]*$|^invoice:[1-9][0-9]*:[1-9][0-9]*$' or r->'source'->>'key' is distinct from source_key then
      raise exception 'Identificador de origem inválido.';
    end if;
    if target is null or target not in ('source_only','categories','credit_cards','credit_card_invoices','credit_card_transactions','accounts_payable','income_sources') then
      raise exception 'Destino de importação inválido.';
    end if;
    action := r->'review'->>'action'; ownership := r->'review'->>'ownership'; review_person_id := nullif(r->'review'->>'personId','')::uuid;
    if action is null or action not in ('pending','historical','new','link','dependency','already_imported') then raise exception 'Revisão explícita obrigatória.'; end if;
    promoting := false;
    select * into stored from public.import_rows ir where ir.user_id=u and ir.mapped_data->>'source'='organizze' and ir.mapped_data->>'source_key'=source_key;
    if found and stored.target_entity_type='source_only' and target<>'source_only' then
      promoting := true;
    elsif found then
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
      if stored.target_entity_type='source_only' and target='source_only' and stored.mapped_data->'review'->>'action' is distinct from action then
        update public.import_rows set mapped_data=stored.mapped_data || jsonb_build_object('review',r->'review','previous_review',stored.mapped_data->'review','reason',r->'reason','state',case when action='pending' then 'pending' else 'historical' end) where id=stored.id and user_id=u;
      end if;
      mapped := mapped || jsonb_build_object(source_key,jsonb_build_object('id',stored.target_entity_id,'target',stored.target_entity_type));
      reused := reused + 1;
      continue;
    end if;
    origin_id := case when promoting then stored.id else gen_random_uuid() end; destination := gen_random_uuid(); existing := nullif(r->>'existingId','')::uuid;
    if target in ('categories','credit_cards','credit_card_invoices') and existing is null and action<>'dependency' then raise exception 'Cadastro novo exige dependência de lançamento aprovado.'; end if;
    parent_id := null; category_id := null; card_id := null; invoice_id := null;
    links := coalesce(r->'links','{}');
    if target <> 'source_only' and not (existing is not null and target in ('accounts_payable','income_sources','credit_card_transactions')) then
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
    if target in ('accounts_payable','income_sources','credit_card_transactions') then
      if r->'source'->>'kind' in ('transfer','invoice_payment') then raise exception 'Transferência/pagamento deve permanecer na origem.'; end if;
      if r->'source'->'raw' ?| array['oposite_transaction_id','opposite_transaction_id','paid_credit_card_id','paid_credit_card_invoice_id','oposite_account_id','opposite_account_id','opposite_transaction_id'] then
        if r->'source'->>'kind' in ('transfer','invoice_payment') or coalesce(nullif(r->'source'->'raw'->>'oposite_account_id',''),'0')::bigint>0 or coalesce(nullif(r->'source'->'raw'->>'opposite_account_id',''),'0')::bigint>0 or coalesce(nullif(r->'source'->'raw'->>'oposite_transaction_id',''),'0')::bigint>0 or coalesce(nullif(r->'source'->'raw'->>'opposite_transaction_id',''),'0')::bigint>0 or coalesce(nullif(r->'source'->'raw'->>'paid_credit_card_id',''),'0')::bigint>0 or coalesce(nullif(r->'source'->'raw'->>'paid_credit_card_invoice_id',''),'0')::bigint>0 then raise exception 'Transferência ou pagamento não é nova despesa/receita.'; end if;
      end if;
      if abs((r->'source'->'raw'->>'amount_cents')::numeric)/100 is distinct from (v->>'amount')::numeric then raise exception 'Valor da origem divergente.'; end if;
      if target='income_sources' and (r->'source'->'raw'->>'amount_cents')::numeric <= 0 or target<>'income_sources' and (r->'source'->'raw'->>'amount_cents')::numeric >= 0 then raise exception 'Natureza financeira divergente.'; end if;
      if existing is null then
        if coalesce(v->>'due_date',v->>'expected_date',v->>'transaction_date')::date is distinct from (r->'source'->'raw'->>'date')::date then raise exception 'Data nova divergente da origem.'; end if;
        if action<>'new' or ownership is null or ownership not in ('personal','third_party','shared','family','reimbursable') then raise exception 'Novo lançamento exige titularidade explícita.'; end if;
        if review_person_id is not null and not exists(select 1 from public.people where id=review_person_id and user_id=u) then raise exception 'Responsável de outro usuário.' using errcode='42501'; end if;
        if ownership='reimbursable' and review_person_id is null then raise exception 'Reembolsável exige responsável, sem criar reembolso automaticamente.'; end if;
        if target='income_sources' and (v->>'inflow_kind' is null or v->>'inflow_kind' not in ('real_income','reimbursement','third_party_money')) then raise exception 'Natureza da entrada obrigatória.'; end if;
        if not coalesce((r->'review'->>'confirmDifferent')::boolean,false) and (
          exists(select 1 from public.accounts_payable where user_id=u and target<>'income_sources' and amount=(v->>'amount')::numeric and abs(due_date-(r->'source'->'raw'->>'date')::date)<=7) or
          exists(select 1 from public.credit_card_transactions where user_id=u and target<>'income_sources' and amount=(v->>'amount')::numeric and abs(transaction_date-(r->'source'->'raw'->>'date')::date)<=7) or
          exists(select 1 from public.income_sources where user_id=u and target='income_sources' and amount=(v->>'amount')::numeric and (abs(expected_date-(r->'source'->'raw'->>'date')::date)<=7 or abs(received_date-(r->'source'->'raw'->>'date')::date)<=7))
        ) then raise exception 'Possível duplicata: atualize a prévia e confirme se é realmente novo.'; end if;
      elsif least(abs(coalesce(v->>'due_date',v->>'expected_date',v->>'transaction_date')::date - (r->'source'->'raw'->>'date')::date),abs(coalesce(v->>'received_date',v->>'due_date',v->>'expected_date',v->>'transaction_date')::date - (r->'source'->'raw'->>'date')::date))>7 then raise exception 'Data da correspondência fora da janela de revisão.';
      elsif action<>'link' then raise exception 'Vínculo existente exige revisão explícita.';
      end if;
    end if;
    if existing is not null then
      own := case target
        when 'categories' then exists(select 1 from public.categories where id=existing and user_id=u)
        when 'credit_cards' then exists(select 1 from public.credit_cards where id=existing and user_id=u)
        when 'credit_card_invoices' then exists(select 1 from public.credit_card_invoices where id=existing and user_id=u and credit_card_id=card_id and due_date=(v->>'due_date')::date and total_amount=(v->>'total_amount')::numeric)
        when 'credit_card_transactions' then exists(select 1 from public.credit_card_transactions t where t.id=existing and t.user_id=u and t.credit_card_id=(v->>'credit_card_id')::uuid and t.invoice_id is not distinct from (v->>'invoice_id')::uuid and t.category_id is not distinct from (v->>'category_id')::uuid and t.person_id is not distinct from (v->>'person_id')::uuid and t.ownership_type::text is not distinct from (v->>'ownership_type') and t.transaction_date=(v->>'transaction_date')::date and t.amount=(v->>'amount')::numeric)
        when 'accounts_payable' then exists(select 1 from public.accounts_payable a where a.id=existing and a.user_id=u and a.due_date=(v->>'due_date')::date and a.amount=(v->>'amount')::numeric and a.category_id is not distinct from (v->>'category_id')::uuid and a.person_id is not distinct from (v->>'person_id')::uuid)
        when 'income_sources' then exists(select 1 from public.income_sources i where i.id=existing and i.user_id=u and i.expected_date is not distinct from (v->>'expected_date')::date and i.received_date is not distinct from (v->>'received_date')::date and i.amount=(v->>'amount')::numeric and i.category_id is not distinct from (v->>'category_id')::uuid and i.person_id is not distinct from (v->>'person_id')::uuid and i.inflow_kind::text is not distinct from (v->>'inflow_kind'))
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
      if action<>'dependency' or (v->>'paid_amount')::numeric is distinct from 0::numeric or (v->>'total_amount')::numeric is distinct from (select coalesce(sum((x->'values'->>'amount')::numeric),0) from jsonb_array_elements(p_rows) x where x->>'target'='credit_card_transactions' and nullif(x->>'existingId','') is null and x->'review'->>'action'='new' and x->'links'->>'invoice'=source_key) then raise exception 'Fatura nova deve conter apenas as compras novas aprovadas.'; end if;
      insert into public.credit_card_invoices (id,user_id,credit_card_id,reference_month,due_date,closing_date,total_amount,paid_amount,status,personal_amount,reimbursable_amount,third_party_amount,notes)
      values(destination,u,card_id,(v->>'reference_month')::date,(v->>'due_date')::date,(v->>'closing_date')::date,(v->>'total_amount')::numeric,(v->>'paid_amount')::numeric,(v->>'status')::public.invoice_status,coalesce((v->>'personal_amount')::numeric,0),coalesce((v->>'reimbursable_amount')::numeric,0),coalesce((v->>'third_party_amount')::numeric,0),v->>'notes');
      created := created + 1;
    elsif target='credit_card_transactions' then
      if card_id is null then raise exception 'Lançamento sem cartão.'; end if;
      if invoice_id is not null and not exists(select 1 from public.credit_card_invoices where id=invoice_id and user_id=u and credit_card_id=card_id) then raise exception 'Fatura de outro cartão.'; end if;
      insert into public.credit_card_transactions (id,user_id,credit_card_id,invoice_id,category_id,description,amount,transaction_date,person_id,ownership_type,is_reimbursable,reimbursement_status,installment_number,installment_total,notes)
      values(destination,u,card_id,invoice_id,category_id,v->>'description',(v->>'amount')::numeric,(v->>'transaction_date')::date,review_person_id,ownership::public.ownership_type,ownership='reimbursable',case when ownership='reimbursable' then 'pending' else 'not_applicable' end,(v->>'installment_number')::integer,(v->>'installment_total')::integer,v->>'notes');
      created := created + 1;
    elsif target='accounts_payable' then
      insert into public.accounts_payable (id,user_id,category_id,person_id,title,amount,due_date,status,source_type,source_id,paid_at,notes)
      values(destination,u,category_id,review_person_id,v->>'title',(v->>'amount')::numeric,(v->>'due_date')::date,(v->>'status')::public.record_status,'organizze',origin_id,case when v->>'status'='paid' then ((v->>'due_date') || 'T12:00:00Z')::timestamptz else null end,v->>'notes');
      created := created + 1;
    elsif target='income_sources' then
      insert into public.income_sources (id,user_id,category_id,person_id,name,amount,expected_date,status,source_type,inflow_kind,received_date,received_at,notes)
      values(destination,u,category_id,review_person_id,v->>'name',(v->>'amount')::numeric,(v->>'expected_date')::date,(v->>'status')::public.expected_status,'organizze',(v->>'inflow_kind')::public.inflow_kind,(v->>'received_date')::date,(v->>'received_at')::timestamptz,v->>'notes');
      created := created + 1;
    end if;
    metadata := jsonb_build_object('source','organizze','source_key',source_key,'tags',coalesce(r->'tags','[]'),'source_links',links,'resolved_links',(select coalesce(jsonb_object_agg(e.key,mapped->e.value),'{}'::jsonb) from jsonb_each_text(links) e),'reason',r->'reason','review',r->'review','state',case when existing is not null then 'reconciled' when target='source_only' and action='pending' then 'pending' when target='source_only' then 'historical' else 'imported' end);
    if promoting then
      update public.import_rows set parsed_data=v,mapped_data=metadata || jsonb_build_object('previous_review',stored.mapped_data,'reconciled_batch_id',batch),status=case when existing is not null then 'skipped'::public.import_row_status else 'imported'::public.import_row_status end,target_entity_type=target,target_entity_id=destination where id=origin_id and user_id=u;
    else
      insert into public.import_rows (id,user_id,import_batch_id,row_number,raw_data,parsed_data,mapped_data,status,target_entity_type,target_entity_id)
      values(origin_id,u,batch,n,r->'source',v,metadata,case when target='source_only' or existing is not null then 'skipped'::public.import_row_status else 'imported'::public.import_row_status end,target,destination);
    end if;
    mapped := mapped || jsonb_build_object(source_key,jsonb_build_object('id',destination,'target',target));
  end loop;
  update public.import_batches set status='imported',valid_rows=created,confirmed_at=now(),imported_at=now(),notes=format('Organizze: %s criados, %s vinculados/repetidos, %s preservados na origem.',created,reused,retained) where id=batch and user_id=u;
  return jsonb_build_object('batchId',batch,'created',created,'reused',reused,'sourceOnly',retained,'total',n);
end;
$$;
revoke all on function public.confirm_organizze_reconciliation(jsonb,jsonb) from public, anon;
revoke all on function public.organizze_reconciliation_ready() from public, anon;
grant execute on function public.confirm_organizze_reconciliation(jsonb,jsonb) to authenticated;
grant execute on function public.organizze_reconciliation_ready() to authenticated;

-- Old clients cannot bypass per-record review after this migration.
revoke execute on function public.confirm_organizze_import(jsonb,jsonb,text) from authenticated;
