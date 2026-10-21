-- Consolidated production migration for the official Hub VZ MCP.
-- It only adds server-only OAuth/idempotency storage and the validated atomic
-- RPCs. Existing financial rows, RLS policies and application table grants are
-- not changed. Legacy helper functions receive the same safe privilege
-- hardening already validated in staging.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ChatGPT receives opaque Hub OAuth tokens and never receives a Supabase JWT.
-- Supabase sessions remain encrypted in this server-only store.
create table if not exists public.mcp_oauth_records (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('flow', 'code', 'access', 'refresh')),
  sealed_payload text not null,
  status text not null default 'active'
    check (status in ('active', 'processing', 'consumed', 'revoked')),
  expires_at timestamptz not null,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mcp_oauth_records_expiry_idx
  on public.mcp_oauth_records (expires_at);

alter table public.mcp_oauth_records enable row level security;
revoke all on public.mcp_oauth_records from public, anon, authenticated;
grant select, insert, update, delete on public.mcp_oauth_records to service_role;

-- Direct MCP writes are deliberately funneled through one atomic RPC.

create table if not exists public.mcp_write_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  tool_name text not null,
  arguments jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  constraint mcp_write_operations_idempotency_key_check
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  constraint mcp_write_operations_user_key_unique unique (user_id, idempotency_key)
);

create index if not exists mcp_write_operations_user_created_idx
  on public.mcp_write_operations (user_id, created_at desc);

alter table public.mcp_write_operations enable row level security;
revoke all on public.mcp_write_operations from public, anon, authenticated;
grant select, insert on public.mcp_write_operations to service_role;

-- Preserve the existing application behavior while closing legacy function
-- privileges already reported by the Supabase security advisor. Trigger
-- execution is unaffected by revoking direct RPC execution.
alter function public.set_updated_at()
  set search_path = pg_catalog, public;
alter function public.create_default_categories_for_current_user()
  set search_path = pg_catalog, public, auth;
alter function public.handle_new_user()
  set search_path = pg_catalog, public;
revoke all on function public.handle_new_user() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

-- If an older proposal migration was ever installed, keep its RPC server-only.
-- A clean production install does not create the proposal table or function.
do $$
begin
  if to_regprocedure('public.mcp_decide_planning_action(uuid,text,text)') is not null then
    execute 'revoke all on function public.mcp_decide_planning_action(uuid, text, text) from public, anon, authenticated';
    execute 'grant execute on function public.mcp_decide_planning_action(uuid, text, text) to service_role';
  end if;
end;
$$;

