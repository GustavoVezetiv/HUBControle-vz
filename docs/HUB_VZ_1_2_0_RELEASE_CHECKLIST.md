# Hub VZ Oficial 1.2.0 — Checklist de publicação

Auditoria em 21/11/2026 na branch `codex/auditar-conciliacao-mcp`. Produção consultada pelo SQL Editor com uma sessão autorizada do proprietário depois que o conector administrativo recusou acesso. Foram executadas somente consultas de catálogo e contagem.

## Resultado em produção

| Verificação | Resultado |
|---|---|
| Organizze | Apenas `confirm_organizze_import(jsonb,jsonb,text)` existe e ainda aceita `authenticated`. `organizze_reconciliation_ready()` e `confirm_organizze_reconciliation(jsonb,jsonb)` estão ausentes. |
| Pluggy | Prontidão, staging, revisão e regras presentes. Assinaturas e hashes normalizados dos corpos conferem com o banco local homologado. As funções são `SECURITY INVOKER`, autenticadas e sem execução para `anon`. |
| MCP | Escrita V2 e recálculo de faturas presentes com as mesmas definições homologadas e execução restrita ao backend. OAuth e idempotência são tabelas privadas. O RPC de confirmação da 1.2.0 e a tabela de propostas ainda estão ausentes. A migration 1.2.0 cria a tabela e instala o RPC. |
| Ledger | 401 linhas do Pluggy e zero linhas do Organizze, cujo histórico permanece no backup. Zero proprietários ou lotes ausentes, destinos inválidos ou de outro dono, chaves ausentes ou duplicadas. Nenhum vínculo canônico no ledger consultado. |
| Storage | `hub-import-backups` privado, com 31 objetos Pluggy e um Organizze. |
| Vercel | OAuth, flags MCP, proprietários e cinco proxies visíveis. A rota Google Tasks do deploy atual devolveu `401`, resposta que vem depois de confirmar a presença de `CRON_SECRET` naquele deploy. Confirmar a origem dos segredos no próximo deploy. `MCP_CONFIRMATION_SECRET` e `SUPABASE_SERVICE_ROLE_KEY` não apareceram na lista de variáveis do projeto. |

## Homologação

O staging hospedado do Supabase (`zoafgwedojkpyptvmpgt`) está pausado. O Vercel isolado ainda serve uma build de outubro. A homologação foi executada num estágio local isolado com as 58 migrations, Next.js, Auth, PostgreSQL, PostgREST e Storage reais e duas contas sintéticas. Se houver exigência de ensaio no ambiente hospedado, reativar o projeto e publicar a candidata somente no Vercel de staging antes da liberação.

O [teste de homologação](../scripts/validate-mcp-import-staging-local.mjs) exige um Supabase dedicado em `127.0.0.1:55421`, uma cópia do app sem `.env.local` e credenciais sintéticas do stack recebidas por variáveis `MCP_STAGING_*`. O próprio script sobe o Next.js em `localhost:3219`.

O ensaio passou com OAuth/PKCE, 82 ferramentas e isolamento entre as contas. Um lote com sete itens registrou seis ações, incluindo classificação, vínculos e criação nas duas origens, e devolveu um conflito após edição do registro de destino. As duas origens puderam apontar para o mesmo lançamento manual. O replay manteve os mesmos resultados, as seis entradas de auditoria e apenas dois lançamentos novos. O teste autenticado do cron persistiu cinco resultados no bucket privado e preservou a contagem financeira.

## 1. Banco e armazenamento

