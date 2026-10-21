# MCP do Hub VZ - staging seguro

Este documento descreve a arquitetura vigente. Ele substitui as hipóteses de
OAuth nativo do Supabase registradas em revisões anteriores de `docs/MCP.md`.

## Ambiente autorizado

- Projeto: `Hub VZ - MCP Staging`
- Project ref: `zoafgwedojkpyptvmpgt`
- URL: `https://zoafgwedojkpyptvmpgt.supabase.co`
- Produção `hub-vz`: bloqueada para migrations e testes MCP

## Hospedagem HTTPS de staging

- Projeto Vercel isolado: `hub-vz-mcp-staging`
- Host estável: `https://hub-vz-mcp-staging.vercel.app`
- Endpoint MCP: `https://hub-vz-mcp-staging.vercel.app/api/mcp`
- Projeto Vercel de produção `financeiro-vz`: não vinculado e não alterado

O projeto de staging não possui integração Git. As variáveis e deployments
devem sempre apontar explicitamente para `hub-vz-mcp-staging`; não use o
vínculo do aplicativo de produção como atalho.

Além das 45 migrations históricas, o staging exige
`202610090001_authenticated_app_table_grants.sql`. Ela concede ao papel
`authenticated` os privilégios de API das tabelas normais do Hub, sempre sob
RLS, e exclui explicitamente os armazenamentos privados do MCP. O teste real
com a chave publicável detectou essa ausência porque a Data API devolvia `403`
antes de avaliar as policies.

## Arquitetura de autenticação

O Hub hospeda o authorization server OAuth em rotas Next.js. O desenho segue a
arquitetura já homologada no Class Companion, sem modificar aquele projeto:

1. O ChatGPT usa o cliente público exato
   `https://chatgpt.com/oauth/client.json` e callback
   `https://chatgpt.com/connector_platform_oauth_redirect`.
2. `/oauth/authorize` exige Authorization Code, PKCE S256, `state`, escopos
   permitidos e o recurso exato `https://HOST/api/mcp`.
3. O usuário autentica no Supabase dentro do Hub e dá consentimento explícito.
4. O broker guarda a sessão Supabase cifrada com AES-256-GCM em
   `mcp_oauth_records`, tabela acessível somente por `service_role`.
5. O ChatGPT recebe tokens opacos `mcp_at_*` e `mcp_rt_*`. Ele nunca recebe JWT,
   access token ou refresh token do Supabase e, portanto, não pode usar a Data
   API diretamente.
6. Códigos são de uso único, refresh tokens são rotacionados e todos os
   registros têm validade limitada.

Não há DCR genérico. O cliente ChatGPT é aceito somente pela metadata URL exata,
com verificação da metadata remota. `aud=authenticated` não é tratado como
resource binding.

## Transporte MCP

`POST /api/mcp` implementa JSON-RPC MCP sem sessão em memória e responde no
mesmo request. Esse modo de Streamable HTTP é compatível com Functions stateless.
`GET` responde 405; não há SSE persistente.

O handshake aceita `2025-11-25`, `2025-06-18` e `2025-03-26`. Se o cliente
solicitar uma versão diferente em `initialize`, o servidor responde com a versão
mais recente que suporta, conforme a negociacao MCP. O cabeçalho de versão é
validado nas chamadas seguintes; a descoberta OAuth continua exigindo autenticação.

O catálogo expõe 14 consultas de resumo financeiro, contas, receitas, cartões,
faturas, lançamentos, assinaturas, reembolsos, parcelamentos, compras, metas e
revisão semanal. Quando as duas flags de escrita estão ativas, também expõe 13
operações diretas para despesas, receitas, lançamentos, compras planejadas,
metas e reembolsos.

## Escrita direta

As ferramentas simples não criam propostas. O endpoint valida o token OAuth
opaco, confirma o escopo `mcp:write` e chama, com a chave server-side, a RPC
`mcp_execute_direct_write_v1`. O usuário validado pelo OAuth é passado como
argumento; a RPC valida a existência desse usuário e filtra todos os registros
por esse ID.

`mcp_write_operations` armazena argumentos e resultado por usuário e chave de
idempotência. Um advisory lock serializa repetições; a alteração financeira,
recalculo derivado, auditoria e recibo idempotente fazem parte da mesma transação.
Repetir os mesmos argumentos devolve o resultado anterior. Reutilizar a chave
com argumentos diferentes falha.

O papel `authenticated` não possui `EXECUTE` na RPC nem acesso à tabela de
idempotência. Assim, a Data API comum não contorna o endpoint MCP. O antigo RPC
de aprovação manual também foi revogado para sessões autenticadas; seus dados
históricos não foram apagados.

