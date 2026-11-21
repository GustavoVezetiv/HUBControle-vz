begin;
set local lock_timeout = '5s';
do $$
begin
  if to_regprocedure('public.confirm_organizze_reconciliation(jsonb,jsonb)') is null
    or to_regprocedure('public.review_pluggy_row(text,jsonb,timestamptz)') is null
    or to_regprocedure('public.mcp_execute_direct_write_v2(uuid,text,text,jsonb)') is null
    or to_regprocedure('public.mcp_recalculate_invoice_totals_v1(uuid,uuid,boolean)') is null
  then raise exception 'Instale primeiro as funções do Organizze, Meu Pluggy e MCP oficial.'; end if;
end $$;

-- Older official rollouts can omit the planning proposal table.
create table if not exists public.mcp_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  arguments jsonb not null,
  intent_signature text not null check (intent_signature ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'completed', 'rejected', 'failed')),
  result jsonb,
  error_message text,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  constraint mcp_action_requests_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '11 minutes')
);
create index if not exists mcp_action_requests_user_created_idx on public.mcp_action_requests (user_id, created_at desc);
alter table public.mcp_action_requests enable row level security;
revoke all on public.mcp_action_requests from public, anon, authenticated;
grant select, insert, update on public.mcp_action_requests to service_role;

alter table public.mcp_action_requests drop constraint if exists mcp_action_requests_tool_name_check;
alter table public.mcp_action_requests add constraint mcp_action_requests_tool_name_check check (tool_name in (
  'hub_create_planned_purchase', 'hub_update_planned_purchase',
  'hub_create_goal', 'hub_update_goal', 'hub_prepare_import_reviews'
));

