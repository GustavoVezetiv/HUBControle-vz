# MCP - Hub VZ

> **Documento vigente:** consulte [`MCP_STAGING.md`](MCP_STAGING.md). A
> arquitetura atual usa um broker OAuth próprio com tokens opacos e sessão
> Supabase cifrada server-side. As notas abaixo registram a revisão anterior e
> não devem ser usadas para configurar o staging.

**Estado em 10/10/2026:** OAuth, PKCE S256, resource binding, refresh rotativo,
revogação e as consultas foram validados no staging isolado. A migration
`202610100001_mcp_direct_writes.sql` adiciona escritas diretas atômicas,
idempotentes e auditadas. O RPC de escrita é executável apenas por
`service_role`; o endpoint MCP valida o token opaco e passa o usuário já
autenticado. A publicação do incremento V2 é registrada em
`202610120005_mcp_complete_modules_production.sql` e deve ser acompanhada pelo
rollback em `MCP_COMPLETE_MODULES_PRODUCTION_ROLLBACK.sql`.

As propostas com aprovação no painel são agora um fluxo legado somente para
consulta histórica. Operações simples usam `mcp:write` e não criam propostas.
Faturas quitadas exigem confirmação explícita na conversa; exclusões,
arquivamentos complexos, movimentação entre faturas e pagamentos externos não
são expostos.

## Expansao de modulos em staging

O incremento `202610120001_mcp_complete_modules.sql` acrescenta a versao 2 do
RPC de escrita para pessoas, categorias, cartoes, assinaturas, faturas,
parcelamentos, planos de pagamento, lugares, notas, arquivamento e preferencias
de perfil. A matriz vigente de CRUD, confirmacoes e restricoes esta em
[`MCP_CRUD_MATRIX.md`](MCP_CRUD_MATRIX.md).

O endpoint chama o RPC V2 somente depois de a migration consolidada estar
presente no ambiente correspondente. A migration e o deploy devem sempre ser
publicados juntos: nunca aponte o endpoint ao V2 antes da migration.

## Registro histórico

As seções abaixo registram decisões anteriores. Para implantação e resultados
atuais, use exclusivamente [`MCP_STAGING.md`](MCP_STAGING.md).

## Architecture

The MCP server is incorporated in the existing Next.js application as the
stateless Streamable HTTP route `POST /api/mcp` (JSON response; `GET` returns
405 and no SSE). This request/response mode fits Vercel Functions without an
in-memory session, although production platform limits still need staging
verification. It does not use a service-role key. Each request accepts a
Supabase OAuth access token, validates it with Supabase Auth, checks issuer,
the **exact MCP resource URL** in `aud`, expiry, subject and an allowlisted
`client_id`, then uses the user's bearer token for queries. Generic
`aud=authenticated` is rejected. RLS isolates rows by `user_id`.

**Important OAuth blocker:** Supabase currently documents OAuth access tokens
with `aud=authenticated`, not the MCP resource URL. ChatGPT's OAuth guidance
requires the `resource` parameter to be echoed into a resource-bound token.
Supabase's standard OAuth scopes (`openid`, `email`, `profile`, `phone`) affect
identity claims, not database permissions. A bearer can call the Data API
directly. The new **unapplied** migration adds restrictive RLS policies that
deny direct writes for OAuth JWTs carrying `client_id`, and deny direct reads
outside the MCP read-tool table allowlist (including Google token storage).
This is additive to the existing permissive ownership policies. New public
tables with `user_id` added later need the same policies. Neither the migration
nor `client_id` checking solves OAuth resource binding by itself.
The migration also denies the MCP OAuth bearer direct access to the private
`voice-captures` Storage bucket; ordinary web/mobile sessions retain access.

The Supabase Custom Access Token Hook can customize `aud`, but documentation
does not establish that the OAuth `resource` request parameter (RFC 8707) is
available to the hook, echoed in refresh tokens, or enforced by Supabase.
Do not hardcode the Hub audience for all authenticated tokens: that would
mislabel ordinary web sessions. If staging cannot demonstrate a resource-bound
access token across authorization and refresh, use a separate standards-
compliant OAuth authorization server/token broker for MCP. Do not loosen the
resource check to `authenticated`.
Staging must also prove that Supabase Data API accepts the resulting
resource-bound token for user-scoped read queries; this is not assumed.

`/.well-known/oauth-protected-resource` and its path-aware `/api/mcp` variant
advertise the Hub resource and the
Supabase OAuth authorization server. `/oauth/consent` is the consent screen
where an authenticated Hub user approves or denies the MCP client.

