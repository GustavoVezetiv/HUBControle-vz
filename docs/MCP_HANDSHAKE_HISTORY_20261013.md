# Hub VZ: comparação histórica do handshake e do catálogo MCP

Data da inspeção: 13/10/2026, America/Cuiaba. Comparação somente leitura do
Git, arquivos locais, fontes de deployments existentes e metadados públicos.
Este documento não registra um novo deploy nem comprova uma conexão OAuth nova.
Os hashes correspondem à fonte anterior ao patch local dos desafios de ferramenta
preparado depois desta inspeção; a produção não foi modificada.

## Evidência dos deployments existentes

A API autenticada da Vercel confirmou os seguintes deployments, sem modificar
configuração, domínios, variáveis ou código publicado:

| Ambiente / papel | Deployment | Criado em MT | Estado / fonte |
| --- | --- | --- | --- |
| Produção atual, alias `hub.vezetiv.dev` | `dpl_HvRrUyJCWZ2zcnybeSuKkzMfeDJV` | 10/10/2026 13:08:35 | `READY`, CLI |
| Produção imediatamente anterior | `dpl_6TpnTL4199X7eFxLdTi49hV1aSzB` | 10/10/2026 11:15:01 | `READY`, build sem fonte recuperável nesta inspeção |
| Staging com teste ChatGPT documentado | `dpl_D9YUkJ41iRmMfw86rqKvBV9nkp9B` | 10/10/2026 00:23:47 | `READY`, CLI |

URLs imutáveis retornadas pela API:

- Atual: `financeiro-9uz43be39-vezetivs-projects.vercel.app`.
- Produção anterior: `financeiro-2mbvlwt1g-vezetivs-projects.vercel.app`.
- Staging testado: `hub-vz-mcp-staging-qwjqqi79o-vezetivs-projects.vercel.app`.

O deployment atual usa metadados Git da branch `codex/hub-mcp`, commit
`fd3f203ebaa99586ce3538071c2f67e9ab3f1329`. Isso não significa que o MCP está nesse
commit: os arquivos MCP permanecem locais e não versionados. A consulta
`git log --all -- src/features/mcp src/app/api/mcp plugins/hub-vz-official` não
retornou commits. A publicação CLI incluiu esses arquivos locais.

## A negociação de protocolo anterior já corrigida foi preservada

`docs/MCP_STAGING.md`, linhas 260–283, registra que a descoberta no ChatGPT
inicialmente falhava por rejeição de versões recentes do protocolo. A correção
foi publicada no staging `dpl_D9YUkJ41iRmMfw86rqKvBV9nkp9B`; depois dela duas
consultas funcionaram dentro do ChatGPT. O teste autenticado anterior listou
14 ferramentas de leitura. As 13 escritas ainda dependiam do próximo deploy e
de consentimento para `mcp:write`, conforme linhas 284–288.

O arquivo `src/features/mcp/protocol.ts` foi recuperado pela API de arquivos
dos deployments atual e staging testado usando o mesmo identificador SHA-1:

```text
4878649bcddbcbcd2a1565dd652d2ce62c8d8649
```

Os conteúdos completos retornados para esse arquivo são iguais. Ambos:

- aceitam `2025-11-25`, `2025-06-18` e `2025-03-26`;
- negociam a versão mais recente suportada quando o pedido não é reconhecido;
- deixam `initialize` negociar independentemente do cabeçalho;
- validam o cabeçalho de versão nas chamadas seguintes, quando presente.

Portanto, há evidência direta de que a antiga correção de negociação está na
produção atual. Não foi encontrada uma regressão nesse arquivo que explique
o catálogo com zero ferramentas.

## O catálogo publicado contém 75 definições

Os seguintes identificadores SHA-1 dos arquivos locais foram encontrados pela
API de conteúdo no deployment de produção atual:

| Arquivo | SHA-1 |
| --- | --- |
| `src/app/api/mcp/route.ts` | `4ab8cabb37043923a706a7602aebdc44c2b5b56b` |
| `src/features/mcp/auth.ts` | `557b455f1ffe96528164151313240d903e8c4e5d` |
| `src/features/mcp/tools.ts` | `3fc403dfc0ecc6890595ecdcc47de0eb6d34b594` |
| `src/features/mcp/module-tools.ts` | `b8874fa631cc43be5be8094d05726d72df6a85f9` |

O leitor MCP de arquivos limita strings longas; os retornos desses quatro
arquivos vieram parcialmente truncados. A presença de seus identificadores
no deployment foi confirmada; o catálogo foi contado na fonte local
correspondente. Essa verificação da fonte não substitui `tools/list` autenticado.