create or replace function public.mcp_confirm_import_reviews(p_user_id uuid, p_request_id uuid, p_signature text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  proposal public.mcp_action_requests%rowtype;
  item jsonb;
  entry public.import_rows%rowtype;
  source_name text;
  source_key text;
  outcome jsonb;
  results jsonb := '[]'::jsonb;
  review jsonb;
  creation jsonb;
  payload jsonb;
  original jsonb;
  link jsonb;
  link_version timestamptz;
  invoice jsonb;
  tool_name text;
  target text;
  new_id uuid;
  date_of_movement date;
  amount_of_movement numeric;
  direction text;
  original_category uuid;
  code text;
  previous_sub text := current_setting('request.jwt.claim.sub', true);
  previous_claims text := current_setting('request.jwt.claims', true);
begin
  select * into proposal from public.mcp_action_requests r
  where r.id=p_request_id and r.user_id=p_user_id and r.tool_name='hub_prepare_import_reviews' for update;
  if not found or proposal.intent_signature is distinct from p_signature then raise exception 'Proposta inválida.' using errcode='42501'; end if;
  if proposal.status='completed' then return proposal.result; end if;
  if proposal.status<>'pending' or proposal.expires_at<=clock_timestamp() then raise exception 'Proposta vencida.' using errcode='22023'; end if;
  if jsonb_typeof(proposal.arguments->'items') is distinct from 'array' then raise exception 'Itens inválidos.'; end if;
  if jsonb_array_length(proposal.arguments->'items') not between 1 and 20 then raise exception 'Tamanho de lote inválido.'; end if;

  -- The OAuth server has validated the owner and signature. Nested import RPCs
  -- use auth.uid() and explicit owner predicates. Only service_role can call
  -- this wrapper, and the proposal is locked and matched to the owner first.
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims', (coalesce(nullif(previous_claims,'')::jsonb,'{}'::jsonb) || jsonb_build_object('sub',p_user_id,'role','service_role'))::text, true);
  perform pg_advisory_xact_lock(hashtextextended('organizze:'||p_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('pluggy:'||p_user_id::text,0));

  for item in select value from jsonb_array_elements(proposal.arguments->'items') loop
    source_name := item->>'source';
    source_key := item->>'sourceKey';
    begin
      if source_name='merchant' and source_key is not null then
        new_id := public.save_pluggy_merchant(item->'merchant');
        results := results || jsonb_build_array(jsonb_build_object('sourceKey',source_key,'ok',true,'result',
          jsonb_build_object('associationId',new_id,'financialWrites',0)));
        continue;
      end if;
      if source_name is null or source_name not in ('pluggy','organizze') or source_key is null then raise exception 'Origem inválida.' using errcode='22023'; end if;
      select * into entry from public.import_rows r where r.user_id=p_user_id and r.mapped_data->>'source'=source_name and r.mapped_data->>'source_key'=source_key for update;
      if entry.updated_at is distinct from (item->>'expectedUpdatedAt')::timestamptz then raise exception 'Origem alterada.' using errcode='40001'; end if;
      link := item->'link';
      if jsonb_typeof(link)='object' then
        target := link->>'target';
        link_version := null;
        if target not in ('accounts_payable','income_sources','credit_card_transactions') or target is null then raise exception 'Destino inválido.' using errcode='42501'; end if;
        execute format('select updated_at from public.%I where id=$1 and user_id=$2 and archived_at is null for update',target)
          into link_version using (link->>'id')::uuid,p_user_id;
        if link_version is null or link_version is distinct from (link->>'version')::timestamptz then raise exception 'Destino alterado.' using errcode='40001'; end if;
      end if;
      if source_name='organizze' then
        if entry.target_entity_id is not null and entry.target_entity_type is distinct from 'source_only' then raise exception 'Origem já conciliada.' using errcode='23505'; end if;
        original_category := nullif(item->>'categoryId','')::uuid;
        if original_category is not null and not exists(select 1 from public.categories where user_id=p_user_id and id=original_category) then raise exception 'Categoria indisponível.' using errcode='42501'; end if;
        if exists (select 1 from jsonb_array_elements(item->'rows') r where r->'review'->>'action'='new') then
          lock table public.accounts_payable, public.credit_card_transactions, public.income_sources in share row exclusive mode;
        end if;
        invoice := item->'invoice';
        if jsonb_typeof(invoice)='object' then
          if invoice->>'id' is not null then
            perform 1 from public.credit_card_invoices where user_id=p_user_id and id=(invoice->>'id')::uuid
              and status='open' and archived_at is null and updated_at=(invoice->>'version')::timestamptz for update;
            if not found then raise exception 'Fatura alterada ou não está aberta.' using errcode='40001'; end if;
          elsif exists (select 1 from public.import_rows r where r.user_id=p_user_id
            and r.mapped_data->>'source'='organizze' and r.mapped_data->>'source_key'=invoice->>'sourceKey' and r.target_entity_type='credit_card_invoices') then
            raise exception 'Fatura criada desde a leitura.' using errcode='40001';
          end if;
        end if;
        outcome := public.confirm_organizze_reconciliation(item->'rows',item->'period');
        if invoice->>'id' is not null then
          outcome := outcome || jsonb_build_object('invoiceTotals',public.mcp_recalculate_invoice_totals_v1(p_user_id,(invoice->>'id')::uuid,false));
        end if;
        if item->>'classificationOnly'='true' then
          update public.import_rows r set mapped_data=r.mapped_data || jsonb_build_object('category_id', original_category, 'review', r.mapped_data->'review' || jsonb_build_object('ownership',item->>'ownership'))
          where r.user_id=p_user_id and r.mapped_data->>'source'='organizze' and r.mapped_data->>'source_key'=source_key and r.target_entity_type='source_only';
        end if;
        select outcome || jsonb_build_object('target',r.target_entity_type,'targetId',case when r.target_entity_type<>'source_only' then r.target_entity_id end) into outcome
        from public.import_rows r where r.user_id=p_user_id and r.mapped_data->>'source'='organizze' and r.mapped_data->>'source_key'=source_key;
      else
        if entry.id is null or entry.target_entity_id is not null then raise exception 'Origem indisponível ou já conciliada.' using errcode='23505'; end if;
        review := item->'classification';
        creation := item->'create';
        if jsonb_typeof(creation) is distinct from 'object' then
          outcome := public.review_pluggy_row(source_key,review,entry.updated_at);
        else
          original := entry.mapped_data->'latest_raw';
          payload := creation->'args';
          target := creation->>'target';
          tool_name := creation->>'tool';
          direction := original->>'type';
          if original->>'status' is distinct from 'POSTED' or original->>'currencyCode' is distinct from 'BRL'
            or original->>'operationType' in ('PAGAMENTO_FATURA','ESTORNO','CASHBACK')
            or entry.mapped_data->>'state' not in ('new','pending')
            or coalesce(review->>'ownership','') not in ('personal','third_party','shared','family')
          then raise exception 'Origem não pode criar lançamento.' using errcode='22023'; end if;
          date_of_movement := left(original->>'date',10)::date;
          amount_of_movement := abs((original->>'amount')::numeric);
          if date_of_movement is null or amount_of_movement is null or (payload->>'amount')::numeric is distinct from amount_of_movement then raise exception 'Dados da origem divergentes.' using errcode='40001'; end if;
          lock table public.accounts_payable, public.credit_card_transactions, public.income_sources in share row exclusive mode;
          if (direction='DEBIT' and (
                exists(select 1 from public.accounts_payable a where a.user_id=p_user_id and a.amount=amount_of_movement and abs(a.due_date-date_of_movement)<=7)
                or exists(select 1 from public.credit_card_transactions t where t.user_id=p_user_id and t.amount=amount_of_movement and abs(t.transaction_date-date_of_movement)<=7)
              )) or (direction='CREDIT' and exists(select 1 from public.income_sources i where i.user_id=p_user_id and i.amount=amount_of_movement and (abs(i.expected_date-date_of_movement)<=7 or abs(i.received_date-date_of_movement)<=7)))
          then raise exception 'Possível lançamento já existente.' using errcode='23505'; end if;
          if target='credit_card_transactions' and tool_name='hub_create_transaction' and entry.mapped_data->>'account_type'='CREDIT' and direction='DEBIT' then
            perform 1 from public.credit_card_invoices where id=(payload->>'invoiceId')::uuid and user_id=p_user_id
              and updated_at=(creation->>'invoiceVersion')::timestamptz and status='open' and archived_at is null for update;
            if not found then raise exception 'Fatura alterada ou não está aberta.' using errcode='40001'; end if;
            payload := payload || jsonb_build_object('createReimbursement',false,'isReimbursable',false,'ownershipType',review->>'ownership','transactionDate',date_of_movement,'confirmSensitiveChange',false);
          elsif target='accounts_payable' and tool_name='hub_create_account_detailed' and entry.mapped_data->>'account_type'='BANK' and direction='DEBIT' then
            payload := payload || jsonb_build_object('dueDate',date_of_movement,'paidDate',date_of_movement,'status','paid');
          elsif target='income_sources' and tool_name='hub_create_income' and entry.mapped_data->>'account_type'='BANK' and direction='CREDIT'
            and (payload->>'sourceType'='third_party_money' or (payload->>'sourceType'='real_income' and review->>'ownership'='personal')) then
            payload := payload || jsonb_build_object('expectedDate',date_of_movement,'receivedDate',date_of_movement,'status','received');
          else raise exception 'Destino incompatível com a origem.' using errcode='22023'; end if;
          outcome := public.mcp_execute_direct_write_v2(p_user_id,'import:'||p_request_id::text||':'||entry.id::text,tool_name,payload);
          new_id := (outcome->>'id')::uuid;
          if new_id is null then raise exception 'Lançamento não criado.'; end if;
          update public.import_rows set status='imported',target_entity_type=target,target_entity_id=new_id,
            mapped_data=entry.mapped_data || jsonb_build_object('state','reconciled','reviewed',true,'linked_raw',original,'category_id',review->'categoryId','ownership',review->'ownership','review',review)
          where id=entry.id and user_id=p_user_id;
          outcome := jsonb_build_object('created',1,'target',target,'targetId',new_id);
        end if;
      end if;
      insert into public.audit_logs(user_id,module,record_id,action,new_value,metadata)
      values(p_user_id,'imports',p_request_id,'confirm_import_item',outcome,jsonb_build_object('source',source_name,'sourceKey',source_key));
      results := results || jsonb_build_array(jsonb_build_object('sourceKey',source_key,'ok',true,'result',outcome));
    exception when others then
      get stacked diagnostics code=returned_sqlstate;
      results := results || jsonb_build_array(jsonb_build_object('sourceKey',source_key,'ok',false,'code',code,'error',case code
        when '40001' then 'Origem ou destino mudou. Consulte novamente e prepare nova proposta.'
        when '55P03' then 'Outra operação está usando os registros. Consulte novamente e prepare nova proposta.'
        when '40P01' then 'Houve concorrência com outra edição. Consulte novamente e prepare nova proposta.'
        when '23505' then 'Origem já vinculada ou possível duplicata. Confira o lançamento existente.'
        when '42501' then 'Referência indisponível para o proprietário ou incompatível com a origem.'
        when '42883' then 'Função de conciliação ausente. Confira as migrations da origem.'
        else 'Operação rejeitada pelas regras do Hub. Revise a origem e o destino.' end));
    end;
  end loop;
  outcome := jsonb_build_object('confirmationId',p_request_id,'items',results);
  update public.mcp_action_requests set status='completed',result=outcome,approved_at=clock_timestamp(),completed_at=clock_timestamp(),decided_by=p_user_id where id=p_request_id and user_id=p_user_id;
  perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(previous_claims,''),true);
  return outcome;
end $$;

revoke all on function public.mcp_confirm_import_reviews(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mcp_confirm_import_reviews(uuid,uuid,text) to service_role;
commit;