The route is intentionally thin:

- `src/app/api/mcp/route.ts` contains JSON-RPC and Streamable HTTP handling.
- `src/features/mcp/auth.ts` verifies bearer tokens, allowlists OAuth clients and
  rejects browser origins outside the Hub URL.
- `src/features/mcp/tools.ts` provides read tools and optional planning proposals.
- `/dashboard/mcp-approvals` lets the user decide proposals in the ordinary Hub
  session; the MCP bearer cannot decide them.
- `supabase/migrations/202610070001_mcp_action_requests.sql` proposes a short,
  signed request, restrictive OAuth RLS and atomic planning RPC. It has **not**
  been applied anywhere in this review. `docs/MCP_ROLLBACK.sql` is a manual
  staging rollback template; disable/revoke OAuth clients before using it.

No Google Tasks API is exposed by this MCP. The weekly-review tool is read-only.

## Tools

Read tools:

- `hub_get_financial_summary`
- `hub_list_accounts`
- `hub_list_transactions`
- `hub_list_pending_charges`
- `hub_list_invoices`
- `hub_list_subscriptions`
- `hub_list_reimbursements`
- `hub_list_installments`
- `hub_list_income`
- `hub_list_planned_purchases`
- `hub_list_goals`
- `hub_get_weekly_review`
- `hub_get_action_status`

Optional planning tools prepare only, with `MCP_ENABLE_WRITES=true` in an
isolated environment:

- `hub_create_planned_purchase`
- `hub_update_planned_purchase`
- `hub_update_goal`

`hub_confirm_action` and transaction write tools have been removed. Preparation
stores an HMAC over user, operation, exact arguments and expiry. The Hub page
rechecks that HMAC and current owner before calling `mcp_decide_planning_action`
using the web session. The SQL function rejects OAuth `client_id`, locks the
proposal, rechecks owner/expiry/version/category, applies one planning change,
inserts the audit log and marks completion in one transaction. A process crash
rolls back the whole RPC. Repeating a completed approval returns the stored
result without a second write. The RPC has elevated table rights but explicitly
checks `auth.uid()` on every record; authenticated users have no direct UPDATE
grant on proposal state. These properties still need a real PostgreSQL test.

The financial write surface remains disabled. It does not move a
transaction between invoices, pay invoices, create linked entries, settle
reimbursements, create recurring items, or edit a linked/recurring/installment
transaction. Those workflows retain their existing Hub UI until their complete
domain rules can be exposed safely.

## MCP examples

Initialize after authenticating:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}
```

List open reimbursements:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"hub_list_pending_charges","arguments":{"limit":20}}}
```

Prepare a planned purchase (only after the staging write flag is enabled):

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"hub_create_planned_purchase","arguments":{"title":"Cadeira","estimatedAmount":900}}}
```

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"hub_get_action_status","arguments":{"confirmationId":"ID_DA_PREVIA"}}}
```

Between these calls the user opens `/dashboard/mcp-approvals` in the Hub to
approve or reject. A second MCP call cannot authorize the change.

## Configuration for isolated staging only

1. Create a separate Supabase staging project and synthetic users/data. Apply
   the existing schema plus the proposed MCP migration **there only**. Inventory
   live tables, policies and grants first: new tables added later need matching
   restrictive policies.
2. Configure Supabase OAuth Server, `/oauth/consent`, Site URL, exact ChatGPT
   redirect URI, asymmetric signing key, S256 PKCE, DCR or a pre-registered
   client. Inspect discovery and authorization/refresh tokens for exact resource
   binding; do not infer compatibility from the consent screen alone.
3. Set `NEXT_PUBLIC_SITE_URL` to the exact HTTPS staging origin,
   `MCP_ENABLED=true`, `MCP_RLS_VERIFIED=true` **only after verifying the
   restrictive policies in staging**, and `MCP_ALLOWED_OAUTH_CLIENT_IDS` to the registered
   ChatGPT client ID(s). Keep `MCP_ENABLE_WRITES=false`. A comma-separated
   allowlist is accepted. Do not expose this list as a security substitute for
   Supabase-side client restrictions.
4. For **isolated write tests only**, configure a random 32+ byte
   `MCP_CONFIRMATION_SECRET` and `MCP_ENABLE_WRITES=true`. This enables only
   planning proposals, never financial transaction writes. Store the secret
   server-side; rotating it invalidates outstanding proposals.