- [x] No projeto oficial `vrovfsfkhxnuleoyjzde`, conferir assinaturas, hashes, RLS e privilégios. Conferir chaves duplicadas e destinos órfãos. A [auditoria SQL somente leitura](../scripts/audit-import-reconciliation-readonly.sql) reúne essas verificações.
- [x] Conferir o histórico. O Pluggy consta como `20261023145056`. As migrations de MCP base e V2 constam como `20261010144423` e `20261010170629`, com funções compatíveis com as versões locais. O Organizze legado consta como `20261022210830`. A conciliação revisada `20261022212106` e a 1.2.0 não constam.
- [ ] Usar aplicação direcionada às duas versões aprovadas. Resolver o mapeamento das versões históricas antes de qualquer comando que compare ou tente aplicar a fila completa do repositório.
- [ ] **Com autorização de produção**, aplicar primeiro `20261022212106_organizze_reconciliation.sql`. Confirmar a prontidão e a assinatura da conciliação Organizze. Verificar a retirada de `EXECUTE` do importador legado para `authenticated`. A migration instala comportamento e privilégios. Qualquer importação continua sendo uma operação separada.
- [ ] **Com autorização de produção**, aplicar a migration `20261121145945_mcp_confirm_import_reviews.sql` depois de confirmar seus pré-requisitos. Verificar que o novo RPC só é executável por `service_role`, que os RPCs por sessão continuam protegidos por RLS e que a tabela de propostas não está acessível pelo cliente.
- [ ] **Com autorização de produção**, aplicar `20261121160728_pluggy_merchant_memory.sql` antes do deploy que habilita a memória. Conferir a leitura de associações e o RPC sob a RLS do usuário. [Memória de estabelecimentos](PLUGGY_MERCHANT_MEMORY.md)

## 2. Deploy do HubVZ

- [ ] Confirmar por presença e alvo a origem de `MCP_CONFIRMATION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET` no Vercel, incluindo variáveis compartilhadas ou de integração. **Com autorização**, configurar somente o que estiver ausente. Preservar a chave de criptografia do OAuth e os proprietários das integrações.
- [ ] **Com autorização de produção**, publicar a revisão validada no Vercel. Conferir o cron `0 13 * * *` para `/api/pluggy/sync` e preservar o agendamento Google Tasks. A expressão representa 09h em Cuiabá. No Hobby, a execução pode ocorrer entre 09h00 e 09h59. [Limites e precisão do Vercel](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing).
- [ ] Verificar a primeira execução agendada. O Vercel envia `Authorization: Bearer <CRON_SECRET>` do deployment atual. A rotina deve registrar resultados por banco e preservar o relatório em `<owner>/pluggy-sync/` no bucket privado, sem confirmar reconciliações. [Autenticação e logs do cron](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs).

## 3. Atualização do plugin privado

- [ ] **Com autorização para atualizar o plugin**, publicar o pacote 1.2.0 no ID existente `plugins_6aca5085e5ec8191979e7f79bee62d7f`. Preservar público privado, app/conexão atual, ícone e dois manifestos MCP com OAuth/CIMD, `mcp:read`, `mcp:write`, `offline_access` e o endpoint oficial.
- [ ] Manter o catálogo antigo disponível até a checagem do novo deployment. Atualizar o catálogo da conexão no ChatGPT e renovar o OAuth somente se o catálogo estiver desatualizado ou os escopos precisarem de novo consentimento.

## 4. Testes finais

- [ ] Verificar `initialize` e `tools/list` com 82 nomes únicos, OAuth e uma leitura autenticada da Caixa de Entrada no ChatGPT. Em um terminal autorizado, `MCP_PRODUCTION_TEST_EXPECTED_TOOL_COUNT=82` com `npm run test:mcp:production:readonly` verifica a descoberta e as consultas usando o token do proprietário apenas no ambiente do processo.
- [ ] Confirmar a prontidão de Organizze e Pluggy, ler regras e um detalhe de cada origem. Exibir a prévia de um lote pequeno antes de qualquer gravação.
- [ ] Para um teste de escrita em produção, solicitar **aprovação explícita do lote selecionado**. Conferir conflitos e auditoria antes de considerar a versão liberada.
- [ ] Se o deploy falhar, preservar os dados de origem e coordenar o retorno ao deploy anterior. Revisar a versão e as ferramentas do plugin em conjunto com o backend que estiver ativo.
