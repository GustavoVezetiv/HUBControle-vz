-- Tables created through SQL migrations do not automatically inherit the
-- Dashboard's API grants. The Hub web client needs authenticated CRUD rights;
-- row-level security remains the authority that limits each row to auth.uid().
-- MCP proposal and OAuth stores are intentionally server-only and excluded.
do $$
declare
  v_table record;
begin
  grant usage on schema public to authenticated;

  for v_table in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname not in ('mcp_action_requests', 'mcp_oauth_records')
  loop
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      v_table.relname
    );
  end loop;

  revoke all on table public.mcp_action_requests from public, anon, authenticated;
  revoke all on table public.mcp_oauth_records from public, anon, authenticated;
end;
$$;