5. Test discovery, authorization code + PKCE, consent, refresh, revocation,
   tool listing and a harmless read with the exact ChatGPT client. The MCP
   server does not receive or store refresh tokens; Supabase and ChatGPT own
   refresh. DCR must be enabled in Supabase if that registration method is
   chosen. `offline_access` is not advertised because Supabase does not list
   it as a supported scope.

Never put `SUPABASE_SERVICE_ROLE_KEY`, a personal access token, or a Supabase
refresh token into ChatGPT or the plugin form.

## Connecting a private ChatGPT plugin

1. In an isolated staging environment, open ChatGPT's **Add custom MCP server**
   (subject to workspace permissions) and enter the staging `/api/mcp` HTTPS URL.
2. Choose OAuth and use the exact callback URI shown by ChatGPT in Supabase.
   Check whether discovery advertises S256 and DCR (or register the client
   beforehand), and whether tokens carry the exact MCP `aud` after both
   authorization and refresh. This is **unverified** today.
3. Only after a successful OAuth exchange, test a read with a synthetic user.
   Confirm that a second user cannot read the first user's rows, OAuth bearer
   cannot write via Data API, read Google connection tokens or access the
   voice-capture bucket, and unauthenticated requests receive `WWW-Authenticate`.
4. Do not connect the production project or enable writes while the OAuth
   resource/audience and direct Data API concerns above remain unresolved.

Sites compatibility is not established by this implementation. A separate
Site-hosted MCP path is not required for the existing Next.js endpoint, but
connecting the Hub as a ChatGPT custom MCP server still needs the staging OAuth
test above. No Sites deployment was attempted.

## Validation checklist

- Unauthenticated `POST /api/mcp` returns 401 and a `WWW-Authenticate` resource
  metadata challenge.
- A token from an allowlisted OAuth client with exact resource audience can
  initialize and list only its own records through the MCP route; this has unit
  coverage but not a live two-user Supabase staging test yet.
- A user cannot access another user's IDs because requests use a user-scoped
  Supabase client and RLS remains enabled.
- A forged/altered preparation fails HMAC verification in the Hub action;
  ownership, expiry and version are rechecked by the atomic RPC.
- OAuth Data API writes are denied by restrictive RLS, even if an existing
  permissive policy would allow the same user's web session.
- Financial transaction writes remain absent from the MCP tool list. Existing
  Hub UI workflows are unchanged.
- An approved planning create/edit and audit log commit together. A failed
  statement rolls the entire RPC back. This requires staging failure tests.

`npm run test:mcp` covers bearer parsing, origin, OAuth client/subject/resource/
expiry, HMAC tampering, cross-user access and expired/replayed proposals. It
also statically inspects the RLS/RPC migration, but **does not execute SQL**.
`npm run lint` and `npm run build` are broader checks. A two-user staging run
must verify direct Data API bypass attempts, rejected OAuth RPC, successful
approval, replay, expiration and rollback after a deliberate constraint error.

`npm run test:mcp:staging` is the opt-in integration test. It requires a
**separate** Supabase project with the current schema and MCP migration, two
fresh synthetic users, and an OAuth access token for user A. Set
`MCP_STAGING_CONFIRM=isolated-synthetic-only`, `MCP_STAGING_SUPABASE_URL`,
`MCP_STAGING_SUPABASE_ANON_KEY`, `MCP_STAGING_USER_A_EMAIL`,
`MCP_STAGING_USER_A_PASSWORD`, `MCP_STAGING_USER_B_EMAIL`,
`MCP_STAGING_USER_B_PASSWORD`, and `MCP_STAGING_OAUTH_ACCESS_TOKEN_A` in the
local shell only. The script refuses the project URL found in `.env.local`.
It creates synthetic planning records, a **fake** Google connection and a tiny
nonpersonal audio fixture in staging; it never deletes or modifies existing
financial records. It checks
cross-user isolation, OAuth Data API write denial, token-table and Storage denial,
OAuth/self-approval denial, idempotent approval, audit, failure rollback and
expiry. Its direct RPC calls exercise SQL, **not** the Hub HMAC/web approval
page; test that browser workflow separately with a staging account.

## External dependencies

Production activation is **blocked**, not merely a configuration step. It
requires a proven resource-bound OAuth flow, applying/testing the RLS migration
in isolated staging, and an end-to-end ChatGPT connection. Supabase OAuth
settings, redirect URI, DCR/client registration, staging database and ChatGPT
workspace permissions depend on owner configuration. Financial writes need
separate transactional domain design and remain outside this MVP.

## Official references

- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)
- [Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server)
- [Supabase OAuth token security](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Supabase Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Vercel MCP deployment guidance](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel)