Não há ferramentas para exclusão, movimentação entre faturas, pagamento externo
ou alteração de parcelas/recorrências geradas. Alterar lançamento em fatura
quitada exige `confirmSensitiveChange=true` e a frase exata
`CONFIRMO ALTERAR FATURA QUITADA`, enviada somente após confirmação explícita
do usuário na conversa.

Enquanto o staging não concluir todos os testes, mantenha:

```text
MCP_ENABLE_WRITES=false
```

## Ordem das migrations

O staging validado contém 47 migrations aplicadas, incluindo
`202610100001_mcp_direct_writes.sql`. O diretório local também
contém `202610090002_mcp_oauth_grant_revocation.sql`, uma migration de reserva
sem DDL: a revogação por concessão usa o `grantId` dentro do payload cifrado e
não depende de nova coluna. Em um ambiente novo, os arquivos devem ser aplicados
em ordem lexical, individualmente. Não agrupe migrations que adicionam valores
a enums com comandos que usam imediatamente esses valores na mesma transação.
`202605210001_extend_import_preview.sql` é uma migration de reserva sem DDL:
os campos de prévia já são criados pela migration inicial.
Depois da aplicação, confirme que o histórico remoto contém exatamente as 47
versões e rode os advisors de segurança e performance.

A migration MCP também fixa o `search_path` das funções legadas e revoga a
execução direta das funções de trigger `handle_new_user` e `rls_auto_enable`.
O advisor não deve sinalizar a RPC de escrita direta como executável por
`authenticated`. Tabelas privadas do MCP têm RLS sem policies e privilégios
revogados intencionalmente; somente `service_role` as acessa.

## Variáveis do ambiente do Hub de staging

```text
NEXT_PUBLIC_SUPABASE_URL=https://zoafgwedojkpyptvmpgt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=https://HOST_STAGING
MCP_PUBLIC_URL=https://HOST_STAGING/api/mcp
MCP_ENABLED=true
MCP_OAUTH_READY=true
MCP_ENABLE_WRITES=false
MCP_DIRECT_WRITES_READY=false
MCP_OAUTH_ENCRYPTION_KEY=
MCP_CONFIRMATION_SECRET=
MCP_ALLOWED_ORIGINS=https://chatgpt.com
MCP_ALLOWED_OAUTH_CLIENT_IDS=https://chatgpt.com/oauth/client.json
```

`MCP_CONFIRMATION_SECRET` existe somente para o fluxo legado de propostas e não
é usado nas escritas diretas. As chaves privadas são somente server-side e devem ter entropia alta.
`MCP_OAUTH_ENCRYPTION_KEY` deve conter exatamente 32 bytes em base64url, sem
padding. A service role nunca usa prefixo `NEXT_PUBLIC_`.

## Teste de banco isolado

`npm run test:mcp:staging` exige confirmação e confere o project ref antes de
fazer qualquer alteração. Ele cria/atualiza dois usuários marcados como fixture,
insere apenas dados sintéticos e valida:

- leitura própria e bloqueio cruzado por RLS;
- bloqueio de update cruzado;
- indisponibilidade de `mcp_action_requests`, `mcp_oauth_records` e
  `mcp_write_operations` para usuários;
- bloqueio de execução da RPC direta pelo papel `authenticated`;
- criação, edição, auditoria e idempotência atômicas;
- recalculo de faturas e recebimento de reembolso sem renda livre;
- concorrência otimista por `expectedUpdatedAt`;
- rollback integral em falha composta;
- opcionalmente, consulta real em `/api/mcp` e rejeição do token opaco pela Data API.

Variáveis locais do teste:

```text
MCP_STAGING_CONFIRM=isolated-synthetic-only
MCP_STAGING_EXPECTED_PROJECT_REF=zoafgwedojkpyptvmpgt
MCP_STAGING_SUPABASE_URL=https://zoafgwedojkpyptvmpgt.supabase.co
MCP_STAGING_SUPABASE_ANON_KEY=
MCP_STAGING_SERVICE_ROLE_KEY=
MCP_STAGING_USER_A_EMAIL=
MCP_STAGING_USER_A_PASSWORD=
MCP_STAGING_USER_B_EMAIL=
MCP_STAGING_USER_B_PASSWORD=
```

Para o ensaio HTTP, adicione `MCP_STAGING_BASE_URL` e um token opaco emitido
pelo próprio broker em `MCP_STAGING_ACCESS_TOKEN_A`.

