create table if not exists public.mcp_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null check (tool_name in (
    'hub_create_planned_purchase', 'hub_update_planned_purchase',
    'hub_create_goal', 'hub_update_goal'
  )),
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

create index if not exists mcp_action_requests_user_created_idx
  on public.mcp_action_requests (user_id, created_at desc);

alter table public.mcp_action_requests enable row level security;

-- Proposals and their HMAC signatures are server-only. The MCP server inserts
-- them with service_role after validating the opaque OAuth session; the Hub UI
-- reads them through a server-only helper after validating its normal session.
-- The authenticated role can only execute the narrow atomic decision RPC.
revoke all on public.mcp_action_requests from public, anon, authenticated;
grant select, insert, update on public.mcp_action_requests to service_role;

-- ChatGPT never receives a Supabase JWT. OAuth state and the encrypted
-- Supabase session live in this service-role-only store; browser and MCP users
-- receive no grants, and RLS remains enabled as a second boundary.
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

-- The request row, planning record, and audit entry commit or roll back together.
-- The function has elevated table rights only for its own atomic transaction.
-- Every affected row is still checked against auth.uid(). The opaque MCP token
-- cannot call Supabase or this RPC; the Hub server action independently checks
-- the web session and intent HMAC before invoking it.
create or replace function public.mcp_decide_planning_action(
  p_request_id uuid,
  p_intent_signature text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, auth
as $$
declare
  v_request public.mcp_action_requests%rowtype;
  v_args jsonb;
  v_purchase public.planned_purchases%rowtype;
  v_goal public.goals%rowtype;
  v_before jsonb;
  v_result jsonb;
  v_title text;
  v_amount numeric;
  v_category uuid;
begin
  if auth.uid() is null then
    raise exception 'Somente a sessão web do Hub pode decidir propostas MCP.' using errcode = '42501';
  end if;

  select * into v_request
  from public.mcp_action_requests
  where id = p_request_id and user_id = auth.uid()
  for update;
  if not found or v_request.intent_signature is distinct from p_intent_signature then
    raise exception 'Proposta não encontrada ou assinatura inválida.' using errcode = '42501';
  end if;
  if v_request.status = 'completed' then
    return v_request.result;
  end if;
  if v_request.status <> 'pending' or v_request.expires_at <= clock_timestamp() then
    raise exception 'Proposta expirada ou já decidida.' using errcode = '22023';
  end if;
  if p_decision = 'reject' then
    update public.mcp_action_requests
    set status = 'rejected', rejected_at = clock_timestamp(),
        decided_by = auth.uid(), completed_at = clock_timestamp()
    where id = p_request_id and user_id = auth.uid();
    return jsonb_build_object('status', 'rejected', 'confirmationId', p_request_id);
  end if;
  if p_decision <> 'approve' or v_request.tool_name not in (
    'hub_create_planned_purchase', 'hub_update_planned_purchase',
    'hub_create_goal', 'hub_update_goal'
  ) then
    raise exception 'Operação não disponível para aprovação.' using errcode = '22023';
  end if;

  v_args := v_request.arguments;
  if v_args ? 'categoryId' then
    v_category := (v_args->>'categoryId')::uuid;
    if not exists (
      select 1 from public.categories
      where id = v_category and user_id = auth.uid() and is_active = true
    ) then
      raise exception 'Categoria indisponível para este usuário.' using errcode = '22023';
    end if;
  end if;

  if v_request.tool_name = 'hub_create_planned_purchase' then
    v_title := btrim(coalesce(v_args->>'title', ''));
    v_amount := coalesce((v_args->>'estimatedAmount')::numeric, 0);
    if length(v_title) < 1 or length(v_title) > 300 or v_amount < 0 or v_amount > 1000000000 then
      raise exception 'Nome ou valor estimado inválido.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || lower(v_title) || ':' || coalesce(v_category::text, ''), 0));
    if exists (
      select 1 from public.planned_purchases
      where user_id = auth.uid() and archived_at is null
        and lower(btrim(title)) = lower(v_title)
        and category_id is not distinct from v_category
    ) then
      raise exception 'Compra com mesmo nome e categoria já existe.' using errcode = '23505';
    end if;
    insert into public.planned_purchases (
      user_id, title, estimated_amount, target_date, category_id, project, notes
    ) values (
      auth.uid(), v_title, v_amount, nullif(v_args->>'targetDate', '')::date,
      v_category, nullif(btrim(v_args->>'project'), ''), nullif(btrim(v_args->>'notes'), '')
    ) returning * into v_purchase;
    v_result := jsonb_build_object('id', v_purchase.id, 'title', v_purchase.title,
      'estimatedAmount', v_purchase.estimated_amount);
    insert into public.audit_logs (user_id, module, record_id, action, new_value, metadata)
    values (auth.uid(), 'planned_purchases', v_purchase.id, 'create', v_result,
      jsonb_build_object('source', 'mcp', 'confirmation_id', p_request_id));

  elsif v_request.tool_name = 'hub_update_planned_purchase' then
    select * into v_purchase from public.planned_purchases
    where id = (v_args->>'id')::uuid and user_id = auth.uid() and archived_at is null
    for update;
    if not found or v_purchase.updated_at is distinct from (v_args->>'_version')::timestamptz then
      raise exception 'Compra alterada desde a prévia; prepare outra proposta.' using errcode = '22023';
    end if;
    v_before := jsonb_build_object('title', v_purchase.title,
      'estimatedAmount', v_purchase.estimated_amount, 'targetDate', v_purchase.target_date,
      'categoryId', v_purchase.category_id, 'project', v_purchase.project, 'notes', v_purchase.notes);
    v_title := case when v_args ? 'title' then btrim(v_args->>'title') else v_purchase.title end;
    v_amount := case when v_args ? 'estimatedAmount' then (v_args->>'estimatedAmount')::numeric else v_purchase.estimated_amount end;
    if length(v_title) < 1 or length(v_title) > 300 or v_amount < 0 or v_amount > 1000000000 then
      raise exception 'Nome ou valor estimado inválido.' using errcode = '22023';
    end if;
    update public.planned_purchases
    set title = v_title, estimated_amount = v_amount,
        target_date = case when v_args ? 'targetDate' then (v_args->>'targetDate')::date else target_date end,
        category_id = case when v_args ? 'categoryId' then v_category else category_id end,
        project = case when v_args ? 'project' then nullif(btrim(v_args->>'project'), '') else project end,
        notes = case when v_args ? 'notes' then nullif(btrim(v_args->>'notes'), '') else notes end
    where id = v_purchase.id and user_id = auth.uid()
    returning * into v_purchase;
    v_result := jsonb_build_object('id', v_purchase.id, 'title', v_purchase.title,
      'estimatedAmount', v_purchase.estimated_amount);
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (auth.uid(), 'planned_purchases', v_purchase.id, 'update', v_before,
      jsonb_build_object('title', v_purchase.title, 'estimatedAmount', v_purchase.estimated_amount,
        'targetDate', v_purchase.target_date, 'categoryId', v_purchase.category_id,
        'project', v_purchase.project, 'notes', v_purchase.notes),
      jsonb_build_object('source', 'mcp', 'confirmation_id', p_request_id));

  elsif v_request.tool_name = 'hub_create_goal' then
    v_title := btrim(coalesce(v_args->>'name', ''));
    if length(v_title) < 1 or length(v_title) > 300 or
       coalesce(v_args->>'goalType', 'personal') not in ('personal', 'professional', 'course', 'education', 'project') or
       coalesce(v_args->>'goalKind', 'qualitative') not in ('qualitative', 'financial', 'numeric') or
       coalesce(v_args->>'status', 'active') not in ('active', 'paused', 'completed', 'canceled') then
      raise exception 'Dados da meta inválidos.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      auth.uid()::text || ':' || lower(v_title) || ':' ||
      coalesce(v_args->>'goalType', 'personal') || ':' || coalesce(v_args->>'targetDate', ''), 0
    ));
    if exists (
      select 1 from public.goals
      where user_id = auth.uid() and archived_at is null
        and lower(btrim(name)) = lower(v_title)
        and goal_type = coalesce(v_args->>'goalType', 'personal')
        and target_date is not distinct from nullif(v_args->>'targetDate', '')::date
    ) then
      raise exception 'Meta equivalente já existe.' using errcode = '23505';
    end if;
    insert into public.goals (
      user_id, name, goal_type, goal_category, goal_kind, category_id,
      target_amount, current_amount, target_date, monthly_contribution,
      urgency_level, status, notes
    ) values (
      auth.uid(), v_title,
      coalesce(v_args->>'goalType', 'personal'), coalesce(v_args->>'goalType', 'personal'),
      coalesce(v_args->>'goalKind', 'qualitative'), v_category,
      case when coalesce(v_args->>'goalKind', 'qualitative') = 'financial'
        then nullif(v_args->>'targetAmount', '')::numeric else null end,
      null, nullif(v_args->>'targetDate', '')::date, null,
      case
        when nullif(v_args->>'targetDate', '') is null then 'no_target'
        when nullif(v_args->>'targetDate', '')::date <= current_date + 7 then 'urgent'
        when nullif(v_args->>'targetDate', '')::date <= current_date + 30 then 'attention'
        else 'comfortable'
      end,
      coalesce(v_args->>'status', 'active'), nullif(btrim(v_args->>'notes'), '')
    ) returning * into v_goal;
    v_result := jsonb_build_object('id', v_goal.id, 'name', v_goal.name,
      'status', v_goal.status, 'targetDate', v_goal.target_date);
    insert into public.audit_logs (user_id, module, record_id, action, new_value, metadata)
    values (auth.uid(), 'goals', v_goal.id, 'create', v_result,
      jsonb_build_object('source', 'mcp', 'confirmation_id', p_request_id));

  elsif v_request.tool_name = 'hub_update_goal' then
    select * into v_goal from public.goals
    where id = (v_args->>'id')::uuid and user_id = auth.uid() and archived_at is null
    for update;
    if not found or v_goal.updated_at is distinct from (v_args->>'_version')::timestamptz then
      raise exception 'Meta alterada desde a prévia; prepare outra proposta.' using errcode = '22023';
    end if;
    v_before := jsonb_build_object('name', v_goal.name, 'targetDate', v_goal.target_date,
      'status', v_goal.status, 'notes', v_goal.notes);
    v_title := case when v_args ? 'name' then btrim(v_args->>'name') else v_goal.name end;
    if length(v_title) < 1 or length(v_title) > 300 or
       (v_args ? 'status' and (v_args->>'status') not in ('active', 'paused', 'completed', 'canceled')) then
      raise exception 'Nome ou status da meta inválido.' using errcode = '22023';
    end if;
    update public.goals
    set name = v_title,
        target_date = case when v_args ? 'targetDate' then (v_args->>'targetDate')::date else target_date end,
        status = case when v_args ? 'status' then v_args->>'status' else status end,
        notes = case when v_args ? 'notes' then nullif(btrim(v_args->>'notes'), '') else notes end
    where id = v_goal.id and user_id = auth.uid()
    returning * into v_goal;
    v_result := jsonb_build_object('id', v_goal.id, 'name', v_goal.name,
      'status', v_goal.status, 'targetDate', v_goal.target_date);
    insert into public.audit_logs (user_id, module, record_id, action, old_value, new_value, metadata)
    values (auth.uid(), 'goals', v_goal.id, 'update', v_before,
      jsonb_build_object('name', v_goal.name, 'targetDate', v_goal.target_date,
        'status', v_goal.status, 'notes', v_goal.notes),
      jsonb_build_object('source', 'mcp', 'confirmation_id', p_request_id));
  end if;

  update public.mcp_action_requests
  set status = 'completed', result = v_result, completed_at = clock_timestamp(),
      approved_at = clock_timestamp(), decided_by = auth.uid()
  where id = p_request_id and user_id = auth.uid();
  return v_result;
end;
$$;

revoke all on function public.mcp_decide_planning_action(uuid, text, text) from public, anon;
grant execute on function public.mcp_decide_planning_action(uuid, text, text) to authenticated;

-- Harden legacy helper and trigger functions reported by the Supabase advisor.
alter function public.set_updated_at() set search_path = pg_catalog, public;
alter function public.create_default_categories_for_current_user()
  set search_path = pg_catalog, public, auth;
revoke all on function public.handle_new_user() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
