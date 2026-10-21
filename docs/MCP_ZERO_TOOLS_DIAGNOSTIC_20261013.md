# Hub VZ: catálogo vazio, vínculo do plugin e desafios OAuth

Data: 13/10/2026, America/Cuiaba. A versão publicada continua 1.1.1.
Correções preparadas localmente; publicação pendente. A conexão registrada
passou no teste real após o usuário concluir o OAuth, conforme abaixo.

## Resultado do teste real após o login do usuário

Em 13/10/2026, o usuário concluiu login e consentimento no fluxo iniciado pelo
ChatGPT para o aplicativo existente. A consulta agregada de estados OAuth
confirmou novo código consumido às 15:34:48 UTC (11:34:48 MT), dois registros
de acesso ativos e um de renovação ativo. Nenhum segredo/payload foi lido.

Nas configurações do ChatGPT, a mesma conexão passou a aparecer como conectada
com OAuth. Foi executado “Atualizar ferramentas” no aplicativo existente.
O catálogo real passou de 27 para 75: 25 leituras e 50 escritas. Os quatro nomes
solicitados estavam presentes: `hub_list_people`, `hub_list_categories`,
`hub_archive_record`, `hub_import_subscriptions`.

Em seguida, “Testar no chat” abriu um teste com esse aplicativo selecionado.
Foi solicitada somente `hub_list_people` com `limit=1`, proibindo escritas e
exibição de dados privados. A atividade informou “Listando pessoas cadastradas
no Hub VZ Oficial”; a resposta final foi “A consulta autenticada funcionou.”