### Resultado validado em 2026-10-09

- dois usuários sintéticos e auto-confirmados foram criados somente no staging;
- cada usuário leu apenas a própria fixture financeira;
- update cruzado afetou zero linhas e preservou o registro do outro usuário;
- `mcp_action_requests` e `mcp_oauth_records` responderam `403` pela Data API;
- usuário errado e assinatura adulterada não aprovaram a proposta;
- aprovação válida criou uma compra e exatamente um evento de auditoria;
- repetição devolveu o mesmo resultado sem duplicar compra ou auditoria;
- proposta expirada falhou e duplicidade retornou conflito com rollback integral;
- Security Advisor: zero erros e um aviso intencional para a RPC atômica;
- Performance Advisor: alertas herdados de inicialização de `auth.uid()` nas
  policies antigas, sem falha de isolamento nos ensaios acima.

### Escritas diretas validadas em 2026-10-10

- a migration de escrita direta foi aplicada somente em
  `zoafgwedojkpyptvmpgt`;
- criação e edição passaram para despesas, receitas, lançamentos, compras
  planejadas, metas e reembolsos com dados inteiramente fictícios;
- o lançamento recalculou o total da fatura na mesma transação;
- recebimento parcial criou uma única entrada com `inflow_kind=reimbursement`,
  sem renda livre;
- replay retornou o mesmo `operationId`, sem novo registro ou auditoria;
- chave reaproveitada com outros argumentos e timestamp desatualizado falharam;
- falha depois de inserir um lançamento reverteu lançamento, auditoria,
  idempotência e total da fatura;
- Beta não leu nem alterou dados de Alpha; tentativa direta pela Data API foi
  bloqueada pela RLS;
- `authenticated` não executa `mcp_execute_direct_write_v1`; somente o servidor
  com `service_role` executa a RPC para o usuário validado pelo OAuth;
- fatura quitada recusou alteração sem confirmação e aceitou somente a frase
  explícita, registrando essa confirmação na auditoria;
- o fluxo legado de aprovação foi revogado para `authenticated`, sem apagar
  registros históricos;
- nenhum banco ou dado de produção foi alterado.

### OAuth e MCP HTTP validados em 2026-10-09

- Authorization Code com PKCE S256, login Supabase e consentimento explícito
  completaram usando o cliente e callback oficiais do ChatGPT;
- a troca retornou somente tokens opacos `mcp_at_*` e `mcp_rt_*`;
- `initialize` negociou o protocolo `2025-06-18`;
- `tools/list` publicou 14 consultas e nenhuma ferramenta de escrita com
  `MCP_ENABLE_WRITES=false`;
- `hub_get_financial_summary` e `hub_list_accounts` responderam com o usuário
  Alpha, e a listagem não continha registros do usuário Beta;
- o token opaco do MCP foi recusado pela Data API do Supabase com `401`;
- o refresh token foi rotacionado e sua reutilização retornou `400`;
- revogar o access token invalidou a concessão inteira: access token atual,
  access token anterior e refresh token passaram a ser recusados;
- nenhum token, senha ou chave privada foi persistido na documentação ou nos
  logs de resultado do teste.

O ensaio publicado pode ser repetido com `npm run test:mcp:public`. Ele recebe
URL pública, URL/chave publicável do Supabase e credenciais dos dois usuários
sintéticos somente por variáveis do processo. O script não imprime tokens nem
senhas e revoga as concessões ao terminar.

### Publicacao HTTPS validada em 2026-10-09

- URL estavel: `https://hub-vz-mcp-staging.vercel.app`
- MCP: `https://hub-vz-mcp-staging.vercel.app/api/mcp`
- Login e consentimento: iniciado por
  `https://hub-vz-mcp-staging.vercel.app/oauth/authorize`
- deployment validado: `dpl_6xYR7HcGmh2BRFssMbszY8FH45f6`
- deployment protection da Vercel: desativada somente no projeto de staging;
  a autenticacao OAuth propria do Hub continua obrigatoria
- build Next.js remoto: aprovado
- discovery OAuth e protected resource metadata: `200`
- chamada MCP sem token: `401` com `WWW-Authenticate`
- Authorization Code + PKCE S256: aprovado para Alpha e Beta
- `tools/list`: 14 consultas e zero ferramentas de escrita
- consultas financeiras ficticias: aprovadas com isolamento entre Alpha e Beta
- token opaco recusado pela Data API: `401`
- access token expirado: recusado pelo MCP
- refresh rotativo, replay e revogacao da concessao: aprovados
- logs de erro do deployment validado: nenhum registro

