-- Hub VZ MCP complete-modules production rollback.
--
-- Roll back the Vercel deployment to the prior version first, so the route
-- returns to mcp_execute_direct_write_v1. Then apply this script if the V2
-- writer must be disabled. It intentionally preserves audit and idempotency
-- records; do not delete financial records as part of an MCP rollback.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

revoke all on function public.mcp_execute_direct_write_v2(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;

comment on function public.mcp_execute_direct_write_v2(uuid, text, text, jsonb) is
  'Disabled by MCP complete-modules rollback. Preserve for forensic audit only.';

commit;