- [Teste concluído no ChatGPT](https://chatgpt.com/c/6ace5038-ea74-83e9-b105-1a29175f415a).
- Registro sem dados privados: `tmp/hub-vz-mcp-fix-1.1.2/live-oauth-test-receipt.json`.

Este resultado comprova o fluxo real da conexão registrada: autorização,
renovação do catálogo, ferramentas visíveis no host e consulta somente leitura.
A leitura de logs Vercel disponíveis não forneceu um registro bruto de HTTP
200, e o Inspector não recebeu o token privado do host. Não se afirma que
esses dois ensaios adicionais tenham ocorrido.

O pacote standalone 1.1.1 ainda não foi atualizado com o vínculo e esta
conversa Codex ainda expõe zero ferramentas Hub. A candidata 1.1.2 e o patch
de desafios permanecem aguardando a autorização de publicação já solicitada.
Nenhum deploy, publicação ou alteração financeira foi feito para obter esse
resultado.

## Problema de vínculo confirmado

O pacote `plugins_6aca5085e5ec8191979e7f79bee62d7f` tem uma habilidade e uma
configuração HTTP portátil, mas não contém `.app.json` nem a referência
`extensions["com.openai"].apps`. Portanto, não vincula o aplicativo MCP
registrado que o ChatGPT utiliza para carregar ferramentas e autorizar a conta.

A declaração OAuth acrescentada na 1.1.1 está correta, mas não cria esse vínculo.
A documentação oficial distingue `mcp.json` portátil do vínculo ao servidor
registrado em `.app.json`. Com um objeto `extensions["com.openai"]` no manifesto
raiz, os campos do manifesto de compatibilidade não são mesclados; o vínculo
precisa existir também no manifesto efetivo.

Evidência na mesma conta do Chrome:

1. A página do pacote 1.1.1 mostra um servidor HTTP genérico e a habilidade.
2. A página da conexão original, `plugin_asdk_app_6aca52a8dda48191a140827e184f4495`,
   mostra um aplicativo registrado, o botão “Instalar plugin” e o catálogo
   armazenado de 27 ferramentas: 14 de leitura e 13 de escrita.
3. Ao iniciar a conexão dessa entrada existente, sem criar outro plugin ou
   servidor, o ChatGPT abriu o login oficial em `hub.vezetiv.dev/oauth/connect`.
   Esse contraste demonstra que o endpoint atual permite iniciar OAuth pela
   conexão registrada. O pacote 1.1.1 não usa essa conexão.
4. Na inspeção inicial o login estava pendente. O usuário depois o concluiu;
   a evidência autenticada está registrada no resultado acima. Credenciais
   não foram fornecidas ao agente nem lidas.

O vínculo ausente é um defeito comprovado na integração do pacote. A verificação
completa da correção no mesmo ID ainda exige publicação autorizada e teste no
host; não se declara que a integração já foi resolvida.

## O 401 inicial é válido

`initialize` e `tools/list` sem token retornam HTTP 401 em produção. O desafio
Bearer contém o URL canônico do Protected Resource Metadata, os escopos de
acesso e `invalid_token` com descrição. Ambos os metadados protegidos, raiz e
caminho `/api/mcp`, e os metadados do authorization server retornam HTTP 200.

O recurso é `https://hub.vezetiv.dev/api/mcp`; o issuer é
`https://hub.vezetiv.dev`. CIMD, autenticação pública do cliente `none`, PKCE
S256 e os escopos `mcp:read`, `offline_access`, `mcp:write` são consistentes.
O documento CIMD atual do ChatGPT inclui o callback esperado e o método `none`.

O OAuth abriu na conexão original sem qualquer mudança no 401 ou nos metadados.
Não há motivo comprovado para liberar discovery anonimamente, mudar para
`mixed`, aceitar tokens administrativos ou ampliar a allowlist de clientes.

## Inspector e comparação histórica

O MCP Inspector oficial 2.5.0 foi executado em cache temporário de tooling,
sem adicionar dependências ao projeto. Sua credencial e seu armazenamento OAuth
foram isolados. Com `--stored-auth-only`, os dois comandos abaixo retornaram
saída 3, `auth_required`, contra o endpoint de produção:

```powershell
npx --yes @modelcontextprotocol/inspector@2.5.0 --cli --transport http --server-url https://hub.vezetiv.dev/api/mcp --connect-timeout 10000 --stored-auth-only --format json --method initialize
npx --yes @modelcontextprotocol/inspector@2.5.0 --cli --transport http --server-url https://hub.vezetiv.dev/api/mcp --connect-timeout 10000 --stored-auth-only --format json --method tools/list
```

O OAuth independente do Inspector usa callback loopback. O Hub aceita somente
o client ID CIMD e callback oficiais do ChatGPT, de propósito. Essa restrição
foi preservada; não se simulou a identidade ChatGPT para gerar tokens.

Em um servidor HTTP local, o Inspector executou a rota e o catálogo reais com
identidade simulada: `initialize` e `tools/list` tiveram saída 0 e o catálogo
continha 75 ferramentas, incluindo `hub_list_people`, `hub_list_categories`,
`hub_archive_record` e `hub_import_subscriptions`. Nenhum handler de dados foi
executado por esses dois comandos. Isso verifica protocolo e catálogo, mas
não substitui OAuth, Supabase/RLS ou o host ChatGPT em produção.

[Comparação dos deployments e hashes de fonte](MCP_HANDSHAKE_HISTORY_20261013.md):
a negociação de versões é idêntica no staging anteriormente funcional e na
produção. A fonte de produção contém 27 ferramentas base e 48 adicionais.
O filtro de escritas devolve 75 ou 25 leituras, nunca zero. O aplicativo
registrado ainda mostra um snapshot de 27 e deve ter o catálogo atualizado
após a reconexão. Não foi possível recuperar toda a fonte do deployment
anterior com 27 para um diff integral; essa limitação está registrada.

## Correção mínima do pacote: candidata 1.1.2

O ZIP `tmp/hub-vz-mcp-fix-1.1.2/hub-vz-official-1.1.2.zip` contém:

- Os seis arquivos da release 1.1.1, sem remover componentes.
- Novo `.app.json` copiado da conexão registrada existente:

```json
{
  "apps": {
    "dev-6aca52a8dda48191a140827e184f4495": {
      "id": "asdk_app_6aca52a8dda48191a140827e184f4495"
    }
  }
}
```

- `extensions["com.openai"].apps: "./.app.json"` no manifesto raiz e
  `apps: "./.app.json"` no manifesto de compatibilidade.
- Apenas o número da versão muda para 1.1.2 nos dois manifestos.

Os dois arquivos MCP, habilidade e ícone são byte a byte iguais à release
1.1.1. OAuth permanece obrigatório com CIMD, scopes e discovery automático.
Não há mudança em PKCE, tokens, RLS, endpoint, autoria, descrições ou prompts.

Publicação proposta no mesmo ID `plugins_6aca5085e5ec8191979e7f79bee62d7f`,
usando `expected_release_id: pluginrel_6ace44177ed08191b6b99b4b6bcc3f7e` após
ler novamente a release atual. Escopo USER e visibilidade PRIVATE preservados.

SHA-256 do ZIP:
`05bac26535ed945ed24d6c30e7586aa0ddb0c3c2046979cc795a7a393af45b9c`.

## Correção adicional da resposta de autenticação por ferramenta

Na rota publicada, chamadas sem token válido terminam em 401 simples e falhas
de escopo retornam somente texto com `isError`. Nenhuma carrega
`_meta["mcp/www_authenticate"]`, exigido pelo fluxo OAuth por ferramenta.

A mudança local é limitada a `src/app/api/mcp/route.ts` e
`src/features/mcp/auth.ts`:

- Interpretar e validar o envelope JSON-RPC antes de responder ao desafio.
- Preservar HTTP 401 e `WWW-Authenticate` em `initialize` e `tools/list` sem token.
- Em `tools/call` sem token válido, responder com resultado MCP `isError` e
  `_meta["mcp/www_authenticate"]` contendo `invalid_token`. A resposta HTTP 200
  transporta o erro de autenticação, sem executar a ferramenta.
- Em escopo insuficiente, responder com `insufficient_scope`, metadata,
  descrição e os escopos declarados pela ferramenta, antes de validar argumentos
  ou executar o handler.
- Preservar erros de serviço 500, gates de escrita, origem, schema, protocolo
  e a resolução de identidade já existente.

Nenhum acesso a dados acontece no resultado de desafio. A validação de token,
vínculo ao usuário/recurso, expiração, revogação e RLS não foi modificada.
Esse bug é adicional ao vínculo ausente; sua correção exige atualização do
deployment existente se autorizada, não um novo backend ou novas variáveis.

## Validação

| Verificação | Resultado |
| --- | --- |
| `node scripts/validate-hub-plugin-binding.mjs` na 1.1.1 | Falha esperada: vínculo efetivo ausente |
| Mesmo validador na candidata 1.1.2 | Aprovado |
| Runtime antes da correção de desafios | 13/18 aprovados; 5 falhas reproduzidas |
| `node --test tests/mcp-auth-route.test.mjs` após correção | 21/21 aprovados |
| `npm run test:mcp` | 16/16 aprovados |
| `npm run lint` | Aprovado |
| `npm run build` | Aprovado |
| ESLint dos scripts/testes adicionados ou ajustados | Aprovado |
| Inspector de produção sem token | `auth_required`, em ambos os métodos |
| Inspector HTTP local, identidade simulada | Handshake aprovado, catálogo real 75 |
| `node scripts/validate-mcp-authenticated-discovery.mjs` | Não executou rede: falta credencial OAuth válida no ambiente; saída 1 explícita |

O teste antigo de autorização de escrita verificava um texto de implementação.
Foi ajustado para executar a rota com um grant simulado de leitura e comprovar
o desafio e zero execução de escrita; as demais verificações foram preservadas.

Artefatos de evidência, sem segredos:
`tmp/hub-vz-mcp-fix-1.1.2/inspector-production.json`,
`inspector-local-fixture.json`, `preservation-check.json`, `update-identity.json`.
Há cópias dos arquivos alterados em `source-backup/`. O diretório preexistente
do plugin e demais alterações do usuário foram preservados; não houve commit,
push, migração, deploy ou publicação nesta etapa.

## Teste real restante e autorização de publicação

O login e consentimento na conexão existente foram concluídos pelo usuário.
A atualização do catálogo confirmou 75 ferramentas e o teste somente leitura
de `hub_list_people` foi concluído no ChatGPT. Após a publicação autorizada da
candidata, repetir esse teste com o pacote atualizado selecionado para comprovar
também o vínculo no mesmo ID do pacote standalone.

O script `scripts/validate-mcp-authenticated-discovery.mjs` exige uma credencial
OAuth autorizada, inicializa o servidor, envia `notifications/initialized`,
confere os 75 nomes e todas as políticas OAuth, e consulta pessoas sem imprimir
resultados privados. Ele falha explicitamente quando não há token, em vez de
registrar a etapa autenticada como sucesso. Não extrair tokens criptografados do
banco, falsificar o cliente ChatGPT ou usar service role para esse teste.

Solicitar uma única autorização para a atualização do pacote no mesmo ID e,
se incluída na aprovação, o patch de desafios no deployment existente. Após
publicar, verificar os arquivos por leitura e concluir o teste no ChatGPT.
O deployment deve incluir somente as mudanças aprovadas, preservando trabalho
local não relacionado. Nenhum dado financeiro foi alterado.

## Fontes primárias

- [Pacote e vínculo ao aplicativo MCP registrado](https://developers.openai.com/plugins/build/plugins)
- [OAuth e desafios por ferramenta](https://developers.openai.com/plugins/build/auth)
- [Diagnóstico e atualização do catálogo](https://developers.openai.com/plugins/deploy/troubleshooting)
- [MCP Inspector CLI](https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md)
