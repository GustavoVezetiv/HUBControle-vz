-- Execute somente depois de desabilitar MCP_ENABLED na Vercel e publicar.
-- Este rollback preserva registros OAuth e de idempotencia para auditoria.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

revoke all on function public.mcp_execute_direct_write_v1(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.mcp_recalculate_invoice_totals_v1(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

drop function if exists public.mcp_execute_direct_write_v1(uuid, text, text, jsonb);
drop function if exists public.mcp_recalculate_invoice_totals_v1(uuid, uuid, boolean);

update public.mcp_oauth_records
set status = 'revoked',
    processing_started_at = null,
    updated_at = now()
where status in ('active', 'processing');

commit;