Em `src/features/mcp/tools.ts`, linhas 60–155, a base contém 27 definições:
14 leituras e 13 escritas. Em `src/features/mcp/module-tools.ts`, o incremento
contém 48 definições: 11 leituras e 37 escritas. A concatenação em
`src/features/mcp/tools.ts:155` produz 75 ferramentas: 25 leituras e 50 escritas.
As ferramentas solicitadas `hub_list_people`, `hub_list_categories`,
`hub_archive_record` e `hub_import_subscriptions` pertencem ao incremento.

O catálogo histórico de 27 coincide exatamente com a quantidade da base. Na
inspeção do host feita pela investigação principal, o servidor registrado
existente `asdk_app_6aca52a8dda48191a140827e184f4495` ainda mostrava 14 leituras
e 13 escritas. Isso prova uma diferença entre o catálogo registrado no host
e a fonte publicada atual, sem provar sozinho por que o host não o atualizou.

## Restrições do servidor que afetam a descoberta

Referências abaixo são às linhas da fonte inspecionada antes de qualquer
correção desta investigação:

- `src/app/api/mcp/route.ts:29` autentica antes de ler o método JSON-RPC.
  Assim, `initialize` e `tools/list` sem token recebem o mesmo bloqueio HTTP
  que uma consulta privada. O catálogo não chega ao cliente nesse caminho.
- `src/app/api/mcp/route.ts:33` inclui `WWW-Authenticate` em respostas 401.
  O corpo é `{ error: ... }`, sem resultado MCP de ferramenta nem
  `_meta["mcp/www_authenticate"]`.
- `src/app/api/mcp/route.ts:67` devolve todas as 75 ferramentas quando as
  flags de escrita estão ativas; caso contrário, devolve as 25 leituras.
  Esse filtro não pode produzir zero ferramentas.
- Os helpers de descritores em `src/features/mcp/tools.ts:51` e `:56`, e
  `src/features/mcp/module-tools.ts:33` e `:39`, declaram OAuth por ferramenta.
  Leitura usa `mcp:read`; escrita usa `mcp:read` e `mcp:write`.
- Não há `openai/visibility`, restrição de visibilidade somente ao aplicativo
  ou outro filtro que esconda o catálogo do modelo na fonte inspecionada.
- As falhas de escopo dentro de `callTool` viram erro textual em
  `src/app/api/mcp/route.ts:103`, sem desafio OAuth em `_meta`.

A documentação oficial orienta combinar metadados por ferramenta, Protected
Resource Metadata e desafios `_meta["mcp/www_authenticate"]` para disparar a
interface OAuth por ferramenta. A falta desses desafios é uma incompatibilidade
concreta do caminho de erro por ferramenta. O 401 de transporte, por si só,
não estabelece que o ChatGPT esteja iniciando a vinculação neste plugin.

## Limites da comparação histórica

- Não existe histórico Git dos arquivos MCP para um diff completo 27 → 75.
- A árvore de fonte retornada pelo leitor da Vercel trunca depois de quatro
  níveis; não expôs os identificadores dos arquivos profundos antigos. Foi
  possível confirmar o protocolo idêntico usando seu identificador conhecido.
- O deployment de produção imediatamente anterior expõe o build, mas não uma
  árvore de fonte recuperável por esse leitor. Consultar nele o identificador
  conhecido de `protocol.ts` retornou 404; isso não demonstra ausência do
  protocolo no build.
- A comparação antiga autenticada não foi repetida nesta subtarefa. Não foram
  emitidos, lidos, impressos ou renovados tokens.
- O plano Hobby da Vercel recusou a janela de logs de três horas por retenção.
  A consulta agregada dos últimos 50 minutos não trouxe linhas. Logs de
  aplicação vazios não provam ausência de requests HTTP ou de tentativas do
  ChatGPT, e não permitem atribuir uma falha interna ao cliente.
- O sintoma do pacote 1.1.1 e o catálogo antigo registrado são evidência do
  estado do host. A causa final requer a validação de reconexão e a chamada
  autenticada no host, conduzidas pela investigação principal.

Nenhum deploy, alteração de Vercel/Supabase/plugin, login, migração, push ou
escrita financeira foi executado por esta comparação. A única alteração local
foi criar este documento de evidências.

## Referências

- [Autenticação MCP e disparo de OAuth por ferramenta](https://developers.openai.com/plugins/build/auth).
- [Troubleshooting oficial](https://developers.openai.com/plugins/deploy/troubleshooting).
- `docs/MCP_STAGING.md` e `docs/MCP_PRODUCTION.md` para os testes e deployments
  anteriormente documentados.