create or replace function public.mcp_recalculate_invoice_totals_v1(
  p_user_id uuid,
  p_invoice_id uuid,
  p_allow_paid boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_total numeric := 0;
  v_personal numeric := 0;
  v_reimbursable numeric := 0;
  v_third_party numeric := 0;
begin
  select status::text into v_status
  from public.credit_card_invoices
  where id = p_invoice_id and user_id = p_user_id and archived_at is null
  for update;

  if not found then
    raise exception 'Fatura não encontrada ou arquivada.' using errcode = '22023';
  end if;
  if v_status in ('canceled', 'cancelled') then
    raise exception 'Fatura cancelada não pode receber lançamentos.' using errcode = '22023';
  end if;
  if v_status = 'paid' and not p_allow_paid then
    raise exception 'Alterar lançamento de fatura quitada exige confirmação explícita.' using errcode = '22023';
  end if;

  select
    coalesce(sum(amount), 0),
    coalesce(sum(case when ownership_type::text = 'personal' then amount else 0 end), 0),
    coalesce(sum(case when is_reimbursable then amount else 0 end), 0),
    coalesce(sum(case when ownership_type::text in ('third_party', 'shared', 'family') then amount else 0 end), 0)
  into v_total, v_personal, v_reimbursable, v_third_party
  from public.credit_card_transactions
  where user_id = p_user_id and invoice_id = p_invoice_id and archived_at is null;

  update public.credit_card_invoices
  set total_amount = round(v_total, 2),
      personal_amount = round(v_personal, 2),
      reimbursable_amount = round(v_reimbursable, 2),
      third_party_amount = round(v_third_party, 2),
      updated_at = clock_timestamp()
  where id = p_invoice_id and user_id = p_user_id;

  return jsonb_build_object(
    'invoiceId', p_invoice_id,
    'totalAmount', round(v_total, 2),
    'personalAmount', round(v_personal, 2),
    'reimbursableAmount', round(v_reimbursable, 2),
    'thirdPartyAmount', round(v_third_party, 2)
  );
end;
$$;

revoke all on function public.mcp_recalculate_invoice_totals_v1(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.mcp_recalculate_invoice_totals_v1(uuid, uuid, boolean) to service_role;

drop function if exists public.mcp_execute_direct_write_v1(text, text, jsonb);

create or replace function public.mcp_execute_direct_write_v1(
  p_user_id uuid,
  p_idempotency_key text,
  p_tool_name text,
  p_arguments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid := p_user_id;
  v_existing public.mcp_write_operations%rowtype;
  v_account public.accounts_payable%rowtype;
  v_income public.income_sources%rowtype;
  v_transaction public.credit_card_transactions%rowtype;
  v_invoice public.credit_card_invoices%rowtype;
  v_purchase public.planned_purchases%rowtype;
  v_goal public.goals%rowtype;
  v_reimbursement public.reimbursements%rowtype;
  v_linked_reimbursement public.reimbursements%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_invoice_totals jsonb;
  v_title text;
  v_status text;
  v_source_type text;
  v_inflow_kind text;
  v_amount numeric;
  v_received numeric;
  v_category_id uuid;
  v_person_id uuid;
  v_invoice_id uuid;
  v_card_id uuid;
  v_link_id uuid;
  v_reimbursement_id uuid;
  v_paid_confirmed boolean := coalesce((p_arguments->>'confirmSensitiveChange')::boolean, false)
    and p_arguments->>'confirmationText' = 'CONFIRMO ALTERAR FATURA QUITADA';
begin
  if v_user_id is null or not exists (select 1 from auth.users where id = v_user_id) then
    raise exception 'Usuário MCP inválido.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' then
    raise exception 'idempotencyKey deve conter de 8 a 128 caracteres seguros.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_arguments) <> 'object' then
    raise exception 'Argumentos da escrita devem ser um objeto JSON.' using errcode = '22023';
  end if;
  if p_tool_name not in (
    'hub_create_account', 'hub_update_account',
    'hub_create_income', 'hub_update_income',
    'hub_create_transaction', 'hub_update_transaction',
    'hub_create_planned_purchase', 'hub_update_planned_purchase',
    'hub_create_goal', 'hub_update_goal',
    'hub_create_reimbursement', 'hub_update_reimbursement',
    'hub_register_reimbursement_receipt'
  ) then
    raise exception 'Ferramenta de escrita não autorizada.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key, 0));
  select * into v_existing
  from public.mcp_write_operations
  where user_id = v_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.tool_name is distinct from p_tool_name or v_existing.arguments is distinct from p_arguments then
      raise exception 'idempotencyKey já foi usada com outra operação ou outros argumentos.' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('idempotentReplay', true, 'operationId', v_existing.id);
  end if;

  if nullif(p_arguments->>'categoryId', '') is not null then
    v_category_id := (p_arguments->>'categoryId')::uuid;
    if not exists (
      select 1 from public.categories
      where id = v_category_id and user_id = v_user_id and is_active = true
    ) then
      raise exception 'Categoria indisponível para este usuário.' using errcode = '22023';
    end if;
  end if;
  if nullif(p_arguments->>'personId', '') is not null then
    v_person_id := (p_arguments->>'personId')::uuid;
    if not exists (
      select 1 from public.people
      where id = v_person_id and user_id = v_user_id and is_active = true
    ) then
      raise exception 'Pessoa indisponível para este usuário.' using errcode = '22023';
    end if;
  end if;

  if p_tool_name = 'hub_create_account' then
    v_title := btrim(coalesce(p_arguments->>'title', ''));
    v_amount := coalesce((p_arguments->>'amount')::numeric, 0);
    v_status := coalesce(p_arguments->>'status', 'pending');
    if length(v_title) < 1 or length(v_title) > 300 or v_amount <= 0 or v_amount > 1000000000
       or nullif(p_arguments->>'dueDate', '') is null
       or v_status not in ('pending', 'paid', 'overdue', 'canceled')
       or coalesce(p_arguments->>'priority', 'medium') not in ('low', 'normal', 'medium', 'high', 'critical')
       or coalesce(p_arguments->>'riskLevel', 'medium') not in ('low', 'medium', 'high', 'critical')
       or coalesce(p_arguments->>'paymentMethod', 'unknown') not in ('cash', 'pix', 'credit_card', 'bank_slip', 'debit', 'transfer', 'negotiation', 'unknown')
       or coalesce(p_arguments->>'lateInterestFrequency', 'monthly') not in ('daily', 'monthly') then
      raise exception 'Dados da despesa inválidos.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':account:' || lower(v_title) || ':' || v_amount::text || ':' || (p_arguments->>'dueDate'), 0));
    if exists (
      select 1 from public.accounts_payable
      where user_id = v_user_id and archived_at is null
        and lower(btrim(title)) = lower(v_title) and amount = v_amount
        and due_date = (p_arguments->>'dueDate')::date
    ) then
      raise exception 'Despesa equivalente já existe.' using errcode = '23505';
    end if;
    insert into public.accounts_payable (
      user_id, category_id, person_id, title, description, amount, due_date,
      status, priority, risk_level, paid_at, payment_method_planned,
      can_delay, delay_risk, notes, source_type, is_generated,
      late_interest_enabled, late_interest_rate, late_interest_frequency,
      late_fee_amount, interest_start_date
    ) values (
      v_user_id, v_category_id, v_person_id, v_title,
      nullif(btrim(p_arguments->>'description'), ''), round(v_amount, 2),
      (p_arguments->>'dueDate')::date, v_status::public.record_status,
      coalesce(p_arguments->>'priority', 'medium')::public.priority_level,
      coalesce(p_arguments->>'riskLevel', 'medium')::public.risk_level,
      case when v_status = 'paid' then coalesce(nullif(p_arguments->>'paidDate', '')::date, (p_arguments->>'dueDate')::date)::timestamptz else null end,
      coalesce(p_arguments->>'paymentMethod', 'unknown'),
      coalesce((p_arguments->>'canDelay')::boolean, false),
      coalesce(p_arguments->>'delayRisk', 'medium')::public.risk_level,
      nullif(btrim(p_arguments->>'notes'), ''), 'manual', false,
      coalesce((p_arguments->>'lateInterestEnabled')::boolean, false),
      case when coalesce((p_arguments->>'lateInterestEnabled')::boolean, false) then coalesce((p_arguments->>'lateInterestRate')::numeric, 0) else 0 end,
      coalesce(p_arguments->>'lateInterestFrequency', 'monthly'),
      case when coalesce((p_arguments->>'lateInterestEnabled')::boolean, false) then coalesce((p_arguments->>'lateFeeAmount')::numeric, 0) else 0 end,
      case when coalesce((p_arguments->>'lateInterestEnabled')::boolean, false) then nullif(p_arguments->>'interestStartDate', '')::date else null end
    ) returning * into v_account;
    v_result := jsonb_build_object('id', v_account.id, 'title', v_account.title, 'amount', v_account.amount, 'dueDate', v_account.due_date, 'status', v_account.status);
    insert into public.audit_logs (user_id, module, record_id, action, new_value, metadata)
    values (v_user_id, 'accounts_payable', v_account.id, 'create', to_jsonb(v_account), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name = 'hub_update_account' then
    select * into v_account from public.accounts_payable
    where id = (p_arguments->>'id')::uuid and user_id = v_user_id and archived_at is null for update;
    if not found then raise exception 'Despesa não encontrada ou arquivada.' using errcode = '22023'; end if;
    if v_account.updated_at is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then
      raise exception 'Despesa alterada desde a leitura; consulte novamente antes de editar.' using errcode = '40001';
    end if;
    if (v_account.is_generated or v_account.source_type <> 'manual' or v_account.installment_id is not null or v_account.reimbursement_id is not null or v_account.credit_card_transaction_id is not null)
       and ((p_arguments ? 'amount' and (p_arguments->>'amount')::numeric is distinct from v_account.amount)
         or (p_arguments ? 'dueDate' and (p_arguments->>'dueDate')::date is distinct from v_account.due_date)
         or (p_arguments ? 'categoryId' and v_category_id is distinct from v_account.category_id)
         or (p_arguments ? 'personId' and v_person_id is distinct from v_account.person_id)) then
      raise exception 'Valores estruturais de despesa vinculada devem ser corrigidos no módulo de origem.' using errcode = '22023';
    end if;
    v_before := to_jsonb(v_account);
    v_title := case when p_arguments ? 'title' then btrim(p_arguments->>'title') else v_account.title end;
    v_amount := case when p_arguments ? 'amount' then (p_arguments->>'amount')::numeric else v_account.amount end;
    v_status := case when p_arguments ? 'status' then p_arguments->>'status' else v_account.status::text end;
    if length(v_title) < 1 or length(v_title) > 300 or v_amount <= 0 or v_amount > 1000000000
       or v_status not in ('pending', 'paid', 'overdue', 'canceled') then
      raise exception 'Dados da despesa inválidos.' using errcode = '22023';
    end if;
    update public.accounts_payable set
      title = v_title,
      description = case when p_arguments ? 'description' then nullif(btrim(p_arguments->>'description'), '') else description end,
      amount = round(v_amount, 2),
      due_date = case when p_arguments ? 'dueDate' then (p_arguments->>'dueDate')::date else due_date end,
      category_id = case when p_arguments ? 'categoryId' then v_category_id else category_id end,
      person_id = case when p_arguments ? 'personId' then v_person_id else person_id end,
      status = v_status::public.record_status,
      priority = case when p_arguments ? 'priority' then (p_arguments->>'priority')::public.priority_level else priority end,
      risk_level = case when p_arguments ? 'riskLevel' then (p_arguments->>'riskLevel')::public.risk_level else risk_level end,
      paid_at = case when v_status = 'paid' then coalesce(nullif(p_arguments->>'paidDate', '')::date::timestamptz, paid_at, clock_timestamp()) else null end,
      payment_method_planned = case when p_arguments ? 'paymentMethod' then p_arguments->>'paymentMethod' else payment_method_planned end,
      can_delay = case when p_arguments ? 'canDelay' then (p_arguments->>'canDelay')::boolean else can_delay end,
      delay_risk = case when p_arguments ? 'delayRisk' then (p_arguments->>'delayRisk')::public.risk_level else delay_risk end,
      notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'), '') else notes end,
      late_interest_enabled = case when p_arguments ? 'lateInterestEnabled' then (p_arguments->>'lateInterestEnabled')::boolean else late_interest_enabled end,
      late_interest_rate = case when p_arguments ? 'lateInterestRate' then (p_arguments->>'lateInterestRate')::numeric else late_interest_rate end,
      late_interest_frequency = case when p_arguments ? 'lateInterestFrequency' then p_arguments->>'lateInterestFrequency' else late_interest_frequency end,
      late_fee_amount = case when p_arguments ? 'lateFeeAmount' then (p_arguments->>'lateFeeAmount')::numeric else late_fee_amount end,
      interest_start_date = case when p_arguments ? 'interestStartDate' then nullif(p_arguments->>'interestStartDate', '')::date else interest_start_date end,
      updated_at = clock_timestamp()
    where id = v_account.id and user_id = v_user_id returning * into v_account;
    if v_account.installment_id is not null and p_arguments ? 'status' then
      update public.installments i set
        current_installment = least(greatest(coalesce(x.highest_paid, 0) + 1, 1), coalesce(i.installment_total, i.installment_count)),
        installment_number = least(greatest(coalesce(x.highest_paid, 0) + 1, 1), coalesce(i.installment_total, i.installment_count)),
        status = case when coalesce(x.highest_paid, 0) >= coalesce(i.installment_total, i.installment_count) then 'finished'::public.record_status else 'active'::public.record_status end,
        updated_at = clock_timestamp()
      from (
        select max(installment_number) filter (where status = 'paid') as highest_paid
        from public.accounts_payable where user_id = v_user_id and installment_id = v_account.installment_id and is_generated = true
      ) x
      where i.id = v_account.installment_id and i.user_id = v_user_id;
    end if;
    v_result := jsonb_build_object('id', v_account.id, 'title', v_account.title, 'amount', v_account.amount, 'dueDate', v_account.due_date, 'status', v_account.status, 'updatedAt', v_account.updated_at);
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (v_user_id, 'accounts_payable', v_account.id, 'update', v_before, to_jsonb(v_account), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name = 'hub_create_income' then
    v_title := btrim(coalesce(p_arguments->>'name', ''));
    v_amount := coalesce((p_arguments->>'amount')::numeric, 0);
    v_source_type := coalesce(p_arguments->>'sourceType', 'real_income');
    v_status := coalesce(p_arguments->>'status', 'expected');
    if length(v_title) < 1 or length(v_title) > 300 or v_amount <= 0 or v_amount > 1000000000
       or v_source_type not in ('real_income', 'freelance', 'salary', 'scholarship', 'other', 'personal_contribution', 'account_transfer', 'available_cash', 'loan_received', 'third_party_money')
       or v_status not in ('expected', 'received', 'partial', 'overdue', 'canceled')
       or coalesce(p_arguments->>'confidence', 'medium') not in ('low', 'medium', 'high', 'uncertain') then
      raise exception 'Dados da receita inválidos.' using errcode = '22023';
    end if;
    v_inflow_kind := case when v_source_type in ('personal_contribution', 'account_transfer', 'available_cash', 'loan_received', 'third_party_money') then 'third_party_money' else 'real_income' end;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':income:' || lower(v_title) || ':' || v_amount::text || ':' || coalesce(p_arguments->>'expectedDate', ''), 0));
    if exists (
      select 1 from public.income_sources where user_id = v_user_id and archived_at is null
        and lower(btrim(name)) = lower(v_title) and amount = v_amount
        and expected_date is not distinct from nullif(p_arguments->>'expectedDate', '')::date
        and source_type = v_source_type
    ) then raise exception 'Receita equivalente já existe.' using errcode = '23505'; end if;
    insert into public.income_sources (
      user_id, category_id, person_id, name, description, source_type, inflow_kind,
      amount, expected_date, status, received_date, received_at, confidence, notes, is_generated
    ) values (
      v_user_id, v_category_id, v_person_id, v_title, nullif(btrim(p_arguments->>'description'), ''),
      v_source_type, v_inflow_kind::public.inflow_kind, round(v_amount, 2), nullif(p_arguments->>'expectedDate', '')::date,
      v_status::public.expected_status, case when v_status = 'received' then nullif(p_arguments->>'receivedDate', '')::date else null end,
      case when v_status = 'received' then nullif(p_arguments->>'receivedDate', '')::date::timestamptz else null end,
      coalesce(p_arguments->>'confidence', 'medium'), nullif(btrim(p_arguments->>'notes'), ''), false
    ) returning * into v_income;
    if v_status = 'received' and v_income.received_date is null then raise exception 'receivedDate é obrigatória para receita recebida.' using errcode = '22023'; end if;
    v_result := jsonb_build_object('id', v_income.id, 'name', v_income.name, 'amount', v_income.amount, 'status', v_income.status, 'inflowKind', v_income.inflow_kind);
    insert into public.audit_logs (user_id, module, record_id, action, new_value, metadata)
    values (v_user_id, 'income_sources', v_income.id, 'create', to_jsonb(v_income), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name = 'hub_update_income' then
    select * into v_income from public.income_sources
    where id = (p_arguments->>'id')::uuid and user_id = v_user_id and archived_at is null for update;
    if not found then raise exception 'Receita não encontrada ou arquivada.' using errcode = '22023'; end if;
    if v_income.updated_at is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Receita alterada desde a leitura; consulte novamente.' using errcode = '40001'; end if;
    if v_income.is_generated or v_income.linked_payment_id is not null or v_income.linked_record_id is not null then
      raise exception 'Entrada vinculada deve ser alterada pelo módulo de origem.' using errcode = '22023';
    end if;
    v_before := to_jsonb(v_income);
    v_title := case when p_arguments ? 'name' then btrim(p_arguments->>'name') else v_income.name end;
    v_amount := case when p_arguments ? 'amount' then (p_arguments->>'amount')::numeric else v_income.amount end;
    v_source_type := case when p_arguments ? 'sourceType' then p_arguments->>'sourceType' else v_income.source_type end;
    v_status := case when p_arguments ? 'status' then p_arguments->>'status' else v_income.status::text end;
    if length(v_title) < 1 or v_amount <= 0 or v_source_type in ('reimbursement', 'reimbursement_received')
       or v_status not in ('expected', 'received', 'partial', 'overdue', 'canceled') then raise exception 'Dados da receita inválidos.' using errcode = '22023'; end if;
    v_inflow_kind := case when v_source_type in ('personal_contribution', 'account_transfer', 'available_cash', 'loan_received', 'third_party_money') then 'third_party_money' else 'real_income' end;
    if v_status = 'received' and nullif(coalesce(p_arguments->>'receivedDate', v_income.received_date::text), '') is null then raise exception 'receivedDate é obrigatória para receita recebida.' using errcode = '22023'; end if;
    update public.income_sources set
      name = v_title,
      description = case when p_arguments ? 'description' then nullif(btrim(p_arguments->>'description'), '') else description end,
      amount = round(v_amount, 2), expected_date = case when p_arguments ? 'expectedDate' then nullif(p_arguments->>'expectedDate', '')::date else expected_date end,
      category_id = case when p_arguments ? 'categoryId' then v_category_id else category_id end,
      person_id = case when p_arguments ? 'personId' then v_person_id else person_id end,
      source_type = v_source_type, inflow_kind = v_inflow_kind::public.inflow_kind,
      status = v_status::public.expected_status,
      received_date = case when v_status = 'received' then coalesce(nullif(p_arguments->>'receivedDate', '')::date, received_date) else null end,
      received_at = case when v_status = 'received' then coalesce(nullif(p_arguments->>'receivedDate', '')::date::timestamptz, received_at) else null end,
      confidence = case when p_arguments ? 'confidence' then p_arguments->>'confidence' else confidence end,
      notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'), '') else notes end,
      updated_at = clock_timestamp()
    where id = v_income.id and user_id = v_user_id returning * into v_income;
    v_result := jsonb_build_object('id', v_income.id, 'name', v_income.name, 'amount', v_income.amount, 'status', v_income.status, 'inflowKind', v_income.inflow_kind, 'updatedAt', v_income.updated_at);
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (v_user_id, 'income_sources', v_income.id, 'update', v_before, to_jsonb(v_income), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name in ('hub_create_transaction', 'hub_update_transaction') then
    if p_tool_name = 'hub_update_transaction' then
      select * into v_transaction from public.credit_card_transactions
      where id = (p_arguments->>'id')::uuid and user_id = v_user_id and archived_at is null for update;
      if not found then raise exception 'Lançamento não encontrado ou arquivado.' using errcode = '22023'; end if;
      if v_transaction.updated_at is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Lançamento alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      if v_transaction.installment_group_id is not null or v_transaction.is_recurring then raise exception 'Lançamentos parcelados ou recorrentes devem ser editados no fluxo específico.' using errcode = '22023'; end if;
      if (p_arguments ? 'creditCardId' and (p_arguments->>'creditCardId')::uuid is distinct from v_transaction.credit_card_id)
         or (p_arguments ? 'invoiceId' and (p_arguments->>'invoiceId')::uuid is distinct from v_transaction.invoice_id) then
        raise exception 'Troca de cartão ou fatura exige a ferramenta específica de movimentação.' using errcode = '22023';
      end if;
      v_before := to_jsonb(v_transaction);
      v_card_id := v_transaction.credit_card_id;
      v_invoice_id := v_transaction.invoice_id;
    else
      v_card_id := (p_arguments->>'creditCardId')::uuid;
      v_invoice_id := (p_arguments->>'invoiceId')::uuid;
    end if;
    select * into v_invoice from public.credit_card_invoices
    where id = v_invoice_id and user_id = v_user_id and credit_card_id = v_card_id and archived_at is null for update;
    if not found or v_invoice.status::text in ('canceled', 'cancelled') then raise exception 'Fatura incompatível, cancelada ou arquivada.' using errcode = '22023'; end if;
    if not exists (select 1 from public.credit_cards where id = v_card_id and user_id = v_user_id and is_active = true) then raise exception 'Cartão indisponível.' using errcode = '22023'; end if;
    if v_invoice.status::text = 'paid' and not v_paid_confirmed then raise exception 'Alterar fatura quitada exige confirmSensitiveChange e a frase de confirmação explícita.' using errcode = '22023'; end if;
    v_title := case when p_tool_name = 'hub_create_transaction' or p_arguments ? 'description' then btrim(p_arguments->>'description') else v_transaction.description end;
    v_amount := case when p_tool_name = 'hub_create_transaction' or p_arguments ? 'amount' then (p_arguments->>'amount')::numeric else v_transaction.amount end;
    if length(v_title) < 1 or length(v_title) > 300 or v_amount <= 0 or v_amount > 1000000000
       or coalesce(p_arguments->>'ownershipType', case when p_tool_name = 'hub_update_transaction' then v_transaction.ownership_type::text else 'personal' end) not in ('personal', 'reimbursable', 'third_party', 'shared', 'family') then
      raise exception 'Dados do lançamento inválidos.' using errcode = '22023';
    end if;
    if p_tool_name = 'hub_create_transaction' then
      perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':transaction:' || v_invoice_id::text || ':' || lower(v_title) || ':' || v_amount::text || ':' || (p_arguments->>'transactionDate'), 0));
      if exists (select 1 from public.credit_card_transactions where user_id = v_user_id and archived_at is null and invoice_id = v_invoice_id and lower(btrim(description)) = lower(v_title) and amount = v_amount and transaction_date = (p_arguments->>'transactionDate')::date) then raise exception 'Lançamento equivalente já existe nesta fatura.' using errcode = '23505'; end if;
      insert into public.credit_card_transactions (
        user_id, credit_card_id, invoice_id, category_id, person_id, description, amount,
        transaction_date, ownership_type, is_reimbursable, reimbursement_status, notes
      ) values (
        v_user_id, v_card_id, v_invoice_id, v_category_id, v_person_id, v_title, round(v_amount, 2),
        (p_arguments->>'transactionDate')::date,
        coalesce(p_arguments->>'ownershipType', 'personal')::public.ownership_type,
        coalesce((p_arguments->>'isReimbursable')::boolean, false),
        case when coalesce((p_arguments->>'isReimbursable')::boolean, false) then 'pending' else 'not_applicable' end,
        nullif(btrim(p_arguments->>'notes'), '')
      ) returning * into v_transaction;
      if coalesce((p_arguments->>'createReimbursement')::boolean, false) then
        if v_person_id is null then raise exception 'personId é obrigatória para criar reembolso do lançamento.' using errcode = '22023'; end if;
        insert into public.reimbursements (
          user_id, person_id, category_id, source_type, source_id,
          credit_card_transaction_id, credit_card_invoice_id, description,
          expected_amount, received_amount, expected_date, status, notes
        ) values (
          v_user_id, v_person_id, v_category_id, 'credit_card_transaction', v_transaction.id,
          v_transaction.id, v_invoice_id, v_title, round(v_amount, 2), 0,
          coalesce(nullif(p_arguments->>'reimbursementExpectedDate', '')::date, v_transaction.transaction_date),
          'expected'::public.expected_status, 'Criado pelo MCP junto ao lançamento de cartão.'
        ) returning * into v_linked_reimbursement;
        update public.credit_card_transactions set reimbursement_id = v_linked_reimbursement.id, is_reimbursable = true, reimbursement_status = 'pending', updated_at = clock_timestamp() where id = v_transaction.id returning * into v_transaction;
        insert into public.audit_logs (user_id, module, record_id, action, new_value, metadata)
        values (v_user_id, 'reimbursements', v_linked_reimbursement.id, 'create', to_jsonb(v_linked_reimbursement), jsonb_build_object('source', 'mcp', 'transactionId', v_transaction.id, 'idempotencyKey', p_idempotency_key));
        v_reimbursement_id := v_linked_reimbursement.id;
      end if;
    else
      if v_transaction.reimbursement_id is not null and (
        (p_arguments ? 'amount' and v_amount is distinct from v_transaction.amount)
        or (p_arguments ? 'description' and v_title is distinct from v_transaction.description)
        or (p_arguments ? 'categoryId' and v_category_id is distinct from v_transaction.category_id)
        or (p_arguments ? 'personId' and v_person_id is distinct from v_transaction.person_id)
      ) then
        if not coalesce((p_arguments->>'syncLinkedReimbursement')::boolean, false) then raise exception 'O lançamento possui reembolso vinculado; confirme syncLinkedReimbursement para manter os valores sincronizados.' using errcode = '22023'; end if;
        select * into v_linked_reimbursement from public.reimbursements where id = v_transaction.reimbursement_id and user_id = v_user_id and archived_at is null for update;
        if not found or v_linked_reimbursement.received_amount > v_amount then raise exception 'O reembolso vinculado não pode ser sincronizado com esse valor.' using errcode = '22023'; end if;
      end if;
      update public.credit_card_transactions set
        description = v_title, amount = round(v_amount, 2),
        transaction_date = case when p_arguments ? 'transactionDate' then (p_arguments->>'transactionDate')::date else transaction_date end,
        category_id = case when p_arguments ? 'categoryId' then v_category_id else category_id end,
        person_id = case when p_arguments ? 'personId' then v_person_id else person_id end,
        ownership_type = case when p_arguments ? 'ownershipType' then (p_arguments->>'ownershipType')::public.ownership_type else ownership_type end,
        is_reimbursable = case when p_arguments ? 'isReimbursable' then (p_arguments->>'isReimbursable')::boolean else is_reimbursable end,
        reimbursement_status = case when p_arguments ? 'isReimbursable' then case when (p_arguments->>'isReimbursable')::boolean then 'pending' else 'not_applicable' end else reimbursement_status end,
        notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'), '') else notes end,
        updated_at = clock_timestamp()
      where id = v_transaction.id and user_id = v_user_id returning * into v_transaction;
      if v_linked_reimbursement.id is not null then
        update public.reimbursements set description = v_transaction.description, expected_amount = v_transaction.amount,
          category_id = v_transaction.category_id, person_id = coalesce(v_transaction.person_id, person_id), updated_at = clock_timestamp()
        where id = v_linked_reimbursement.id and user_id = v_user_id returning * into v_linked_reimbursement;
      end if;
    end if;
    v_invoice_totals := public.mcp_recalculate_invoice_totals_v1(v_user_id, v_invoice_id, v_paid_confirmed);
    v_result := jsonb_build_object('id', v_transaction.id, 'description', v_transaction.description, 'amount', v_transaction.amount, 'transactionDate', v_transaction.transaction_date, 'invoiceId', v_invoice_id, 'reimbursementId', coalesce(v_reimbursement_id, v_transaction.reimbursement_id), 'invoiceTotals', v_invoice_totals, 'updatedAt', v_transaction.updated_at);
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (v_user_id, 'credit_card_transactions', v_transaction.id, case when p_tool_name = 'hub_create_transaction' then 'create' else 'update' end, case when p_tool_name = 'hub_update_transaction' then v_before else null end, to_jsonb(v_transaction), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key, 'paidInvoiceConfirmed', v_paid_confirmed));

  elsif p_tool_name = 'hub_create_planned_purchase' then
    v_title := btrim(coalesce(p_arguments->>'title', ''));
    v_amount := coalesce((p_arguments->>'estimatedAmount')::numeric, 0);
    if length(v_title) < 1 or length(v_title) > 300 or v_amount < 0 or v_amount > 1000000000
       or coalesce(p_arguments->>'decisionStatus', 'considering') not in ('considering', 'approved', 'delayed', 'canceled', 'purchased')
       or coalesce(p_arguments->>'riskLevel', 'medium') not in ('low', 'medium', 'high', 'critical')
       or coalesce(p_arguments->>'paymentMethod', 'unknown') not in ('cash', 'credit_card', 'installment', 'unknown') then raise exception 'Dados da compra planejada inválidos.' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':purchase:' || lower(v_title) || ':' || coalesce(v_category_id::text, ''), 0));
    if exists (select 1 from public.planned_purchases where user_id = v_user_id and archived_at is null and lower(btrim(title)) = lower(v_title) and category_id is not distinct from v_category_id) then raise exception 'Compra com mesmo título e categoria já existe.' using errcode = '23505'; end if;
    insert into public.planned_purchases (
      user_id, title, description, estimated_amount, paid_amount, target_date, purchase_date,
      category_id, project, payment_method, installment_count, decision_status, risk_level, notes, created_by
    ) values (
      v_user_id, v_title, nullif(btrim(p_arguments->>'description'), ''), round(v_amount, 2), coalesce((p_arguments->>'paidAmount')::numeric, 0),
      nullif(p_arguments->>'targetDate', '')::date, nullif(p_arguments->>'purchaseDate', '')::date,
      v_category_id, nullif(btrim(p_arguments->>'project'), ''), coalesce(p_arguments->>'paymentMethod', 'unknown')::public.payment_method,
      nullif(p_arguments->>'installmentCount', '')::integer, coalesce(p_arguments->>'decisionStatus', 'considering'),
      coalesce(p_arguments->>'riskLevel', 'medium')::public.risk_level, nullif(btrim(p_arguments->>'notes'), ''), v_user_id
    ) returning * into v_purchase;
    v_result := jsonb_build_object('id', v_purchase.id, 'title', v_purchase.title, 'estimatedAmount', v_purchase.estimated_amount, 'paidAmount', v_purchase.paid_amount, 'status', v_purchase.decision_status);
    insert into public.audit_logs (user_id, module, record_id, action, new_value, metadata)
    values (v_user_id, 'planned_purchases', v_purchase.id, 'create', to_jsonb(v_purchase), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name = 'hub_update_planned_purchase' then
    select * into v_purchase from public.planned_purchases where id = (p_arguments->>'id')::uuid and user_id = v_user_id and archived_at is null for update;
    if not found then raise exception 'Compra planejada não encontrada ou arquivada.' using errcode = '22023'; end if;
    if v_purchase.updated_at is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Compra alterada desde a leitura; consulte novamente.' using errcode = '40001'; end if;
    v_before := to_jsonb(v_purchase);
    v_title := case when p_arguments ? 'title' then btrim(p_arguments->>'title') else v_purchase.title end;
    v_amount := case when p_arguments ? 'estimatedAmount' then (p_arguments->>'estimatedAmount')::numeric else v_purchase.estimated_amount end;
    if length(v_title) < 1 or v_amount < 0 then raise exception 'Dados da compra planejada inválidos.' using errcode = '22023'; end if;
    update public.planned_purchases set
      title = v_title, description = case when p_arguments ? 'description' then nullif(btrim(p_arguments->>'description'), '') else description end,
      estimated_amount = round(v_amount, 2), paid_amount = case when p_arguments ? 'paidAmount' then round((p_arguments->>'paidAmount')::numeric, 2) else paid_amount end,
      target_date = case when p_arguments ? 'targetDate' then nullif(p_arguments->>'targetDate', '')::date else target_date end,
      purchase_date = case when p_arguments ? 'purchaseDate' then nullif(p_arguments->>'purchaseDate', '')::date else purchase_date end,
      category_id = case when p_arguments ? 'categoryId' then v_category_id else category_id end,
      project = case when p_arguments ? 'project' then nullif(btrim(p_arguments->>'project'), '') else project end,
      payment_method = case when p_arguments ? 'paymentMethod' then (p_arguments->>'paymentMethod')::public.payment_method else payment_method end,
      installment_count = case when p_arguments ? 'installmentCount' then nullif(p_arguments->>'installmentCount', '')::integer else installment_count end,
      decision_status = case when p_arguments ? 'decisionStatus' then p_arguments->>'decisionStatus' else decision_status end,
      risk_level = case when p_arguments ? 'riskLevel' then (p_arguments->>'riskLevel')::public.risk_level else risk_level end,
      notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'), '') else notes end,
      updated_at = clock_timestamp()
    where id = v_purchase.id and user_id = v_user_id returning * into v_purchase;
    v_result := jsonb_build_object('id', v_purchase.id, 'title', v_purchase.title, 'estimatedAmount', v_purchase.estimated_amount, 'paidAmount', v_purchase.paid_amount, 'status', v_purchase.decision_status, 'updatedAt', v_purchase.updated_at);
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (v_user_id, 'planned_purchases', v_purchase.id, 'update', v_before, to_jsonb(v_purchase), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name in ('hub_create_goal', 'hub_update_goal') then
    if p_tool_name = 'hub_update_goal' then
      select * into v_goal from public.goals where id = (p_arguments->>'id')::uuid and user_id = v_user_id and archived_at is null for update;
      if not found then raise exception 'Meta não encontrada ou arquivada.' using errcode = '22023'; end if;
      if v_goal.updated_at is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Meta alterada desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      v_before := to_jsonb(v_goal);
    end if;
    v_title := case when p_tool_name = 'hub_create_goal' or p_arguments ? 'name' then btrim(p_arguments->>'name') else v_goal.name end;
    v_status := coalesce(p_arguments->>'status', case when p_tool_name = 'hub_update_goal' then v_goal.status else 'active' end);
    v_source_type := coalesce(p_arguments->>'goalType', case when p_tool_name = 'hub_update_goal' then v_goal.goal_type else 'personal' end);
    if length(v_title) < 1 or length(v_title) > 300 or v_status not in ('active', 'paused', 'completed', 'canceled')
       or v_source_type not in ('personal', 'professional', 'course', 'education', 'project')
       or coalesce(p_arguments->>'goalKind', case when p_tool_name = 'hub_update_goal' then v_goal.goal_kind else 'qualitative' end) not in ('qualitative', 'financial', 'numeric') then raise exception 'Dados da meta inválidos.' using errcode = '22023'; end if;
    if p_tool_name = 'hub_create_goal' then
      perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':goal:' || lower(v_title) || ':' || v_source_type || ':' || coalesce(p_arguments->>'targetDate', ''), 0));
      if exists (select 1 from public.goals where user_id = v_user_id and archived_at is null and lower(btrim(name)) = lower(v_title) and goal_type = v_source_type and target_date is not distinct from nullif(p_arguments->>'targetDate', '')::date) then raise exception 'Meta equivalente já existe.' using errcode = '23505'; end if;
      insert into public.goals (
        user_id, name, goal_type, goal_category, goal_kind, category_id,
        target_amount, current_amount, start_date, target_date, monthly_contribution,
        urgency_level, status, notes, created_by
      ) values (
        v_user_id, v_title, v_source_type, v_source_type,
        coalesce(p_arguments->>'goalKind', 'qualitative'), v_category_id,
        nullif(p_arguments->>'targetAmount', '')::numeric, nullif(p_arguments->>'currentAmount', '')::numeric,
        nullif(p_arguments->>'startDate', '')::date, nullif(p_arguments->>'targetDate', '')::date,
        nullif(p_arguments->>'monthlyContribution', '')::numeric,
        case when nullif(p_arguments->>'targetDate', '') is null then 'no_target' when (p_arguments->>'targetDate')::date <= current_date + 7 then 'urgent' when (p_arguments->>'targetDate')::date <= current_date + 30 then 'attention' else 'comfortable' end,
        v_status, nullif(btrim(p_arguments->>'notes'), ''), v_user_id
      ) returning * into v_goal;
    else
      update public.goals set
        name = v_title, goal_type = v_source_type, goal_category = v_source_type,
        goal_kind = case when p_arguments ? 'goalKind' then p_arguments->>'goalKind' else goal_kind end,
        category_id = case when p_arguments ? 'categoryId' then v_category_id else category_id end,
        target_amount = case when p_arguments ? 'targetAmount' then nullif(p_arguments->>'targetAmount', '')::numeric else target_amount end,
        current_amount = case when p_arguments ? 'currentAmount' then nullif(p_arguments->>'currentAmount', '')::numeric else current_amount end,
        start_date = case when p_arguments ? 'startDate' then nullif(p_arguments->>'startDate', '')::date else start_date end,
        target_date = case when p_arguments ? 'targetDate' then nullif(p_arguments->>'targetDate', '')::date else target_date end,
        monthly_contribution = case when p_arguments ? 'monthlyContribution' then nullif(p_arguments->>'monthlyContribution', '')::numeric else monthly_contribution end,
        urgency_level = case when p_arguments ? 'targetDate' then case when nullif(p_arguments->>'targetDate', '') is null then 'no_target' when (p_arguments->>'targetDate')::date <= current_date + 7 then 'urgent' when (p_arguments->>'targetDate')::date <= current_date + 30 then 'attention' else 'comfortable' end else urgency_level end,
        status = v_status, notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'), '') else notes end,
        updated_at = clock_timestamp()
      where id = v_goal.id and user_id = v_user_id returning * into v_goal;
    end if;
    v_result := jsonb_build_object('id', v_goal.id, 'name', v_goal.name, 'status', v_goal.status, 'goalKind', v_goal.goal_kind, 'targetAmount', v_goal.target_amount, 'currentAmount', v_goal.current_amount, 'targetDate', v_goal.target_date, 'updatedAt', v_goal.updated_at);
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (v_user_id, 'goals', v_goal.id, case when p_tool_name = 'hub_create_goal' then 'create' else 'update' end, case when p_tool_name = 'hub_update_goal' then v_before else null end, to_jsonb(v_goal), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name = 'hub_create_reimbursement' then
    v_title := btrim(coalesce(p_arguments->>'description', ''));
    v_amount := coalesce((p_arguments->>'expectedAmount')::numeric, 0);
    if v_person_id is null or length(v_title) < 1 or length(v_title) > 300 or v_amount <= 0 or v_amount > 1000000000 or nullif(p_arguments->>'expectedDate', '') is null then raise exception 'Dados do reembolso inválidos.' using errcode = '22023'; end if;
    if nullif(p_arguments->>'creditCardTransactionId', '') is not null and nullif(p_arguments->>'accountPayableId', '') is not null then raise exception 'Vincule apenas uma origem financeira ao reembolso.' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':reimbursement:' || v_person_id::text || ':' || lower(v_title) || ':' || v_amount::text || ':' || (p_arguments->>'expectedDate'), 0));
    if exists (select 1 from public.reimbursements where user_id = v_user_id and archived_at is null and person_id = v_person_id and lower(btrim(coalesce(description, ''))) = lower(v_title) and expected_amount = v_amount and expected_date = (p_arguments->>'expectedDate')::date) then raise exception 'Reembolso equivalente já existe.' using errcode = '23505'; end if;
    if nullif(p_arguments->>'creditCardTransactionId', '') is not null then
      v_link_id := (p_arguments->>'creditCardTransactionId')::uuid;
      select * into v_transaction from public.credit_card_transactions where id = v_link_id and user_id = v_user_id and archived_at is null for update;
      if not found or v_transaction.reimbursement_id is not null then raise exception 'Lançamento indisponível ou já vinculado a reembolso.' using errcode = '22023'; end if;
      v_source_type := 'credit_card_transaction'; v_invoice_id := v_transaction.invoice_id;
    elsif nullif(p_arguments->>'accountPayableId', '') is not null then
      v_link_id := (p_arguments->>'accountPayableId')::uuid;
      select * into v_account from public.accounts_payable where id = v_link_id and user_id = v_user_id and archived_at is null for update;
      if not found or v_account.reimbursement_id is not null then raise exception 'Conta indisponível ou já vinculada a reembolso.' using errcode = '22023'; end if;
      v_source_type := 'account_payable';
    else v_source_type := 'manual'; v_link_id := null; end if;
    insert into public.reimbursements (
      user_id, person_id, category_id, source_type, source_id, credit_card_transaction_id,
      account_payable_id, credit_card_invoice_id, description, expected_amount,
      received_amount, expected_date, status, notes, late_interest_enabled,
      late_interest_rate, late_interest_frequency, late_fee_amount, interest_start_date
    ) values (
      v_user_id, v_person_id, v_category_id, v_source_type, v_link_id,
      case when v_source_type = 'credit_card_transaction' then v_link_id else null end,
      case when v_source_type = 'account_payable' then v_link_id else null end,
      v_invoice_id, v_title, round(v_amount, 2), 0, (p_arguments->>'expectedDate')::date,
      'expected'::public.expected_status, nullif(btrim(p_arguments->>'notes'), ''),
      coalesce((p_arguments->>'lateInterestEnabled')::boolean, false),
      case when coalesce((p_arguments->>'lateInterestEnabled')::boolean, false) then coalesce((p_arguments->>'lateInterestRate')::numeric, 0) else 0 end,
      coalesce(p_arguments->>'lateInterestFrequency', 'monthly'),
      case when coalesce((p_arguments->>'lateInterestEnabled')::boolean, false) then coalesce((p_arguments->>'lateFeeAmount')::numeric, 0) else 0 end,
      case when coalesce((p_arguments->>'lateInterestEnabled')::boolean, false) then nullif(p_arguments->>'interestStartDate', '')::date else null end
    ) returning * into v_reimbursement;
    if v_source_type = 'credit_card_transaction' then update public.credit_card_transactions set reimbursement_id = v_reimbursement.id, is_reimbursable = true, reimbursement_status = 'pending', updated_at = clock_timestamp() where id = v_link_id; end if;
    if v_source_type = 'account_payable' then update public.accounts_payable set reimbursement_id = v_reimbursement.id, updated_at = clock_timestamp() where id = v_link_id; end if;
    v_result := jsonb_build_object('id', v_reimbursement.id, 'description', v_reimbursement.description, 'expectedAmount', v_reimbursement.expected_amount, 'receivedAmount', v_reimbursement.received_amount, 'status', v_reimbursement.status, 'sourceType', v_reimbursement.source_type, 'sourceId', v_reimbursement.source_id);
    insert into public.audit_logs (user_id, module, record_id, action, new_value, metadata)
    values (v_user_id, 'reimbursements', v_reimbursement.id, 'create', to_jsonb(v_reimbursement), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name = 'hub_update_reimbursement' then
    select * into v_reimbursement from public.reimbursements where id = (p_arguments->>'id')::uuid and user_id = v_user_id and archived_at is null for update;
    if not found then raise exception 'Reembolso não encontrado ou arquivado.' using errcode = '22023'; end if;
    if v_reimbursement.updated_at is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Reembolso alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
    if v_reimbursement.status::text in ('renegotiated', 'carried_over', 'cancelled', 'canceled', 'forgiven') then raise exception 'Este reembolso exige o fluxo especializado do Hub.' using errcode = '22023'; end if;
    v_before := to_jsonb(v_reimbursement);
    v_title := case when p_arguments ? 'description' then btrim(p_arguments->>'description') else coalesce(v_reimbursement.description, '') end;
    v_amount := case when p_arguments ? 'expectedAmount' then (p_arguments->>'expectedAmount')::numeric else v_reimbursement.expected_amount end;
    v_status := case when p_arguments ? 'status' then p_arguments->>'status' else v_reimbursement.status::text end;
    if length(v_title) < 1 or v_amount <= 0 or v_amount < v_reimbursement.received_amount or v_status not in ('expected', 'partial', 'received', 'late', 'overdue') then raise exception 'Dados do reembolso inválidos.' using errcode = '22023'; end if;
    if v_status in ('partial', 'received') and not (p_arguments ? 'receivedAmount') then v_status := v_reimbursement.status::text; end if;
    if p_arguments ? 'receivedAmount' then raise exception 'Use hub_register_reimbursement_receipt para alterar o valor recebido.' using errcode = '22023'; end if;
    if (v_reimbursement.credit_card_transaction_id is not null or v_reimbursement.account_payable_id is not null)
       and p_arguments ? 'expectedAmount' and v_amount is distinct from v_reimbursement.expected_amount then
      if not coalesce((p_arguments->>'syncLinkedOrigin')::boolean, false) then raise exception 'O reembolso possui origem vinculada; confirme syncLinkedOrigin para sincronizar o valor.' using errcode = '22023'; end if;
      if v_reimbursement.credit_card_transaction_id is not null then
        select * into v_transaction from public.credit_card_transactions where id = v_reimbursement.credit_card_transaction_id and user_id = v_user_id and archived_at is null for update;
        if not found or v_transaction.installment_group_id is not null or v_transaction.is_recurring then raise exception 'Origem vinculada exige edição especializada.' using errcode = '22023'; end if;
        select * into v_invoice from public.credit_card_invoices where id = v_transaction.invoice_id and user_id = v_user_id and archived_at is null for update;
        if v_invoice.status::text = 'paid' and not v_paid_confirmed then raise exception 'Sincronizar origem em fatura quitada exige confirmação explícita.' using errcode = '22023'; end if;
        update public.credit_card_transactions set amount = round(v_amount, 2), updated_at = clock_timestamp() where id = v_transaction.id;
        v_invoice_totals := public.mcp_recalculate_invoice_totals_v1(v_user_id, v_transaction.invoice_id, v_paid_confirmed);
      elsif v_reimbursement.account_payable_id is not null then
        select * into v_account from public.accounts_payable where id = v_reimbursement.account_payable_id and user_id = v_user_id and archived_at is null for update;
        if not found or v_account.is_generated or v_account.installment_id is not null then raise exception 'Origem vinculada exige edição especializada.' using errcode = '22023'; end if;
        update public.accounts_payable set amount = round(v_amount, 2), updated_at = clock_timestamp() where id = v_account.id;
      end if;
    end if;
    update public.reimbursements set
      description = v_title, expected_amount = round(v_amount, 2),
      expected_date = case when p_arguments ? 'expectedDate' then nullif(p_arguments->>'expectedDate', '')::date else expected_date end,
      category_id = case when p_arguments ? 'categoryId' then v_category_id else category_id end,
      person_id = case when p_arguments ? 'personId' then v_person_id else person_id end,
      status = v_status::public.expected_status,
      notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'), '') else notes end,
      late_interest_enabled = case when p_arguments ? 'lateInterestEnabled' then (p_arguments->>'lateInterestEnabled')::boolean else late_interest_enabled end,
      late_interest_rate = case when p_arguments ? 'lateInterestRate' then (p_arguments->>'lateInterestRate')::numeric else late_interest_rate end,
      late_interest_frequency = case when p_arguments ? 'lateInterestFrequency' then p_arguments->>'lateInterestFrequency' else late_interest_frequency end,
      late_fee_amount = case when p_arguments ? 'lateFeeAmount' then (p_arguments->>'lateFeeAmount')::numeric else late_fee_amount end,
      interest_start_date = case when p_arguments ? 'interestStartDate' then nullif(p_arguments->>'interestStartDate', '')::date else interest_start_date end,
      updated_at = clock_timestamp()
    where id = v_reimbursement.id and user_id = v_user_id returning * into v_reimbursement;
    v_result := jsonb_build_object('id', v_reimbursement.id, 'description', v_reimbursement.description, 'expectedAmount', v_reimbursement.expected_amount, 'receivedAmount', v_reimbursement.received_amount, 'status', v_reimbursement.status, 'sourceType', v_reimbursement.source_type, 'sourceId', v_reimbursement.source_id, 'invoiceTotals', v_invoice_totals, 'updatedAt', v_reimbursement.updated_at);
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (v_user_id, 'reimbursements', v_reimbursement.id, 'update', v_before, to_jsonb(v_reimbursement), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key, 'linkedOriginSynchronized', coalesce((p_arguments->>'syncLinkedOrigin')::boolean, false)));

  elsif p_tool_name = 'hub_register_reimbursement_receipt' then
    select * into v_reimbursement from public.reimbursements where id = (p_arguments->>'id')::uuid and user_id = v_user_id and archived_at is null for update;
    if not found then raise exception 'Reembolso não encontrado ou arquivado.' using errcode = '22023'; end if;
    if v_reimbursement.updated_at is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Reembolso alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
    if v_reimbursement.status::text in ('received', 'renegotiated', 'carried_over', 'cancelled', 'canceled', 'forgiven') then raise exception 'Este reembolso não aceita recebimento direto.' using errcode = '22023'; end if;
    v_amount := coalesce((p_arguments->>'amount')::numeric, 0);
    v_received := v_reimbursement.received_amount + v_amount;
    if v_amount <= 0 or v_received > v_reimbursement.expected_amount then raise exception 'Valor recebido inválido ou maior que o saldo em aberto.' using errcode = '22023'; end if;
    if nullif(p_arguments->>'receivedDate', '') is null then raise exception 'receivedDate é obrigatória.' using errcode = '22023'; end if;
    insert into public.income_sources (
      user_id, person_id, name, description, source_type, inflow_kind, amount,
      expected_date, received_date, received_at, status, confidence, notes,
      linked_payment_type, linked_payment_id, linked_module, linked_record_id,
      is_generated, linked_reimbursement_id
    ) values (
      v_user_id, v_reimbursement.person_id,
      'Recebimento - ' || coalesce(nullif(btrim(v_reimbursement.description), ''), 'Reembolso'),
      'Entrada vinculada ao recebimento de reembolso. Não é renda livre.',
      'reimbursement_received', 'reimbursement'::public.inflow_kind, round(v_amount, 2),
      (p_arguments->>'receivedDate')::date, (p_arguments->>'receivedDate')::date,
      (p_arguments->>'receivedDate')::date::timestamptz, 'received'::public.expected_status, 'high',
      concat_ws(E'\n', 'Forma de recebimento: ' || coalesce(nullif(btrim(p_arguments->>'method'), ''), 'não informada'), nullif(btrim(p_arguments->>'notes'), '')),
      'reimbursement_receipt', v_reimbursement.id, 'reimbursements', v_reimbursement.id,
      true, v_reimbursement.id
    ) returning * into v_income;
    v_before := to_jsonb(v_reimbursement);
    update public.reimbursements set
      received_amount = round(v_received, 2), received_date = (p_arguments->>'receivedDate')::date,
      received_at = (p_arguments->>'receivedDate')::date::timestamptz,
      status = case when v_received >= expected_amount then 'received'::public.expected_status else 'partial'::public.expected_status end,
      income_source_id = v_income.id, updated_at = clock_timestamp()
    where id = v_reimbursement.id and user_id = v_user_id returning * into v_reimbursement;
    if v_reimbursement.credit_card_transaction_id is not null then
      update public.credit_card_transactions set reimbursement_status = case when v_reimbursement.status::text = 'received' then 'received' else 'partial' end, updated_at = clock_timestamp()
      where id = v_reimbursement.credit_card_transaction_id and user_id = v_user_id;
    end if;
    v_result := jsonb_build_object('id', v_reimbursement.id, 'incomeSourceId', v_income.id, 'receivedNow', round(v_amount, 2), 'receivedAmount', v_reimbursement.received_amount, 'openAmount', round(v_reimbursement.expected_amount - v_reimbursement.received_amount, 2), 'status', v_reimbursement.status, 'updatedAt', v_reimbursement.updated_at);
    insert into public.audit_logs (user_id, module, record_id, action, new_value, metadata)
    values (v_user_id, 'income_sources', v_income.id, 'linked_entry_created', to_jsonb(v_income), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key, 'reimbursementId', v_reimbursement.id));
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (v_user_id, 'reimbursements', v_reimbursement.id, 'reimbursement_received', v_before, to_jsonb(v_reimbursement), jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key, 'incomeSourceId', v_income.id));
  end if;

  v_result := coalesce(v_result, '{}'::jsonb) || jsonb_build_object('idempotentReplay', false, 'tool', p_tool_name);
  insert into public.mcp_write_operations (user_id, idempotency_key, tool_name, arguments, result)
  values (v_user_id, p_idempotency_key, p_tool_name, p_arguments, v_result)
  returning id into v_link_id;
  v_result := v_result || jsonb_build_object('operationId', v_link_id);
  update public.mcp_write_operations set result = v_result where id = v_link_id and user_id = v_user_id;
  return v_result;
end;
$$;

revoke all on function public.mcp_execute_direct_write_v1(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_execute_direct_write_v1(uuid, text, text, jsonb) to service_role;

comment on function public.mcp_execute_direct_write_v1(uuid, text, text, jsonb) is
  'Atomic, idempotent Hub MCP writes for the OAuth-authenticated user. Callable only by the server service role.';

commit;
