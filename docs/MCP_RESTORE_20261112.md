# Restore MCP routes after production regression

Production deployment `dpl_F2Hqd48zLYH1xmLeB3HfGLbafe99` serves commit
`80751adeac8f2b38bc0934e3ed478648aa10ce76` and lacks the MCP and OAuth routes.
On 2026-11-12 both GET and MCP initialize POST to `/api/mcp` returned Next.js
404 HTML, while the home page returned 200. The connector surfaced a generic
JSON-RPC -32603 error.

The recovery branch starts from that exact production commit and reapplies the
preserved MCP integration from `3cab0a70eaf838a7f046aba91628449e0e606f04`.
The Pluggy and Organizze function types and existing ignore rules are retained.
Existing production environment variables and OAuth encryption key are reused.
No migrations or financial data changes are required by this restoration.

`npm run test:mcp` now runs both security and real-route authentication suites
(37 tests) in CI using Node.js 22. `npm run lint` and `npm run build` are also
required before publishing. Production smoke validation is
`npm run test:mcp:production:readonly`; it checks public metadata and the
unauthenticated 401 challenge without creating financial records. The connected
plugin must then successfully read the profile and categories.

Deploy from this branch as a staged production deployment (`--prod --skip-domain`),
verify the routes, and promote the tested deployment. The branch must be retained
in the repository before the next main-branch release, or that release can remove
the integration again. No automatic Git push is performed.

Rollback: promote the previous deployment identified above. This restores the
previous web application but also restores the MCP outage. Keep the current OAuth
key to preserve existing token records.
