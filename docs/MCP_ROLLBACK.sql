-- Staging-only rollback template for the current opaque-token architecture.
-- First set MCP_ENABLED=false in the Hub environment. This script removes the
-- MCP RPC and private OAuth state, but preserves proposal history for audit.
begin;

drop function if exists public.mcp_decide_planning_action(uuid, text, text);
drop table if exists public.mcp_oauth_records;

commit;

-- mcp_action_requests intentionally remains server-only and keeps its history.
-- Drop it only after a separate backup and explicit approval.