## Checklist para conectar ao ChatGPT

### Teste real no ChatGPT em 2026-10-10

O aplicativo privado `Hub VZ — Staging MCP` foi conectado via OAuth com o usuario
ficticio Alpha. A descoberta inicialmente falhava porque o servidor rejeitava
versoes recentes do protocolo. A correcao de negociacao foi publicada somente
no projeto Vercel `hub-vz-mcp-staging`, deployment
`dpl_D9YUkJ41iRmMfw86rqKvBV9nkp9B`, com build remoto aprovado.

Depois de atualizar as ferramentas nas configuracoes do ChatGPT, uma conversa
Work executou `hub_get_financial_summary` e `hub_list_accounts` e retornou:

- periodo: 01/10/2026 a 31/10/2026;
- receita ficticia prevista: R$ 2.500,00;
- conta ficticia MCP Alpha pendente: R$ 123,45, vencimento 15/10/2026;
- saldo projetado: R$ 2.376,55;
- nenhuma escrita financeira executada.

Conversa de verificacao: https://chatgpt.com/c/6ac9bc91-e20c-83e9-a264-d6eeac079998.
O teste autenticado anterior listou as 14 ferramentas. Neste teste dentro do
ChatGPT foram executadas duas consultas; os demais modulos nao foram consultados
individualmente. `npm run test:mcp` passou com 12 testes, incluindo negociacao de
protocolo, e `npm run lint` passou. Nenhuma migration, commit, push ou alteracao
de producao foi realizada nesta correcao.

As 13 ferramentas de escrita direta foram validadas no banco de staging, mas
ainda dependem de novo deploy do projeto Vercel de staging e reconexão do
aplicativo no ChatGPT para conceder o escopo `mcp:write`. O deployment publicado
acima permanece somente leitura até essa publicação ocorrer.

### Senha do usuario ficticio Alpha

O helper local `tmp/reset-alpha-staging.ps1` usa um formulario com campos
mascarados e o Supabase Auth Admin exclusivamente no projeto
`zoafgwedojkpyptvmpgt`. A chave secreta e a nova senha ficam em memoria;
o resultado persistido contem somente sucesso/erro e a quantidade de ferramentas.
Nenhum segredo deve ser enviado pelo chat ou salvo em arquivo.

As chamadas administrativas usam o User-Agent
`hub-vz-staging-password-reset/2.0`. O User-Agent padrao do Windows PowerShell
inclui `Mozilla/5.0`: o gateway do Supabase interpreta esse cliente como navegador
e bloqueia chaves `sb_secret` com HTTP 401 e
`UNAUTHORIZED_INVALID_API_KEY_TYPE`. A [documentacao de API keys](https://supabase.com/docs/guides/getting-started/api-keys)
explica esse bloqueio. A verificacao inicial consulta apenas o ID autorizado
do Alpha, sem listar os demais usuarios e sem alterar senha.

Depois da redefinicao, `tmp/validate-alpha-oauth.mjs` valida login, PKCE S256,
consentimento, troca de token, as 14 ferramentas de leitura e o resumo financeiro.
O teste revoga a concessao OAuth ao terminar. O clique final em Redefinir e feito
pelo usuario no formulario local.

### Etapas de conexao

Na pagina do plugin, o controle circular ao lado do aplicativo pode aparecer
como `Continuar conectando o aplicativo`: ele retoma o login e consentimento.
A conexao esta confirmada quando Configuracoes mostra uma conta conectada e
`Autorizacao usada: OAuth`. Para testar no ChatGPT web, use **Work**, selecione
o Hub VZ pelo menu `@` e solicite uma consulta. O [quickstart oficial](https://developers.openai.com/plugins/quickstart)
orienta esse fluxo. Se as ferramentas nao aparecerem, use `Atualizar ferramentas`
nas configuracoes do aplicativo e confira a compatibilidade do handshake.

1. Manter as 47 migrations apenas no Supabase de staging até autorização de produção.
2. Configurar `MCP_ENABLE_WRITES=true` e `MCP_DIRECT_WRITES_READY=true` somente no projeto Vercel de staging.
3. Publicar o código atual no projeto `hub-vz-mcp-staging`.
4. Atualizar/reconectar o aplicativo privado no ChatGPT para conceder `mcp:write`.
5. Repetir criação, edição, replay e confirmação de fatura quitada pelo endpoint HTTPS.
6. Confirmar no ChatGPT que os resultados aparecem no Hub e continuam isolados entre Alpha e Beta.
7. Manter produção com ambas as flags de escrita desativadas até autorização expressa de migration e deploy.

