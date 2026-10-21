# MCP oficial do Hub VZ

Este documento descreve a publicacao controlada do MCP oficial. Ele nao autoriza
nem executa alteracoes em producao por conta propria.

## Ambientes confirmados

- Aplicacao oficial: `https://hub.vezetiv.dev`
- Projeto Vercel: `financeiro-vz`
- Supabase de producao: `vrovfsfkhxnuleoyjzde` (`hub-vz`)
- Supabase de staging: `zoafgwedojkpyptvmpgt`

O schema financeiro usado pelas ferramentas MCP foi comparado entre producao e
staging. As tabelas e colunas necessarias pelo RPC V2 sao compativeis nos dois
ambientes. A producao possui a base MCP e o incremento V2 consolidado.

## Migrations aplicadas

Aplicar somente:

```text
20261010144423_mcp_official_production
20261010170629_mcp_complete_modules_production
```

O incremento V2 adiciona apenas:

- armazenamento server-side dos tokens opacos do broker OAuth;
- controle de idempotencia das escritas MCP;
- RPC atomica de escrita direta e recálculo de faturas;
- bloqueio de execucao dessas RPCs por `public`, `anon` e `authenticated`.
- endurecimento de funcoes auxiliares antigas apontadas pelo advisor do
  Supabase, sem alterar seu uso por triggers ou pela aplicacao autenticada.

A migration nao altera registros financeiros existentes, politicas RLS atuais
ou permissoes das tabelas usadas pela aplicacao web. Ela apenas remove a
execucao RPC direta e desnecessaria de `handle_new_user()`.

Nao aplicar em producao:

- `202610070001_mcp_action_requests.sql`, que pertence ao fluxo legado de
  propostas;
- `202610090001_authenticated_app_table_grants.sql`, que ampliaria permissoes
  da Data API sem necessidade;
- as migrations MCP individuais de staging quando a consolidada oficial for
  usada.

## Variaveis de producao

Configurar somente no ambiente Production do projeto `financeiro-vz`:

```text
MCP_ENABLED=true
MCP_OAUTH_READY=true
MCP_ENABLE_WRITES=true
MCP_DIRECT_WRITES_READY=true
MCP_PUBLIC_URL=https://hub.vezetiv.dev/api/mcp
MCP_ALLOWED_ORIGINS=https://hub.vezetiv.dev
MCP_ALLOWED_OAUTH_CLIENT_IDS=https://chatgpt.com/oauth/client.json
MCP_OAUTH_ENCRYPTION_KEY=<segredo exclusivo de producao>
```

`MCP_OAUTH_ENCRYPTION_KEY` deve ser uma chave aleatoria base64url de 32 bytes,
gerada no momento da configuracao e enviada diretamente ao armazenamento de
segredos da Vercel. Ela nunca deve ser reutilizada do staging, gravada no Git ou
impressa em logs.

O identificador canonico do recurso OAuth e
`https://hub.vezetiv.dev/api/mcp`. O servidor aceita somente esse recurso; uma
barra final e canonicalizada para o mesmo identificador. Origem, caminho, query
ou fragmento diferentes continuam sendo rejeitados. Autorizacao, troca e
renovacao de tokens armazenam sempre o identificador canonico.

As variaveis Supabase existentes da aplicacao devem continuar apontando para
`vrovfsfkhxnuleoyjzde`. Nao copiar chaves do staging.

## Ordem de publicacao executada

1. Schema e privilegios comparados com staging.
2. Migration V2 aplicada sem alterar dados financeiros.
3. Codigo publicado no deployment `dpl_HvRrUyJCWZ2zcnybeSuKkzMfeDJV`.
4. Dominio oficial validado em `https://hub.vezetiv.dev`.
5. Plugin privado atualizado para a versao 1.1.0.
6. Descoberta OAuth, resource binding, PKCE S256 e bloqueio sem token validados.

Os testes de producao nao criam, editam ou removem registros financeiros. As
escritas oficiais somente devem ser exercidas depois da conexao, por solicitacao
real e consciente do usuario.

## Rollback

O primeiro passo e definir `MCP_ENABLED=false` e publicar essa configuracao.
Depois, seguir `docs/MCP_COMPLETE_MODULES_PRODUCTION_ROLLBACK.sql`. O rollback preserva as tabelas
de OAuth e idempotencia para auditoria, revoga tokens ativos e remove apenas as
RPCs de escrita MCP.

## Plugin oficial

O pacote privado esta em `plugins/hub-vz-official`. Ele usa exclusivamente:

```text
https://hub.vezetiv.dev/api/mcp
```

O plugin de staging deve permanecer separado para contingencia e nunca deve
compartilhar tokens ou segredos com a versao oficial.
