-- Incremental MCP coverage for operational Hub modules.
-- This function is private to the application service role. It never grants
-- authenticated or anon users a generic way to mutate application tables.

begin;

create or replace function public.mcp_require_owned_reference_v1(
  p_user_id uuid,
  p_table text,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_exists boolean := false;
begin
  if p_id is null then return; end if;
  case p_table
    when 'people' then select exists(select 1 from public.people where id = p_id and user_id = p_user_id) into v_exists;
    when 'categories' then select exists(select 1 from public.categories where id = p_id and user_id = p_user_id) into v_exists;
    when 'credit_cards' then select exists(select 1 from public.credit_cards where id = p_id and user_id = p_user_id) into v_exists;
    when 'credit_card_invoices' then select exists(select 1 from public.credit_card_invoices where id = p_id and user_id = p_user_id) into v_exists;
    when 'credit_card_transactions' then select exists(select 1 from public.credit_card_transactions where id = p_id and user_id = p_user_id) into v_exists;
    when 'accounts_payable' then select exists(select 1 from public.accounts_payable where id = p_id and user_id = p_user_id) into v_exists;
    when 'installments' then select exists(select 1 from public.installments where id = p_id and user_id = p_user_id) into v_exists;
    when 'reimbursements' then select exists(select 1 from public.reimbursements where id = p_id and user_id = p_user_id) into v_exists;
    when 'income_sources' then select exists(select 1 from public.income_sources where id = p_id and user_id = p_user_id) into v_exists;
    when 'planned_purchases' then select exists(select 1 from public.planned_purchases where id = p_id and user_id = p_user_id) into v_exists;
    when 'goals' then select exists(select 1 from public.goals where id = p_id and user_id = p_user_id) into v_exists;
    else raise exception 'Referência MCP não permitida.' using errcode = '42501';
  end case;
  if not v_exists then raise exception 'Referência indisponível para este usuário.' using errcode = '22023'; end if;
end;
$$;

revoke all on function public.mcp_require_owned_reference_v1(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.mcp_require_owned_reference_v1(uuid, text, uuid) to service_role;

create or replace function public.mcp_execute_direct_write_v2(
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
  v_existing public.mcp_write_operations%rowtype;
  v_result jsonb;
  v_operation_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_id uuid;
  v_card_id uuid;
  v_category_id uuid;
  v_person_id uuid;
  v_invoice_id uuid;
  v_plan_id uuid;
  v_source_id uuid;
  v_table text;
  v_module text;
  v_name text;
  v_amount numeric;
  v_status text;
  v_now timestamptz := clock_timestamp();
  v_member jsonb;
  v_participant jsonb;
  v_share_total numeric := 0;
  v_next_installment integer;
  v_total_installments integer;
  v_existing_account uuid;
  v_confirmation text := coalesce(p_arguments->>'confirmationText', '');
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Usuário MCP inválido.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' then
    raise exception 'idempotencyKey deve conter de 8 a 128 caracteres seguros.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_arguments) <> 'object' then
    raise exception 'Argumentos da escrita devem ser um objeto JSON.' using errcode = '22023';
  end if;

  if nullif(p_arguments->>'categoryId', '') is not null then
    perform public.mcp_require_owned_reference_v1(p_user_id, 'categories', (p_arguments->>'categoryId')::uuid);
  end if;
  if nullif(p_arguments->>'personId', '') is not null then
    perform public.mcp_require_owned_reference_v1(p_user_id, 'people', (p_arguments->>'personId')::uuid);
  end if;
  if nullif(p_arguments->>'creditCardId', '') is not null then
    perform public.mcp_require_owned_reference_v1(p_user_id, 'credit_cards', (p_arguments->>'creditCardId')::uuid);
  end if;
  if nullif(p_arguments->>'invoiceId', '') is not null then
    perform public.mcp_require_owned_reference_v1(p_user_id, 'credit_card_invoices', (p_arguments->>'invoiceId')::uuid);
  end if;
  if nullif(p_arguments->>'creditCardTransactionId', '') is not null then
    perform public.mcp_require_owned_reference_v1(p_user_id, 'credit_card_transactions', (p_arguments->>'creditCardTransactionId')::uuid);
  end if;

  -- Keep the already homologated financial writer as the source of truth for
  -- legacy direct-write tools while new module tools use the branches below.
  if p_tool_name in (
    'hub_create_income', 'hub_update_income',
    'hub_create_transaction', 'hub_update_transaction',
    'hub_create_planned_purchase', 'hub_update_planned_purchase',
    'hub_create_goal', 'hub_update_goal',
    'hub_create_reimbursement', 'hub_update_reimbursement',
    'hub_register_reimbursement_receipt'
  ) then
    return public.mcp_execute_direct_write_v1(p_user_id, p_idempotency_key, p_tool_name, p_arguments);
  end if;

  if p_tool_name not in (
    'hub_create_account_detailed', 'hub_update_account_detailed', 'hub_generate_account_recurrences',
    'hub_create_person', 'hub_update_person', 'hub_deactivate_person',
    'hub_create_category', 'hub_update_category', 'hub_deactivate_category',
    'hub_create_card', 'hub_update_card', 'hub_deactivate_card',
    'hub_create_subscription', 'hub_update_subscription', 'hub_archive_subscription', 'hub_restore_subscription', 'hub_import_subscriptions',
    'hub_create_invoice', 'hub_update_invoice',
    'hub_create_installment', 'hub_update_installment', 'hub_generate_installment_accounts', 'hub_register_installment_payment',
    'hub_create_payment_plan', 'hub_update_payment_plan', 'hub_activate_payment_plan',
    'hub_create_payment_plan_item', 'hub_update_payment_plan_item', 'hub_remove_payment_plan_item',
    'hub_create_place', 'hub_update_place',
    'hub_create_note', 'hub_update_note', 'hub_delete_note',
    'hub_archive_record', 'hub_restore_record', 'hub_update_profile_settings'
  ) then
    raise exception 'Ferramenta MCP não autorizada.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_idempotency_key, 0));
  select * into v_existing
  from public.mcp_write_operations
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.tool_name is distinct from p_tool_name or v_existing.arguments is distinct from p_arguments then
      raise exception 'idempotencyKey já foi usada com outra operação ou outros argumentos.' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('idempotentReplay', true, 'operationId', v_existing.id);
  end if;

  if p_tool_name in ('hub_create_account_detailed', 'hub_update_account_detailed', 'hub_generate_account_recurrences') then
    if p_tool_name = 'hub_create_account_detailed' then
      v_name := btrim(coalesce(p_arguments->>'title', ''));
      v_amount := coalesce((p_arguments->>'amount')::numeric, 0);
      if v_name = '' or v_amount <= 0 or nullif(p_arguments->>'dueDate', '') is null then raise exception 'Dados da conta inválidos.' using errcode = '22023'; end if;
      v_category_id := nullif(p_arguments->>'categoryId','')::uuid;
      if v_category_id is null and nullif(btrim(p_arguments->>'categoryName'),'') is not null then
        select min(id::text)::uuid, count(*) into v_category_id, v_next_installment from public.categories where user_id = p_user_id and is_active and lower(name) = lower(btrim(p_arguments->>'categoryName'));
        if v_next_installment <> 1 then raise exception 'Categoria por nome não encontrada de forma única; use hub_search_categories.' using errcode = '22023'; end if;
      end if;
      v_person_id := nullif(p_arguments->>'personId','')::uuid;
      if v_person_id is null and nullif(btrim(p_arguments->>'personName'),'') is not null then
        select min(id::text)::uuid, count(*) into v_person_id, v_next_installment from public.people where user_id = p_user_id and is_active and lower(name) = lower(btrim(p_arguments->>'personName'));
        if v_next_installment <> 1 then raise exception 'Pessoa por nome não encontrada de forma única; use hub_search_people.' using errcode = '22023'; end if;
      end if;
      if exists (select 1 from public.accounts_payable where user_id=p_user_id and archived_at is null and source_type='manual' and lower(title)=lower(v_name) and amount=v_amount and due_date=(p_arguments->>'dueDate')::date) then raise exception 'Já existe conta manual equivalente.' using errcode = '23505'; end if;
      insert into public.accounts_payable (user_id,category_id,person_id,title,description,amount,due_date,status,priority,risk_level,paid_at,payment_method_planned,can_delay,delay_risk,notes,is_recurring,recurrence_frequency,recurrence_start_date,recurrence_end_date,recurrence_rule,source_type,is_generated,late_interest_enabled,late_interest_rate,late_interest_frequency,late_fee_amount,interest_start_date)
      values (p_user_id,v_category_id,v_person_id,v_name,nullif(btrim(p_arguments->>'description'),''),v_amount,(p_arguments->>'dueDate')::date,
        coalesce(p_arguments->>'status','pending')::public.record_status,coalesce(p_arguments->>'priority','normal')::public.priority_level,coalesce(p_arguments->>'riskLevel','medium')::public.risk_level,
        case when coalesce(p_arguments->>'status','pending')='paid' then coalesce(nullif(p_arguments->>'paidDate','')::date::timestamptz,v_now) else null end,
        coalesce(nullif(p_arguments->>'paymentMethod',''),'unknown'),coalesce((p_arguments->>'canDelay')::boolean,false),coalesce(p_arguments->>'delayRisk','medium')::public.risk_level,nullif(btrim(p_arguments->>'notes'),''),
        coalesce((p_arguments->>'isRecurring')::boolean,false),case when coalesce((p_arguments->>'isRecurring')::boolean,false) then coalesce(p_arguments->>'recurrenceFrequency','monthly') else null end,
        case when coalesce((p_arguments->>'isRecurring')::boolean,false) then coalesce(nullif(p_arguments->>'recurrenceStartDate','')::date,(p_arguments->>'dueDate')::date) else null end,
        case when coalesce((p_arguments->>'isRecurring')::boolean,false) then nullif(p_arguments->>'recurrenceEndDate','')::date else null end,
        case when coalesce((p_arguments->>'isRecurring')::boolean,false) then jsonb_build_object('frequency',coalesce(p_arguments->>'recurrenceFrequency','monthly'),'start_date',coalesce(nullif(p_arguments->>'recurrenceStartDate',''),p_arguments->>'dueDate'),'end_date',nullif(p_arguments->>'recurrenceEndDate','')) else null end,
        'manual',false,coalesce((p_arguments->>'lateInterestEnabled')::boolean,false),case when coalesce((p_arguments->>'lateInterestEnabled')::boolean,false) then coalesce((p_arguments->>'lateInterestRate')::numeric,0) else 0 end,coalesce(p_arguments->>'lateInterestFrequency','monthly'),case when coalesce((p_arguments->>'lateInterestEnabled')::boolean,false) then coalesce((p_arguments->>'lateFeeAmount')::numeric,0) else 0 end,case when coalesce((p_arguments->>'lateInterestEnabled')::boolean,false) then nullif(p_arguments->>'interestStartDate','')::date else null end)
      returning id,to_jsonb(accounts_payable.*) into v_id,v_after;
      v_result := jsonb_build_object('id',v_id,'title',v_after->>'title','amount',v_after->>'amount','dueDate',v_after->>'due_date','status',v_after->>'status','isRecurring',(v_after->>'is_recurring')::boolean);
    else
      select id,to_jsonb(accounts_payable.*) into v_id,v_before from public.accounts_payable where id=(p_arguments->>'id')::uuid and user_id=p_user_id and archived_at is null for update;
      if not found then raise exception 'Conta não encontrada ou arquivada.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Conta alterada desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      if p_tool_name = 'hub_generate_account_recurrences' then
        if not coalesce((v_before->>'is_recurring')::boolean,false) or coalesce(v_before->>'source_type','manual') not in ('manual','recurring') then raise exception 'Esta conta não é uma recorrência manual.' using errcode = '22023'; end if;
        v_total_installments := (p_arguments->>'occurrences')::integer;
        for v_next_installment in 1..v_total_installments loop
          v_status := coalesce(v_before->>'recurrence_frequency','monthly');
          if v_status='weekly' then v_name := (((coalesce(nullif(v_before->>'recurrence_generated_until','')::date,nullif(v_before->>'recurrence_start_date','')::date,(v_before->>'due_date')::date)) + (v_next_installment * 7))::date)::text;
          elsif v_status='yearly' then v_name := (((coalesce(nullif(v_before->>'recurrence_generated_until','')::date,nullif(v_before->>'recurrence_start_date','')::date,(v_before->>'due_date')::date)) + make_interval(years => v_next_installment))::date)::text;
          else v_name := (((coalesce(nullif(v_before->>'recurrence_generated_until','')::date,nullif(v_before->>'recurrence_start_date','')::date,(v_before->>'due_date')::date)) + make_interval(months => v_next_installment))::date)::text; end if;
          if nullif(v_before->>'recurrence_end_date','') is not null and v_name::date > (v_before->>'recurrence_end_date')::date then exit; end if;
          if not exists (select 1 from public.accounts_payable where user_id=p_user_id and recurrence_parent_id=coalesce(nullif(v_before->>'recurrence_parent_id','')::uuid,v_id) and due_date=v_name::date) then
            insert into public.accounts_payable (user_id,category_id,person_id,title,description,amount,due_date,status,priority,risk_level,payment_method_planned,can_delay,delay_risk,notes,is_recurring,recurrence_frequency,recurrence_start_date,recurrence_end_date,recurrence_parent_id,source_type,source_id,is_generated,late_interest_enabled,late_interest_rate,late_interest_frequency,late_fee_amount,interest_start_date)
            values (p_user_id,nullif(v_before->>'category_id','')::uuid,nullif(v_before->>'person_id','')::uuid,v_before->>'title',nullif(v_before->>'description',''),(v_before->>'amount')::numeric,v_name::date,'pending', (v_before->>'priority')::public.priority_level,(v_before->>'risk_level')::public.risk_level,v_before->>'payment_method_planned',(v_before->>'can_delay')::boolean,(v_before->>'delay_risk')::public.risk_level,nullif(v_before->>'notes',''),true,v_status,nullif(v_before->>'recurrence_start_date','')::date,nullif(v_before->>'recurrence_end_date','')::date,coalesce(nullif(v_before->>'recurrence_parent_id','')::uuid,v_id),'recurring',coalesce(nullif(v_before->>'recurrence_parent_id','')::uuid,v_id),true,(v_before->>'late_interest_enabled')::boolean,(v_before->>'late_interest_rate')::numeric,v_before->>'late_interest_frequency',(v_before->>'late_fee_amount')::numeric,nullif(v_before->>'interest_start_date','')::date);
          end if;
        end loop;
        update public.accounts_payable set recurrence_generated_until=v_name::date,updated_at=v_now where id=v_id and user_id=p_user_id returning to_jsonb(accounts_payable.*) into v_after;
        v_result := jsonb_build_object('id',v_id,'generatedUntil',v_after->>'recurrence_generated_until');
      else
        if coalesce((v_before->>'is_generated')::boolean,false) or coalesce(v_before->>'source_type','manual') not in ('manual','recurring') or (v_before->>'installment_id') is not null or (v_before->>'reimbursement_id') is not null or (v_before->>'credit_card_transaction_id') is not null then raise exception 'Conta vinculada deve ser corrigida no módulo de origem.' using errcode = '22023'; end if;
        v_category_id := case when p_arguments ? 'categoryId' then nullif(p_arguments->>'categoryId','')::uuid else nullif(v_before->>'category_id','')::uuid end;
        if v_category_id is null and nullif(btrim(p_arguments->>'categoryName'),'') is not null then select min(id::text)::uuid,count(*) into v_category_id,v_next_installment from public.categories where user_id=p_user_id and is_active and lower(name)=lower(btrim(p_arguments->>'categoryName')); if v_next_installment<>1 then raise exception 'Categoria por nome não encontrada de forma única; use hub_search_categories.' using errcode='22023'; end if; end if;
        v_person_id := case when p_arguments ? 'personId' then nullif(p_arguments->>'personId','')::uuid else nullif(v_before->>'person_id','')::uuid end;
        if v_person_id is null and nullif(btrim(p_arguments->>'personName'),'') is not null then select min(id::text)::uuid,count(*) into v_person_id,v_next_installment from public.people where user_id=p_user_id and is_active and lower(name)=lower(btrim(p_arguments->>'personName')); if v_next_installment<>1 then raise exception 'Pessoa por nome não encontrada de forma única; use hub_search_people.' using errcode='22023'; end if; end if;
        update public.accounts_payable set title=coalesce(nullif(btrim(p_arguments->>'title'),''),title),description=case when p_arguments ? 'description' then nullif(btrim(p_arguments->>'description'),'') else description end,amount=case when p_arguments ? 'amount' then (p_arguments->>'amount')::numeric else amount end,due_date=case when p_arguments ? 'dueDate' then (p_arguments->>'dueDate')::date else due_date end,category_id=v_category_id,person_id=v_person_id,status=case when p_arguments ? 'status' then (p_arguments->>'status')::public.record_status else status end,priority=case when p_arguments ? 'priority' then (p_arguments->>'priority')::public.priority_level else priority end,risk_level=case when p_arguments ? 'riskLevel' then (p_arguments->>'riskLevel')::public.risk_level else risk_level end,paid_at=case when coalesce(p_arguments->>'status',status::text)='paid' then coalesce(nullif(p_arguments->>'paidDate','')::date::timestamptz,paid_at,v_now) else null end,payment_method_planned=case when p_arguments ? 'paymentMethod' then p_arguments->>'paymentMethod' else payment_method_planned end,can_delay=case when p_arguments ? 'canDelay' then (p_arguments->>'canDelay')::boolean else can_delay end,delay_risk=case when p_arguments ? 'delayRisk' then (p_arguments->>'delayRisk')::public.risk_level else delay_risk end,notes=case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'),'') else notes end,is_recurring=case when p_arguments ? 'isRecurring' then (p_arguments->>'isRecurring')::boolean else is_recurring end,recurrence_frequency=case when coalesce((p_arguments->>'isRecurring')::boolean,is_recurring) then coalesce(nullif(p_arguments->>'recurrenceFrequency',''),recurrence_frequency,'monthly') else null end,recurrence_start_date=case when coalesce((p_arguments->>'isRecurring')::boolean,is_recurring) then coalesce(nullif(p_arguments->>'recurrenceStartDate','')::date,recurrence_start_date,due_date) else null end,recurrence_end_date=case when coalesce((p_arguments->>'isRecurring')::boolean,is_recurring) then case when p_arguments ? 'recurrenceEndDate' then nullif(p_arguments->>'recurrenceEndDate','')::date else recurrence_end_date end else null end,late_interest_enabled=case when p_arguments ? 'lateInterestEnabled' then (p_arguments->>'lateInterestEnabled')::boolean else late_interest_enabled end,late_interest_rate=case when p_arguments ? 'lateInterestRate' then (p_arguments->>'lateInterestRate')::numeric else late_interest_rate end,late_interest_frequency=case when p_arguments ? 'lateInterestFrequency' then p_arguments->>'lateInterestFrequency' else late_interest_frequency end,late_fee_amount=case when p_arguments ? 'lateFeeAmount' then (p_arguments->>'lateFeeAmount')::numeric else late_fee_amount end,interest_start_date=case when p_arguments ? 'interestStartDate' then nullif(p_arguments->>'interestStartDate','')::date else interest_start_date end,updated_at=v_now where id=v_id and user_id=p_user_id returning to_jsonb(accounts_payable.*) into v_after;
        v_result := jsonb_build_object('id',v_id,'title',v_after->>'title','amount',v_after->>'amount','dueDate',v_after->>'due_date','status',v_after->>'status','updatedAt',v_after->>'updated_at');
      end if;
    end if;
    insert into public.audit_logs (user_id,module,record_id,action,old_value,new_value,metadata) values (p_user_id,'accounts_payable',v_id,replace(p_tool_name,'hub_',''),v_before,v_after,jsonb_build_object('source','mcp','idempotencyKey',p_idempotency_key));
  end if;

  if p_tool_name in ('hub_create_person', 'hub_update_person', 'hub_deactivate_person') then
    if p_tool_name = 'hub_create_person' then
      v_name := btrim(coalesce(p_arguments->>'name', ''));
      if v_name = '' then raise exception 'Nome da pessoa é obrigatório.' using errcode = '22023'; end if;
      if exists (select 1 from public.people where user_id = p_user_id and lower(name) = lower(v_name)) then
        raise exception 'Já existe uma pessoa com este nome.' using errcode = '23505';
      end if;
      insert into public.people (user_id, name, relationship_type, email, phone, pix_key, notes, is_active)
      values (p_user_id, v_name, coalesce(nullif(btrim(p_arguments->>'relationshipType'), ''), 'other'),
        nullif(btrim(p_arguments->>'email'), ''), nullif(btrim(p_arguments->>'phone'), ''),
        nullif(btrim(p_arguments->>'pixKey'), ''), nullif(btrim(p_arguments->>'notes'), ''), coalesce((p_arguments->>'isActive')::boolean, true))
      returning id, to_jsonb(people.*) into v_id, v_after;
      v_result := jsonb_build_object('id', v_id, 'name', v_name, 'isActive', coalesce((p_arguments->>'isActive')::boolean, true));
    else
      select id, to_jsonb(people.*) into v_id, v_before from public.people where id = (p_arguments->>'id')::uuid and user_id = p_user_id for update;
      if not found then raise exception 'Pessoa não encontrada.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Pessoa alterada desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      update public.people set
        name = case when p_tool_name = 'hub_deactivate_person' then name else coalesce(nullif(btrim(p_arguments->>'name'), ''), name) end,
        relationship_type = case when p_tool_name = 'hub_deactivate_person' then relationship_type else coalesce(nullif(btrim(p_arguments->>'relationshipType'), ''), relationship_type) end,
        email = case when p_tool_name = 'hub_deactivate_person' then email when p_arguments ? 'email' then nullif(btrim(p_arguments->>'email'), '') else email end,
        phone = case when p_tool_name = 'hub_deactivate_person' then phone when p_arguments ? 'phone' then nullif(btrim(p_arguments->>'phone'), '') else phone end,
        pix_key = case when p_tool_name = 'hub_deactivate_person' then pix_key when p_arguments ? 'pixKey' then nullif(btrim(p_arguments->>'pixKey'), '') else pix_key end,
        notes = case when p_tool_name = 'hub_deactivate_person' then notes when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'), '') else notes end,
        is_active = case when p_tool_name = 'hub_deactivate_person' then false else coalesce((p_arguments->>'isActive')::boolean, is_active) end,
        updated_at = v_now
      where id = v_id and user_id = p_user_id returning to_jsonb(people.*) into v_after;
      v_result := jsonb_build_object('id', v_id, 'name', v_after->>'name', 'isActive', (v_after->>'is_active')::boolean, 'updatedAt', v_after->>'updated_at');
    end if;
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (p_user_id, 'people', v_id, case when p_tool_name = 'hub_create_person' then 'create' when p_tool_name = 'hub_deactivate_person' then 'deactivate' else 'update' end, v_before, v_after, jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name in ('hub_create_category', 'hub_update_category', 'hub_deactivate_category') then
    if p_tool_name = 'hub_create_category' then
      v_name := btrim(coalesce(p_arguments->>'name', ''));
      v_status := coalesce(p_arguments->>'type', 'expense');
      if v_name = '' or v_status not in ('expense','income','reimbursement','debt','transfer','planned_purchase','goal','other','purchase','general','leisure','places') then raise exception 'Dados da categoria inválidos.' using errcode = '22023'; end if;
      if exists (select 1 from public.categories where user_id = p_user_id and lower(name) = lower(v_name) and type::text = v_status) then raise exception 'Já existe categoria com este nome e tipo.' using errcode = '23505'; end if;
      insert into public.categories (user_id, name, type, color, icon, scopes, is_default, is_active)
      values (p_user_id, v_name, v_status::public.category_type, nullif(btrim(p_arguments->>'color'), ''), nullif(btrim(p_arguments->>'icon'), ''),
        case when jsonb_typeof(p_arguments->'scopes') = 'array' then array(select jsonb_array_elements_text(p_arguments->'scopes')) else null end,
        coalesce((p_arguments->>'isDefault')::boolean, false), coalesce((p_arguments->>'isActive')::boolean, true))
      returning id, to_jsonb(categories.*) into v_id, v_after;
      v_result := jsonb_build_object('id', v_id, 'name', v_name, 'type', v_status, 'isActive', coalesce((p_arguments->>'isActive')::boolean, true));
    else
      select id, to_jsonb(categories.*) into v_id, v_before from public.categories where id = (p_arguments->>'id')::uuid and user_id = p_user_id for update;
      if not found then raise exception 'Categoria não encontrada.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Categoria alterada desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      update public.categories set
        name = case when p_tool_name = 'hub_deactivate_category' then name else coalesce(nullif(btrim(p_arguments->>'name'), ''), name) end,
        type = case when p_tool_name = 'hub_deactivate_category' or not (p_arguments ? 'type') then type else (p_arguments->>'type')::public.category_type end,
        color = case when p_tool_name = 'hub_deactivate_category' or not (p_arguments ? 'color') then color else nullif(btrim(p_arguments->>'color'), '') end,
        icon = case when p_tool_name = 'hub_deactivate_category' or not (p_arguments ? 'icon') then icon else nullif(btrim(p_arguments->>'icon'), '') end,
        scopes = case when p_tool_name = 'hub_deactivate_category' or jsonb_typeof(p_arguments->'scopes') <> 'array' then scopes else array(select jsonb_array_elements_text(p_arguments->'scopes')) end,
        is_default = case when p_tool_name = 'hub_deactivate_category' then is_default else coalesce((p_arguments->>'isDefault')::boolean, is_default) end,
        is_active = case when p_tool_name = 'hub_deactivate_category' then false else coalesce((p_arguments->>'isActive')::boolean, is_active) end,
        updated_at = v_now
      where id = v_id and user_id = p_user_id returning to_jsonb(categories.*) into v_after;
      v_result := jsonb_build_object('id', v_id, 'name', v_after->>'name', 'type', v_after->>'type', 'isActive', (v_after->>'is_active')::boolean, 'updatedAt', v_after->>'updated_at');
    end if;
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (p_user_id, 'categories', v_id, case when p_tool_name = 'hub_create_category' then 'create' when p_tool_name = 'hub_deactivate_category' then 'deactivate' else 'update' end, v_before, v_after, jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name in ('hub_create_card', 'hub_update_card', 'hub_deactivate_card') then
    if p_tool_name = 'hub_create_card' then
      v_name := btrim(coalesce(p_arguments->>'name', ''));
      if v_name = '' then raise exception 'Nome do cartão é obrigatório.' using errcode = '22023'; end if;
      insert into public.credit_cards (user_id, name, issuer, brand, last_four_digits, limit_amount, closing_day, due_day, cashback_rate, notes, is_active)
      values (p_user_id, v_name, nullif(btrim(p_arguments->>'issuer'), ''), nullif(btrim(p_arguments->>'brand'), ''), nullif(btrim(p_arguments->>'lastFourDigits'), ''),
        nullif(p_arguments->>'limitAmount', '')::numeric, nullif(p_arguments->>'closingDay', '')::integer, nullif(p_arguments->>'dueDay', '')::integer,
        coalesce((p_arguments->>'cashbackRate')::numeric, 0), nullif(btrim(p_arguments->>'notes'), ''), coalesce((p_arguments->>'isActive')::boolean, true))
      returning id, to_jsonb(credit_cards.*) into v_id, v_after;
      v_result := jsonb_build_object('id', v_id, 'name', v_name, 'isActive', coalesce((p_arguments->>'isActive')::boolean, true));
    else
      select id, to_jsonb(credit_cards.*) into v_id, v_before from public.credit_cards where id = (p_arguments->>'id')::uuid and user_id = p_user_id for update;
      if not found then raise exception 'Cartão não encontrado.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Cartão alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      update public.credit_cards set
        name = case when p_tool_name = 'hub_deactivate_card' then name else coalesce(nullif(btrim(p_arguments->>'name'), ''), name) end,
        issuer = case when p_tool_name = 'hub_deactivate_card' or not (p_arguments ? 'issuer') then issuer else nullif(btrim(p_arguments->>'issuer'), '') end,
        brand = case when p_tool_name = 'hub_deactivate_card' or not (p_arguments ? 'brand') then brand else nullif(btrim(p_arguments->>'brand'), '') end,
        last_four_digits = case when p_tool_name = 'hub_deactivate_card' or not (p_arguments ? 'lastFourDigits') then last_four_digits else nullif(btrim(p_arguments->>'lastFourDigits'), '') end,
        limit_amount = case when p_tool_name = 'hub_deactivate_card' or not (p_arguments ? 'limitAmount') then limit_amount else nullif(p_arguments->>'limitAmount', '')::numeric end,
        closing_day = case when p_tool_name = 'hub_deactivate_card' or not (p_arguments ? 'closingDay') then closing_day else nullif(p_arguments->>'closingDay', '')::integer end,
        due_day = case when p_tool_name = 'hub_deactivate_card' or not (p_arguments ? 'dueDay') then due_day else nullif(p_arguments->>'dueDay', '')::integer end,
        cashback_rate = case when p_tool_name = 'hub_deactivate_card' or not (p_arguments ? 'cashbackRate') then cashback_rate else coalesce((p_arguments->>'cashbackRate')::numeric, 0) end,
        notes = case when p_tool_name = 'hub_deactivate_card' or not (p_arguments ? 'notes') then notes else nullif(btrim(p_arguments->>'notes'), '') end,
        is_active = case when p_tool_name = 'hub_deactivate_card' then false else coalesce((p_arguments->>'isActive')::boolean, is_active) end,
        updated_at = v_now
      where id = v_id and user_id = p_user_id returning to_jsonb(credit_cards.*) into v_after;
      v_result := jsonb_build_object('id', v_id, 'name', v_after->>'name', 'isActive', (v_after->>'is_active')::boolean, 'updatedAt', v_after->>'updated_at');
    end if;
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (p_user_id, 'credit_cards', v_id, case when p_tool_name = 'hub_create_card' then 'create' when p_tool_name = 'hub_deactivate_card' then 'deactivate' else 'update' end, v_before, v_after, jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name in ('hub_create_subscription', 'hub_update_subscription', 'hub_archive_subscription', 'hub_restore_subscription', 'hub_import_subscriptions') then
    if p_tool_name = 'hub_import_subscriptions' then
      v_amount := 0;
      for v_member in select value from jsonb_array_elements(p_arguments->'subscriptions') loop
        v_card_id := (v_member->>'creditCardId')::uuid;
        if not exists (select 1 from public.credit_cards where id = v_card_id and user_id = p_user_id and is_active) then raise exception 'Cartão de uma assinatura importada não está disponível.' using errcode = '22023'; end if;
        v_category_id := nullif(v_member->>'categoryId', '')::uuid;
        if v_category_id is not null and not exists (select 1 from public.categories where id = v_category_id and user_id = p_user_id and is_active) then raise exception 'Categoria de uma assinatura importada não está disponível.' using errcode = '22023'; end if;
        if exists (select 1 from public.subscriptions where user_id = p_user_id and archived_at is null and credit_card_id = v_card_id and lower(name) = lower(btrim(v_member->>'name')) and billing_day = (v_member->>'billingDay')::integer) then
          continue;
        end if;
        insert into public.subscriptions (user_id, credit_card_id, category_id, name, description, amount, billing_day, start_date, end_date, status, notes)
        values (p_user_id, v_card_id, v_category_id, btrim(v_member->>'name'), nullif(btrim(v_member->>'description'), ''),
          (v_member->>'amount')::numeric, (v_member->>'billingDay')::integer, (v_member->>'startDate')::date, nullif(v_member->>'endDate', '')::date,
          coalesce(v_member->>'status', 'active'), nullif(btrim(v_member->>'notes'), '')) returning id into v_id;
        if jsonb_typeof(v_member->'members') = 'array' then
          select coalesce(sum((value->>'shareAmount')::numeric), 0) into v_share_total from jsonb_array_elements(v_member->'members');
          if v_share_total > (v_member->>'amount')::numeric then raise exception 'A soma dos participantes não pode superar a assinatura.' using errcode = '22023'; end if;
          for v_participant in select value from jsonb_array_elements(v_member->'members') loop
            if not exists (select 1 from public.people where id = (v_participant->>'personId')::uuid and user_id = p_user_id and is_active) then raise exception 'Participante de uma assinatura importada não está disponível.' using errcode = '22023'; end if;
            insert into public.subscription_members (user_id, subscription_id, person_id, share_amount, is_active)
            values (p_user_id, v_id, (v_participant->>'personId')::uuid, (v_participant->>'shareAmount')::numeric, true);
          end loop;
        end if;
        v_amount := v_amount + 1;
      end loop;
      v_result := jsonb_build_object('imported', v_amount, 'skippedDuplicates', jsonb_array_length(p_arguments->'subscriptions') - v_amount);
      v_id := null;
      v_after := v_result;
    else
      if p_tool_name = 'hub_create_subscription' then
        v_card_id := (p_arguments->>'creditCardId')::uuid;
        if not exists (select 1 from public.credit_cards where id = v_card_id and user_id = p_user_id and is_active) then raise exception 'Cartão indisponível.' using errcode = '22023'; end if;
        v_category_id := nullif(p_arguments->>'categoryId', '')::uuid;
        if v_category_id is not null and not exists (select 1 from public.categories where id = v_category_id and user_id = p_user_id and is_active) then raise exception 'Categoria indisponível.' using errcode = '22023'; end if;
        v_name := btrim(coalesce(p_arguments->>'name', ''));
        v_amount := coalesce((p_arguments->>'amount')::numeric, 0);
        if v_name = '' or v_amount <= 0 or coalesce((p_arguments->>'billingDay')::integer, 0) not between 1 and 31 or nullif(p_arguments->>'startDate','') is null then raise exception 'Dados da assinatura inválidos.' using errcode = '22023'; end if;
        insert into public.subscriptions (user_id, credit_card_id, category_id, name, description, amount, billing_day, start_date, end_date, status, notes)
        values (p_user_id, v_card_id, v_category_id, v_name, nullif(btrim(p_arguments->>'description'), ''), v_amount, (p_arguments->>'billingDay')::integer,
          (p_arguments->>'startDate')::date, nullif(p_arguments->>'endDate','')::date, coalesce(p_arguments->>'status','active'), nullif(btrim(p_arguments->>'notes'), ''))
        returning id, to_jsonb(subscriptions.*) into v_id, v_after;
      else
        select id, to_jsonb(subscriptions.*) into v_id, v_before from public.subscriptions where id = (p_arguments->>'id')::uuid and user_id = p_user_id for update;
        if not found then raise exception 'Assinatura não encontrada.' using errcode = '22023'; end if;
        if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Assinatura alterada desde a leitura; consulte novamente.' using errcode = '40001'; end if;
        if p_tool_name = 'hub_archive_subscription' then
          if p_arguments->>'confirmDestructiveChange' <> 'true' or v_confirmation <> 'CONFIRMO ARQUIVAR' then raise exception 'Arquivamento exige confirmação explícita.' using errcode = '22023'; end if;
          update public.subscriptions set archived_at = v_now, archived_by = p_user_id, archive_reason = nullif(btrim(p_arguments->>'reason'), ''), updated_at = v_now where id = v_id and user_id = p_user_id returning to_jsonb(subscriptions.*) into v_after;
        elsif p_tool_name = 'hub_restore_subscription' then
          update public.subscriptions set archived_at = null, archived_by = null, archive_reason = null, updated_at = v_now where id = v_id and user_id = p_user_id and archived_at is not null returning to_jsonb(subscriptions.*) into v_after;
          if v_after is null then raise exception 'Assinatura não está arquivada.' using errcode = '22023'; end if;
        else
          v_card_id := coalesce(nullif(p_arguments->>'creditCardId','')::uuid, (v_before->>'credit_card_id')::uuid);
          if not exists (select 1 from public.credit_cards where id = v_card_id and user_id = p_user_id and is_active) then raise exception 'Cartão indisponível.' using errcode = '22023'; end if;
          update public.subscriptions set credit_card_id = v_card_id, category_id = case when p_arguments ? 'categoryId' then nullif(p_arguments->>'categoryId','')::uuid else category_id end,
            name = coalesce(nullif(btrim(p_arguments->>'name'), ''), name), description = case when p_arguments ? 'description' then nullif(btrim(p_arguments->>'description'), '') else description end,
            amount = case when p_arguments ? 'amount' then (p_arguments->>'amount')::numeric else amount end,
            billing_day = case when p_arguments ? 'billingDay' then (p_arguments->>'billingDay')::integer else billing_day end,
            start_date = case when p_arguments ? 'startDate' then (p_arguments->>'startDate')::date else start_date end,
            end_date = case when p_arguments ? 'endDate' then nullif(p_arguments->>'endDate','')::date else end_date end,
            status = case when p_arguments ? 'status' then p_arguments->>'status' else status end,
            notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'), '') else notes end, updated_at = v_now
          where id = v_id and user_id = p_user_id returning to_jsonb(subscriptions.*) into v_after;
        end if;
      end if;
      if p_tool_name in ('hub_create_subscription','hub_update_subscription') and jsonb_typeof(p_arguments->'members') = 'array' then
        v_share_total := 0;
        for v_member in select value from jsonb_array_elements(p_arguments->'members') loop
          if not exists (select 1 from public.people where id = (v_member->>'personId')::uuid and user_id = p_user_id and is_active) then raise exception 'Participante indisponível.' using errcode = '22023'; end if;
          v_share_total := v_share_total + (v_member->>'shareAmount')::numeric;
        end loop;
        if v_share_total > (v_after->>'amount')::numeric then raise exception 'A soma dos participantes não pode superar a assinatura.' using errcode = '22023'; end if;
        delete from public.subscription_members where user_id = p_user_id and subscription_id = v_id;
        insert into public.subscription_members (user_id, subscription_id, person_id, share_amount, is_active)
        select p_user_id, v_id, (value->>'personId')::uuid, (value->>'shareAmount')::numeric, true from jsonb_array_elements(p_arguments->'members');
      end if;
      v_result := jsonb_build_object('id', v_id, 'name', v_after->>'name', 'status', v_after->>'status', 'archivedAt', v_after->>'archived_at', 'updatedAt', v_after->>'updated_at');
    end if;
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (p_user_id, 'subscriptions', v_id, replace(p_tool_name, 'hub_', ''), v_before, v_after, jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name in ('hub_create_invoice', 'hub_update_invoice') then
    if p_tool_name = 'hub_create_invoice' then
      v_card_id := (p_arguments->>'creditCardId')::uuid;
      if not exists (select 1 from public.credit_cards where id = v_card_id and user_id = p_user_id and is_active) then raise exception 'Cartão indisponível.' using errcode = '22023'; end if;
      insert into public.credit_card_invoices (user_id, credit_card_id, reference_month, closing_date, due_date, status, paid_amount, paid_at, notes)
      values (p_user_id, v_card_id, ((p_arguments->>'referenceMonth') || '-01')::date, nullif(p_arguments->>'closingDate','')::date,
        (p_arguments->>'dueDate')::date, coalesce(p_arguments->>'status','open')::public.invoice_status,
        coalesce((p_arguments->>'paidAmount')::numeric, 0), case when coalesce(p_arguments->>'status','open') = 'paid' then coalesce(nullif(p_arguments->>'paidDate','')::date::timestamptz, v_now) else null end,
        nullif(btrim(p_arguments->>'notes'), '')) returning id, to_jsonb(credit_card_invoices.*) into v_id, v_after;
      v_result := jsonb_build_object('id', v_id, 'referenceMonth', v_after->>'reference_month', 'status', v_after->>'status', 'dueDate', v_after->>'due_date');
    else
      select id, to_jsonb(credit_card_invoices.*) into v_id, v_before from public.credit_card_invoices where id = (p_arguments->>'id')::uuid and user_id = p_user_id and archived_at is null for update;
      if not found then raise exception 'Fatura não encontrada ou arquivada.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Fatura alterada desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      if (v_before->>'status') = 'paid' and not (coalesce((p_arguments->>'confirmDestructiveChange')::boolean, false) and v_confirmation = 'CONFIRMO ALTERAR FATURA QUITADA') then raise exception 'Alterar fatura quitada exige confirmação explícita.' using errcode = '22023'; end if;
      v_card_id := coalesce(nullif(p_arguments->>'creditCardId','')::uuid, (v_before->>'credit_card_id')::uuid);
      if not exists (select 1 from public.credit_cards where id = v_card_id and user_id = p_user_id) then raise exception 'Cartão indisponível.' using errcode = '22023'; end if;
      update public.credit_card_invoices set credit_card_id = v_card_id, closing_date = case when p_arguments ? 'closingDate' then nullif(p_arguments->>'closingDate','')::date else closing_date end,
        due_date = case when p_arguments ? 'dueDate' then (p_arguments->>'dueDate')::date else due_date end,
        status = case when p_arguments ? 'status' then (p_arguments->>'status')::public.invoice_status else status end,
        paid_amount = case when p_arguments ? 'paidAmount' then (p_arguments->>'paidAmount')::numeric else paid_amount end,
        paid_at = case when coalesce(p_arguments->>'status', status::text) = 'paid' then coalesce(nullif(p_arguments->>'paidDate','')::date::timestamptz, paid_at, v_now) else null end,
        notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'),'') else notes end, updated_at = v_now
      where id = v_id and user_id = p_user_id returning to_jsonb(credit_card_invoices.*) into v_after;
      v_result := jsonb_build_object('id', v_id, 'status', v_after->>'status', 'dueDate', v_after->>'due_date', 'paidAmount', v_after->>'paid_amount', 'updatedAt', v_after->>'updated_at');
    end if;
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (p_user_id, 'credit_card_invoices', v_id, case when p_tool_name = 'hub_create_invoice' then 'create' else 'update' end, v_before, v_after, jsonb_build_object('source', 'mcp', 'idempotencyKey', p_idempotency_key));

  elsif p_tool_name in ('hub_create_installment', 'hub_update_installment', 'hub_generate_installment_accounts', 'hub_register_installment_payment') then
    if p_tool_name = 'hub_create_installment' then
      v_amount := coalesce((p_arguments->>'totalAmount')::numeric, 0);
      v_total_installments := coalesce((p_arguments->>'installmentTotal')::integer, 0);
      if btrim(coalesce(p_arguments->>'description','')) = '' or v_amount <= 0 or v_total_installments < 1 then raise exception 'Dados do parcelamento inválidos.' using errcode = '22023'; end if;
      v_card_id := nullif(p_arguments->>'creditCardId','')::uuid; v_invoice_id := nullif(p_arguments->>'invoiceId','')::uuid;
      if v_card_id is not null and not exists (select 1 from public.credit_cards where id = v_card_id and user_id = p_user_id) then raise exception 'Cartão indisponível.' using errcode = '22023'; end if;
      if v_invoice_id is not null and not exists (select 1 from public.credit_card_invoices where id = v_invoice_id and user_id = p_user_id and credit_card_id = v_card_id) then raise exception 'Fatura indisponível para este cartão.' using errcode = '22023'; end if;
      insert into public.installments (user_id, installment_group_id, credit_card_transaction_id, credit_card_id, invoice_id, category_id, person_id, description, total_amount, installment_amount, installment_number, installment_count, installment_total, current_installment, due_month, start_date, end_date, installment_origin, status, notes)
      values (p_user_id, gen_random_uuid(), nullif(p_arguments->>'creditCardTransactionId','')::uuid, v_card_id, v_invoice_id, nullif(p_arguments->>'categoryId','')::uuid, nullif(p_arguments->>'personId','')::uuid,
        btrim(p_arguments->>'description'), v_amount, (p_arguments->>'installmentAmount')::numeric, coalesce((p_arguments->>'currentInstallment')::integer,1), v_total_installments, v_total_installments,
        coalesce((p_arguments->>'currentInstallment')::integer,1), (p_arguments->>'startDate')::date, (p_arguments->>'startDate')::date, nullif(p_arguments->>'endDate','')::date,
        coalesce(p_arguments->>'installmentOrigin','other'), coalesce(p_arguments->>'status','active')::public.record_status, nullif(btrim(p_arguments->>'notes'), ''))
      returning id, to_jsonb(installments.*) into v_id, v_after;
      v_result := jsonb_build_object('id',v_id,'description',v_after->>'description','status',v_after->>'status','installmentTotal',v_after->>'installment_total');
    else
      select id, to_jsonb(installments.*) into v_id, v_before from public.installments where id = (p_arguments->>'id')::uuid and user_id = p_user_id for update;
      if not found then raise exception 'Parcelamento não encontrado.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Parcelamento alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      if p_tool_name = 'hub_update_installment' then
        if (v_before->>'credit_card_id') is not null or (v_before->>'invoice_id') is not null or (v_before->>'credit_card_transaction_id') is not null then raise exception 'Parcelamento ligado a cartão deve ser ajustado pelo fluxo de faturas.' using errcode = '22023'; end if;
        update public.installments set description = coalesce(nullif(btrim(p_arguments->>'description'),''),description), total_amount = case when p_arguments ? 'totalAmount' then (p_arguments->>'totalAmount')::numeric else total_amount end,
          installment_amount = case when p_arguments ? 'installmentAmount' then (p_arguments->>'installmentAmount')::numeric else installment_amount end,
          installment_total = case when p_arguments ? 'installmentTotal' then (p_arguments->>'installmentTotal')::integer else installment_total end,
          installment_count = case when p_arguments ? 'installmentTotal' then (p_arguments->>'installmentTotal')::integer else installment_count end,
          current_installment = case when p_arguments ? 'currentInstallment' then (p_arguments->>'currentInstallment')::integer else current_installment end,
          installment_number = case when p_arguments ? 'currentInstallment' then (p_arguments->>'currentInstallment')::integer else installment_number end,
          start_date = case when p_arguments ? 'startDate' then (p_arguments->>'startDate')::date else start_date end,
          end_date = case when p_arguments ? 'endDate' then nullif(p_arguments->>'endDate','')::date else end_date end,
          category_id = case when p_arguments ? 'categoryId' then nullif(p_arguments->>'categoryId','')::uuid else category_id end,
          person_id = case when p_arguments ? 'personId' then nullif(p_arguments->>'personId','')::uuid else person_id end,
          installment_origin = case when p_arguments ? 'installmentOrigin' then p_arguments->>'installmentOrigin' else installment_origin end,
          status = case when p_arguments ? 'status' then (p_arguments->>'status')::public.record_status else status end,
          notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'),'') else notes end, updated_at = v_now
        where id = v_id and user_id = p_user_id returning to_jsonb(installments.*) into v_after;
        v_result := jsonb_build_object('id',v_id,'status',v_after->>'status','updatedAt',v_after->>'updated_at');
      elsif p_tool_name = 'hub_generate_installment_accounts' then
        if (v_before->>'credit_card_id') is not null or (v_before->>'invoice_id') is not null or (v_before->>'credit_card_transaction_id') is not null then raise exception 'Este parcelamento é controlado pelas faturas do cartão.' using errcode = '22023'; end if;
        v_total_installments := coalesce((v_before->>'installment_total')::integer,(v_before->>'installment_count')::integer);
        for v_next_installment in 1..v_total_installments loop
          if not exists (select 1 from public.accounts_payable where user_id = p_user_id and installment_id = v_id and is_generated and installment_number = v_next_installment) then
            insert into public.accounts_payable (user_id, category_id, person_id, title, description, amount, due_date, status, priority, risk_level, payment_method_planned, can_delay, delay_risk, notes, source_type, source_id, linked_module, linked_record_id, installment_id, installment_number, is_generated)
            values (p_user_id, nullif(v_before->>'category_id','')::uuid, nullif(v_before->>'person_id','')::uuid, v_before->>'description', format('Parcela %s/%s gerada pelo parcelamento.',v_next_installment,v_total_installments), (v_before->>'installment_amount')::numeric,
              ((v_before->>'start_date')::date + make_interval(months => v_next_installment - 1))::date, 'pending', 'normal', 'medium', 'unknown', false, 'medium', v_before->>'notes', 'installment', v_id, 'installments', v_id, v_id, v_next_installment, true);
          end if;
        end loop;
        v_result := jsonb_build_object('id',v_id,'generatedAccounts',v_total_installments);
        v_after := v_before;
      else
        if (v_before->>'credit_card_id') is not null or (v_before->>'invoice_id') is not null or (v_before->>'credit_card_transaction_id') is not null then raise exception 'Este parcelamento é controlado pelas faturas do cartão.' using errcode = '22023'; end if;
        v_next_installment := (p_arguments->>'installmentNumber')::integer;
        v_total_installments := coalesce((v_before->>'installment_total')::integer,(v_before->>'installment_count')::integer);
        if v_next_installment < 1 or v_next_installment > v_total_installments then raise exception 'Parcela inválida.' using errcode = '22023'; end if;
        select id into v_existing_account from public.accounts_payable where user_id = p_user_id and installment_id = v_id and is_generated and installment_number = v_next_installment for update;
        if v_existing_account is null then
          insert into public.accounts_payable (user_id, category_id, person_id, title, description, amount, due_date, status, priority, risk_level, payment_method_planned, can_delay, delay_risk, notes, source_type, source_id, linked_module, linked_record_id, installment_id, installment_number, is_generated)
          values (p_user_id, nullif(v_before->>'category_id','')::uuid, nullif(v_before->>'person_id','')::uuid, v_before->>'description', format('Parcela %s/%s gerada no pagamento.',v_next_installment,v_total_installments), (p_arguments->>'paidAmount')::numeric,
            ((v_before->>'start_date')::date + make_interval(months => v_next_installment - 1))::date, 'pending', 'normal', 'medium', coalesce(p_arguments->>'paymentMethod','unknown'), false, 'medium', nullif(btrim(p_arguments->>'notes'),''), 'installment', v_id, 'installments', v_id, v_id, v_next_installment, true)
          returning id into v_existing_account;
        end if;
        update public.accounts_payable set amount = (p_arguments->>'paidAmount')::numeric, status = 'paid', paid_at = (p_arguments->>'paymentDate')::date::timestamptz,
          payment_method_planned = coalesce(p_arguments->>'paymentMethod','unknown'), notes = coalesce(nullif(btrim(p_arguments->>'notes'),''), notes), updated_at = v_now
        where id = v_existing_account and user_id = p_user_id and status <> 'paid';
        if not found then raise exception 'Esta parcela já está paga.' using errcode = '22023'; end if;
        select coalesce(max(installment_number) filter (where status = 'paid'),0) + 1 into v_next_installment from public.accounts_payable where user_id = p_user_id and installment_id = v_id and is_generated;
        update public.installments set current_installment = least(v_next_installment,v_total_installments), installment_number = least(v_next_installment,v_total_installments),
          status = case when v_next_installment > v_total_installments then 'finished'::public.record_status else 'active'::public.record_status end, updated_at = v_now
        where id = v_id and user_id = p_user_id returning to_jsonb(installments.*) into v_after;
        v_result := jsonb_build_object('id',v_id,'accountId',v_existing_account,'status',v_after->>'status','currentInstallment',v_after->>'current_installment');
      end if;
    end if;
    insert into public.audit_logs (user_id,module,record_id,action,old_value,new_value,metadata)
    values (p_user_id,'installments',v_id,replace(p_tool_name,'hub_',''),v_before,v_after,jsonb_build_object('source','mcp','idempotencyKey',p_idempotency_key));

  elsif p_tool_name in ('hub_create_payment_plan','hub_update_payment_plan','hub_activate_payment_plan','hub_create_payment_plan_item','hub_update_payment_plan_item','hub_remove_payment_plan_item') then
    if p_tool_name = 'hub_create_payment_plan' then
      v_name := btrim(coalesce(p_arguments->>'name',''));
      if v_name = '' or nullif(p_arguments->>'referenceMonth','') is null then raise exception 'Nome e mês de referência são obrigatórios.' using errcode = '22023'; end if;
      insert into public.payment_plans (user_id,name,reference_month,description,status,notes) values (p_user_id,v_name,((p_arguments->>'referenceMonth') || '-01')::date,nullif(btrim(p_arguments->>'description'),''),'draft',nullif(btrim(p_arguments->>'notes'),'')) returning id,to_jsonb(payment_plans.*) into v_id,v_after;
      v_result := jsonb_build_object('id',v_id,'name',v_name,'referenceMonth',v_after->>'reference_month','status',v_after->>'status');
    elsif p_tool_name in ('hub_update_payment_plan','hub_activate_payment_plan') then
      select id,to_jsonb(payment_plans.*) into v_id,v_before from public.payment_plans where id = (p_arguments->>'id')::uuid and user_id = p_user_id for update;
      if not found then raise exception 'Plano financeiro não encontrado.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Plano alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      if p_tool_name = 'hub_activate_payment_plan' then
        update public.payment_plans set status = 'draft' where user_id = p_user_id and status = 'active' and id <> v_id;
        update public.payment_plans set status = 'active',updated_at = v_now where id = v_id and user_id = p_user_id returning to_jsonb(payment_plans.*) into v_after;
      else
        update public.payment_plans set name = coalesce(nullif(btrim(p_arguments->>'name'),''),name), reference_month = case when p_arguments ? 'referenceMonth' then ((p_arguments->>'referenceMonth') || '-01')::date else reference_month end,
          description = case when p_arguments ? 'description' then nullif(btrim(p_arguments->>'description'),'') else description end,
          status = case when p_arguments ? 'status' then (p_arguments->>'status')::public.payment_plan_status else status end,
          notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'),'') else notes end,updated_at = v_now where id = v_id and user_id = p_user_id returning to_jsonb(payment_plans.*) into v_after;
      end if;
      v_result := jsonb_build_object('id',v_id,'status',v_after->>'status','updatedAt',v_after->>'updated_at');
    elsif p_tool_name = 'hub_create_payment_plan_item' then
      v_plan_id := (p_arguments->>'paymentPlanId')::uuid;
      if not exists (select 1 from public.payment_plans where id = v_plan_id and user_id = p_user_id) then raise exception 'Plano financeiro indisponível.' using errcode = '22023'; end if;
      v_source_id := nullif(p_arguments->>'sourceId','')::uuid;
      if v_source_id is not null then
        case p_arguments->>'itemType'
          when 'account_payable' then perform public.mcp_require_owned_reference_v1(p_user_id, 'accounts_payable', v_source_id);
          when 'credit_card_invoice' then perform public.mcp_require_owned_reference_v1(p_user_id, 'credit_card_invoices', v_source_id);
          when 'installment' then perform public.mcp_require_owned_reference_v1(p_user_id, 'installments', v_source_id);
          when 'reimbursement' then perform public.mcp_require_owned_reference_v1(p_user_id, 'reimbursements', v_source_id);
          when 'income_source' then perform public.mcp_require_owned_reference_v1(p_user_id, 'income_sources', v_source_id);
          when 'planned_purchase' then perform public.mcp_require_owned_reference_v1(p_user_id, 'planned_purchases', v_source_id);
          when 'goal' then perform public.mcp_require_owned_reference_v1(p_user_id, 'goals', v_source_id);
          else raise exception 'Tipo de origem do plano não permitido.' using errcode = '22023';
        end case;
      end if;
      insert into public.payment_plan_items (user_id,payment_plan_id,item_type,source_id,account_payable_id,credit_card_invoice_id,installment_id,reimbursement_id,income_source_id,planned_purchase_id,goal_id,title,description,amount,due_date,decision,planned_payment_date,priority,risk_level,status,notes)
      values (p_user_id,v_plan_id,p_arguments->>'itemType',v_source_id,
        case when p_arguments->>'itemType'='account_payable' then v_source_id else null end, case when p_arguments->>'itemType'='credit_card_invoice' then v_source_id else null end,
        case when p_arguments->>'itemType'='installment' then v_source_id else null end,case when p_arguments->>'itemType'='reimbursement' then v_source_id else null end,
        case when p_arguments->>'itemType'='income_source' then v_source_id else null end,case when p_arguments->>'itemType'='planned_purchase' then v_source_id else null end,case when p_arguments->>'itemType'='goal' then v_source_id else null end,
        btrim(p_arguments->>'title'),nullif(btrim(p_arguments->>'description'),''),(p_arguments->>'amount')::numeric,nullif(p_arguments->>'dueDate','')::date,coalesce(p_arguments->>'decision','monitor')::public.payment_decision,
        nullif(p_arguments->>'plannedPaymentDate','')::date,case coalesce(p_arguments->>'riskLevel','medium') when 'critical' then 'critical'::public.priority_level when 'high' then 'high'::public.priority_level else 'normal'::public.priority_level end,
        coalesce(p_arguments->>'riskLevel','medium')::public.risk_level,coalesce(p_arguments->>'status','pending')::public.record_status,nullif(btrim(p_arguments->>'notes'),'')) returning id,to_jsonb(payment_plan_items.*) into v_id,v_after;
      v_result := jsonb_build_object('id',v_id,'paymentPlanId',v_plan_id,'title',v_after->>'title');
    else
      select id,to_jsonb(payment_plan_items.*) into v_id,v_before from public.payment_plan_items where id = (p_arguments->>'id')::uuid and user_id = p_user_id for update;
      if not found then raise exception 'Item do plano não encontrado.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Item alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      if p_tool_name = 'hub_remove_payment_plan_item' then
        if p_arguments->>'confirmDestructiveChange' <> 'true' or v_confirmation <> 'CONFIRMO EXCLUIR' then raise exception 'Remoção exige confirmação explícita.' using errcode = '22023'; end if;
        delete from public.payment_plan_items where id = v_id and user_id = p_user_id; v_after := null; v_result := jsonb_build_object('id',v_id,'deleted',true);
      else
        v_status := coalesce(nullif(p_arguments->>'itemType',''), v_before->>'item_type');
        v_source_id := case when p_arguments ? 'sourceId' then nullif(p_arguments->>'sourceId','')::uuid else nullif(v_before->>'source_id','')::uuid end;
        if v_source_id is not null then
          case v_status
            when 'account_payable' then perform public.mcp_require_owned_reference_v1(p_user_id, 'accounts_payable', v_source_id);
            when 'credit_card_invoice' then perform public.mcp_require_owned_reference_v1(p_user_id, 'credit_card_invoices', v_source_id);
            when 'installment' then perform public.mcp_require_owned_reference_v1(p_user_id, 'installments', v_source_id);
            when 'reimbursement' then perform public.mcp_require_owned_reference_v1(p_user_id, 'reimbursements', v_source_id);
            when 'income_source' then perform public.mcp_require_owned_reference_v1(p_user_id, 'income_sources', v_source_id);
            when 'planned_purchase' then perform public.mcp_require_owned_reference_v1(p_user_id, 'planned_purchases', v_source_id);
            when 'goal' then perform public.mcp_require_owned_reference_v1(p_user_id, 'goals', v_source_id);
            else raise exception 'Tipo de origem do plano não permitido.' using errcode = '22023';
          end case;
        end if;
        update public.payment_plan_items set item_type = coalesce(nullif(p_arguments->>'itemType',''),item_type),source_id = case when p_arguments ? 'sourceId' then nullif(p_arguments->>'sourceId','')::uuid else source_id end,
          title = coalesce(nullif(btrim(p_arguments->>'title'),''),title),description = case when p_arguments ? 'description' then nullif(btrim(p_arguments->>'description'),'') else description end,
          amount = case when p_arguments ? 'amount' then (p_arguments->>'amount')::numeric else amount end,due_date = case when p_arguments ? 'dueDate' then nullif(p_arguments->>'dueDate','')::date else due_date end,
          decision = case when p_arguments ? 'decision' then (p_arguments->>'decision')::public.payment_decision else decision end,planned_payment_date = case when p_arguments ? 'plannedPaymentDate' then nullif(p_arguments->>'plannedPaymentDate','')::date else planned_payment_date end,
          risk_level = case when p_arguments ? 'riskLevel' then (p_arguments->>'riskLevel')::public.risk_level else risk_level end,status = case when p_arguments ? 'status' then (p_arguments->>'status')::public.record_status else status end,
          notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'),'') else notes end,updated_at = v_now where id = v_id and user_id = p_user_id returning to_jsonb(payment_plan_items.*) into v_after;
        v_result := jsonb_build_object('id',v_id,'title',v_after->>'title','updatedAt',v_after->>'updated_at');
      end if;
    end if;
    insert into public.audit_logs (user_id,module,record_id,action,old_value,new_value,metadata)
    values (p_user_id,case when p_tool_name like '%payment_plan_item%' then 'payment_plan_items' else 'payment_plans' end,v_id,replace(p_tool_name,'hub_',''),v_before,v_after,jsonb_build_object('source','mcp','idempotencyKey',p_idempotency_key));

  elsif p_tool_name in ('hub_create_place','hub_update_place') then
    if p_tool_name = 'hub_create_place' then
      v_name := btrim(coalesce(p_arguments->>'name',''));
      if v_name = '' then raise exception 'Nome do lugar é obrigatório.' using errcode = '22023'; end if;
      insert into public.places (user_id,category_id,name,description,place_type,status,city,district,address,google_maps_url,latitude,longitude,planned_date,visited_date,estimated_cost,actual_cost,rating,would_repeat,companion,notes)
      values (p_user_id,nullif(p_arguments->>'categoryId','')::uuid,v_name,nullif(btrim(p_arguments->>'description'),''),coalesce(p_arguments->>'placeType','other'),coalesce(p_arguments->>'status','want_to_go'),nullif(btrim(p_arguments->>'city'),''),nullif(btrim(p_arguments->>'district'),''),nullif(btrim(p_arguments->>'address'),''),nullif(btrim(p_arguments->>'googleMapsUrl'),''),nullif(p_arguments->>'latitude','')::numeric,nullif(p_arguments->>'longitude','')::numeric,nullif(p_arguments->>'plannedDate','')::date,nullif(p_arguments->>'visitedDate','')::date,coalesce((p_arguments->>'estimatedCost')::numeric,0),coalesce((p_arguments->>'actualCost')::numeric,0),nullif(p_arguments->>'rating','')::integer,case when coalesce(p_arguments->>'status','want_to_go')='visited' then (p_arguments->>'wouldRepeat')::boolean else null end,nullif(btrim(p_arguments->>'companion'),''),nullif(btrim(p_arguments->>'notes'),'')) returning id,to_jsonb(places.*) into v_id,v_after;
      v_result := jsonb_build_object('id',v_id,'name',v_name,'status',v_after->>'status');
    else
      select id,to_jsonb(places.*) into v_id,v_before from public.places where id = (p_arguments->>'id')::uuid and user_id = p_user_id and archived_at is null for update;
      if not found then raise exception 'Lugar não encontrado ou arquivado.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Lugar alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      update public.places set name = coalesce(nullif(btrim(p_arguments->>'name'),''),name),description = case when p_arguments ? 'description' then nullif(btrim(p_arguments->>'description'),'') else description end,
        place_type = case when p_arguments ? 'placeType' then p_arguments->>'placeType' else place_type end,status = case when p_arguments ? 'status' then p_arguments->>'status' else status end,
        city = case when p_arguments ? 'city' then nullif(btrim(p_arguments->>'city'),'') else city end,district = case when p_arguments ? 'district' then nullif(btrim(p_arguments->>'district'),'') else district end,address = case when p_arguments ? 'address' then nullif(btrim(p_arguments->>'address'),'') else address end,
        google_maps_url = case when p_arguments ? 'googleMapsUrl' then nullif(btrim(p_arguments->>'googleMapsUrl'),'') else google_maps_url end,latitude = case when p_arguments ? 'latitude' then nullif(p_arguments->>'latitude','')::numeric else latitude end,longitude = case when p_arguments ? 'longitude' then nullif(p_arguments->>'longitude','')::numeric else longitude end,
        planned_date = case when p_arguments ? 'plannedDate' then nullif(p_arguments->>'plannedDate','')::date else planned_date end,visited_date = case when p_arguments ? 'visitedDate' then nullif(p_arguments->>'visitedDate','')::date else visited_date end,
        estimated_cost = case when p_arguments ? 'estimatedCost' then (p_arguments->>'estimatedCost')::numeric else estimated_cost end,actual_cost = case when p_arguments ? 'actualCost' then (p_arguments->>'actualCost')::numeric else actual_cost end,
        rating = case when p_arguments ? 'rating' then nullif(p_arguments->>'rating','')::integer else rating end,would_repeat = case when coalesce(p_arguments->>'status',status)='visited' and p_arguments ? 'wouldRepeat' then (p_arguments->>'wouldRepeat')::boolean when coalesce(p_arguments->>'status',status)<>'visited' then null else would_repeat end,
        companion = case when p_arguments ? 'companion' then nullif(btrim(p_arguments->>'companion'),'') else companion end,notes = case when p_arguments ? 'notes' then nullif(btrim(p_arguments->>'notes'),'') else notes end,category_id = case when p_arguments ? 'categoryId' then nullif(p_arguments->>'categoryId','')::uuid else category_id end,updated_at = v_now where id = v_id and user_id = p_user_id returning to_jsonb(places.*) into v_after;
      v_result := jsonb_build_object('id',v_id,'name',v_after->>'name','status',v_after->>'status','updatedAt',v_after->>'updated_at');
    end if;
    insert into public.audit_logs (user_id,module,record_id,action,old_value,new_value,metadata) values (p_user_id,'places',v_id,case when p_tool_name='hub_create_place' then 'create' else 'update' end,v_before,v_after,jsonb_build_object('source','mcp','idempotencyKey',p_idempotency_key));

  elsif p_tool_name in ('hub_create_note','hub_update_note','hub_delete_note') then
    if p_tool_name = 'hub_create_note' then
      if btrim(coalesce(p_arguments->>'body','')) = '' then raise exception 'O conteúdo da nota é obrigatório.' using errcode = '22023'; end if;
      insert into public.notes (user_id,title,body,entity_type,entity_id,pinned) values (p_user_id,nullif(btrim(p_arguments->>'title'),''),btrim(p_arguments->>'body'),coalesce(nullif(p_arguments->>'entityType',''),'general'),nullif(p_arguments->>'entityId','')::uuid,coalesce((p_arguments->>'pinned')::boolean,false)) returning id,to_jsonb(notes.*) into v_id,v_after;
      v_result := jsonb_build_object('id',v_id,'title',v_after->>'title','pinned',(v_after->>'pinned')::boolean);
    else
      select id,to_jsonb(notes.*) into v_id,v_before from public.notes where id = (p_arguments->>'id')::uuid and user_id = p_user_id for update;
      if not found then raise exception 'Nota não encontrada.' using errcode = '22023'; end if;
      if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Nota alterada desde a leitura; consulte novamente.' using errcode = '40001'; end if;
      if p_tool_name = 'hub_delete_note' then
        if p_arguments->>'confirmDestructiveChange' <> 'true' or v_confirmation <> 'CONFIRMO EXCLUIR' then raise exception 'Exclusão exige confirmação explícita.' using errcode = '22023'; end if;
        delete from public.notes where id = v_id and user_id = p_user_id; v_after := null; v_result := jsonb_build_object('id',v_id,'deleted',true);
      else
        update public.notes set title = case when p_arguments ? 'title' then nullif(btrim(p_arguments->>'title'),'') else title end,body = coalesce(nullif(btrim(p_arguments->>'body'),''),body),entity_type = coalesce(nullif(p_arguments->>'entityType',''),entity_type),entity_id = case when p_arguments ? 'entityId' then nullif(p_arguments->>'entityId','')::uuid else entity_id end,pinned = coalesce((p_arguments->>'pinned')::boolean,pinned),updated_at = v_now where id=v_id and user_id=p_user_id returning to_jsonb(notes.*) into v_after;
        v_result := jsonb_build_object('id',v_id,'title',v_after->>'title','updatedAt',v_after->>'updated_at');
      end if;
    end if;
    insert into public.audit_logs (user_id,module,record_id,action,old_value,new_value,metadata) values (p_user_id,'notes',v_id,case when p_tool_name='hub_create_note' then 'create' when p_tool_name='hub_delete_note' then 'delete' else 'update' end,v_before,v_after,jsonb_build_object('source','mcp','idempotencyKey',p_idempotency_key));

  elsif p_tool_name in ('hub_archive_record','hub_restore_record') then
    v_module := p_arguments->>'module';
    v_table := case v_module when 'accounts' then 'accounts_payable' when 'income' then 'income_sources' when 'invoices' then 'credit_card_invoices' when 'transactions' then 'credit_card_transactions' when 'reimbursements' then 'reimbursements' when 'purchases' then 'planned_purchases' when 'goals' then 'goals' when 'subscriptions' then 'subscriptions' when 'places' then 'places' else null end;
    if v_table is null then raise exception 'Módulo arquivável inválido.' using errcode = '22023'; end if;
    execute format('select to_jsonb(t.*) from public.%I t where id = $1 and user_id = $2 for update',v_table) into v_before using (p_arguments->>'id')::uuid,p_user_id;
    if v_before is null then raise exception 'Registro não encontrado.' using errcode = '22023'; end if;
    if (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Registro alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
    if p_tool_name = 'hub_archive_record' then
      if p_arguments->>'confirmDestructiveChange' <> 'true' or v_confirmation not in ('CONFIRMO ARQUIVAR', 'CONFIRMO ALTERAR FATURA QUITADA') then raise exception 'Arquivamento exige confirmação explícita.' using errcode = '22023'; end if;
      if v_module = 'invoices' and v_before->>'status' = 'paid' and v_confirmation <> 'CONFIRMO ALTERAR FATURA QUITADA' then raise exception 'Arquivar fatura quitada exige confirmação específica.' using errcode = '22023'; end if;
      execute format('update public.%I set archived_at = $1, archived_by = $2, archive_reason = $3, updated_at = $1 where id = $4 and user_id = $2 returning to_jsonb(%I.*)',v_table,v_table) into v_after using v_now,p_user_id,nullif(btrim(p_arguments->>'reason'),''),(p_arguments->>'id')::uuid;
      v_result := jsonb_build_object('id',(p_arguments->>'id')::uuid,'archived',true,'module',v_module,'archivedAt',v_after->>'archived_at','updatedAt',v_after->>'updated_at');
    else
      execute format('update public.%I set archived_at = null, archived_by = null, archive_reason = null, updated_at = $1 where id = $2 and user_id = $3 and archived_at is not null returning to_jsonb(%I.*)',v_table,v_table) into v_after using v_now,(p_arguments->>'id')::uuid,p_user_id;
      if v_after is null then raise exception 'Registro não está arquivado.' using errcode = '22023'; end if;
      v_result := jsonb_build_object('id',(p_arguments->>'id')::uuid,'restored',true,'module',v_module,'updatedAt',v_after->>'updated_at');
    end if;
    v_id := (p_arguments->>'id')::uuid;
    insert into public.audit_logs (user_id,module,record_id,action,old_value,new_value,metadata) values (p_user_id,v_table,v_id,case when p_tool_name='hub_archive_record' then 'archive' else 'restore' end,v_before,v_after,jsonb_build_object('source','mcp','idempotencyKey',p_idempotency_key));

  elsif p_tool_name = 'hub_update_profile_settings' then
    select to_jsonb(profiles.*) into v_before from public.profiles where id = p_user_id for update;
    if v_before is not null and (v_before->>'updated_at')::timestamptz is distinct from (p_arguments->>'expectedUpdatedAt')::timestamptz then raise exception 'Perfil alterado desde a leitura; consulte novamente.' using errcode = '40001'; end if;
    insert into public.profiles (id,user_id,display_name,currency,timezone,month_start_day) values (p_user_id,p_user_id,nullif(btrim(p_arguments->>'displayName'),''),coalesce(nullif(p_arguments->>'currency',''),'BRL'),coalesce(nullif(p_arguments->>'timezone',''),'America/Cuiaba'),coalesce((p_arguments->>'monthStartDay')::integer,1))
    on conflict (id) do update set display_name = case when p_arguments ? 'displayName' then nullif(btrim(p_arguments->>'displayName'),'') else profiles.display_name end,currency = case when p_arguments ? 'currency' then p_arguments->>'currency' else profiles.currency end,timezone = case when p_arguments ? 'timezone' then p_arguments->>'timezone' else profiles.timezone end,month_start_day = case when p_arguments ? 'monthStartDay' then (p_arguments->>'monthStartDay')::integer else profiles.month_start_day end,updated_at = v_now
    returning to_jsonb(profiles.*) into v_after;
    v_id := p_user_id; v_result := jsonb_build_object('id',p_user_id,'displayName',v_after->>'display_name','updatedAt',v_after->>'updated_at');
    insert into public.audit_logs (user_id,module,record_id,action,old_value,new_value,metadata) values (p_user_id,'profiles',p_user_id,'update',v_before,v_after,jsonb_build_object('source','mcp','idempotencyKey',p_idempotency_key));
  end if;

  v_result := coalesce(v_result, '{}'::jsonb) || jsonb_build_object('idempotentReplay', false, 'tool', p_tool_name);
  insert into public.mcp_write_operations (user_id,idempotency_key,tool_name,arguments,result)
  values (p_user_id,p_idempotency_key,p_tool_name,p_arguments,v_result) returning id into v_operation_id;
  v_result := v_result || jsonb_build_object('operationId',v_operation_id);
  update public.mcp_write_operations set result = v_result where id = v_operation_id and user_id = p_user_id;
  return v_result;
end;
$$;

revoke all on function public.mcp_execute_direct_write_v2(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_execute_direct_write_v2(uuid, text, text, jsonb) to service_role;

comment on function public.mcp_execute_direct_write_v2(uuid, text, text, jsonb) is
  'Atomic and idempotent MCP mutations for operational Hub modules. Callable only by service_role.';

commit;
