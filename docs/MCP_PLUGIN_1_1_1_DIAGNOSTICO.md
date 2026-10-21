# Hub VZ oficial: diagnóstico OAuth e candidata 1.1.1

Data: 13/10/2026, America/Cuiaba. O diagnóstico abaixo registra a preparação;
a publicação autorizada foi concluída depois, conforme o resultado a seguir.

## Resultado da publicação autorizada

- Plugin existente atualizado: `plugins_6aca5085e5ec8191979e7f79bee62d7f`.
- Versão atual confirmada por leitura após publicação: `1.1.1`.
- Release atual: `pluginrel_6ace44177ed08191b6b99b4b6bcc3f7e`.
- [Abrir Hub VZ — Oficial](https://chatgpt.com/plugins/plugins_6aca5085e5ec8191979e7f79bee62d7f).
- Os seis arquivos publicados correspondem exatamente à candidata aprovada.
  OAuth/CIMD, os três escopos e a descoberta automática foram confirmados nos
  dois arquivos MCP. A habilidade e o ícone permanecem iguais.
- Escopo `USER` e visibilidade `PRIVATE` preservados. Nenhum outro plugin foi
  criado. Vercel, Supabase, banco e dados financeiros não foram alterados.
- Registro da verificação: `tmp/hub-vz-official-oauth-1.1.1/publication-receipt.json`.
- A autorização OAuth no ChatGPT e a disponibilidade real das 75 ferramentas
  continuam pendentes de reconexão e de chamada autenticada. A release atual
  da conta não comprova que uma conversa já aberta tenha recarregado a versão.

No ChatGPT, abrir o plugin atualizado e iniciar a conexão ou reconexão da conta.
Concluir login e consentimento. Depois selecionar o plugin em uma nova conversa
e solicitar a listagem de pessoas em modo somente leitura; validar também que
o `tools/list` autenticado retorna as 75 ferramentas previstas. Não é necessário
recriar o plugin nem o servidor.

## Conclusão

A versão instalada 1.1.0 não declara autenticação em `mcp.json` nem no arquivo
de compatibilidade `.mcp.json`. A documentação oficial orienta declarar OAuth
em `mcpServers.<servidor>.extensions["com.openai"].auth`. A candidata acrescenta
essa configuração com CIMD e os escopos anunciados pelo servidor existente.

É uma lacuna confirmada no pacote e uma causa provável da ausência de um novo
fluxo de conexão depois da reinstalação. Não há rastreamento interno do host
que prove que ela seja a única causa das zero ferramentas. O endpoint já
desafia corretamente chamadas sem token; não foi encontrada necessidade de
recriar ou alterar o backend para preparar esta correção.

## Identidade e fonte

Fonte da candidata: todos os seis arquivos retornados pelo leitor de arquivos
da versão publicada 1.1.0, preservando metadados, instruções e ativos.

| Campo | Valor |
| --- | --- |
| Plugin a atualizar | `plugins_6aca5085e5ec8191979e7f79bee62d7f` |
| Nome | `hub-vz-official` |
| Release de referência | `pluginrel_6aca71dbb8548191862dddc64ea3c25e` |
| Escopo e visibilidade | `USER`, `PRIVATE` |
| Versão atual / candidata | `1.1.0` / `1.1.1` |
| Servidor | `hub-vz-official` |
| Endpoint | `https://hub.vezetiv.dev/api/mcp` |

Há também uma entrada App-backed distinta, de versão 1.0.0:
`plugin_asdk_app_6aca52a8dda48191a140827e184f4495`, vinculada a
`asdk_app_6aca52a8dda48191a140827e184f4495`. Sua configuração não foi alterada.
Ela não deve ser confundida com o pacote 1.1.0. A configuração interna OAuth
do servidor registrado no host não está exposta pelos arquivos dessa entrada.

O diretório preexistente `plugins/hub-vz-official` contém trabalho local não
versionado e diferenças em relação à release da conta. Ele foi preservado;
a candidata foi preparada separadamente em `tmp/hub-vz-official-oauth-1.1.1`.

## Evidências do servidor e do banco

Consultas somente leitura no projeto oficial `vrovfsfkhxnuleoyjzde`, sem ler
payloads criptografados, hashes de credenciais ou dados financeiros:

- Nenhum registro `access` ou `refresh` com status `active`.
- 50 registros `access` revogados; 48 `refresh` consumidos e 2 revogados.
- Os últimos registros de acesso/refresh revogados têm timestamps de
  13/10/2026 às 09:55:11 MT (13:55:11 UTC). A consulta agregada não demonstra
  isoladamente o instante de cada revogação.
- Último código de autorização criado em 10/10/2026 às 13:21:03 MT
  (17:21:03 UTC); os dois códigos existentes estão consumidos.
- Há quatro registros de fluxo com status `active`, todos expirados.

Testes públicos realizados diretamente em produção:

| Verificação | Resultado |
| --- | --- |
| Descoberta do servidor OAuth | HTTP 200; issuer `https://hub.vezetiv.dev` |
| Metadados do recurso protegido | HTTP 200; resource `https://hub.vezetiv.dev/api/mcp` |
| CIMD | `client_id_metadata_document_supported: true` |
| PKCE | `code_challenge_methods_supported: ["S256"]` |
| Método de autenticação do cliente | `token_endpoint_auth_methods_supported: ["none"]` |
| Concessões | `authorization_code`, `refresh_token` |
| `initialize` sem token | HTTP 401 com desafio Bearer |
| `tools/list` sem token | HTTP 401 com o mesmo desafio Bearer |

O `WWW-Authenticate` recebido aponta para
`https://hub.vezetiv.dev/.well-known/oauth-protected-resource/api/mcp` e pede
`mcp:read mcp:write`. A descoberta OAuth e a do recurso protegido anunciam,
na mesma ordem, `mcp:read`, `offline_access`, `mcp:write`. A ausência de
`offline_access` no desafio de acesso ao recurso não é uma divergência no
pacote: esse escopo é solicitado na autorização para renovação da conexão.

O documento CIMD público atual `https://chatgpt.com/oauth/client.json` respondeu
HTTP 200, anuncia os métodos `none` e `private_key_jwt` e inclui o callback
`https://chatgpt.com/connector_platform_oauth_redirect`. A preferência singular
legada é `private_key_jwt`; a implementação local considera o campo plural e
aceita a interseção `none`, como orienta a documentação atual.

## Correção proposta

Adicionar, dentro do servidor existente, em `mcp.json` e `.mcp.json`:

```json
"extensions": {
  "com.openai": {
    "auth": {
      "type": "oauth",
      "client": { "mode": "cimd" },
      "baseScopes": ["mcp:read", "offline_access", "mcp:write"]
    }
  }
}
```

Os escopos da candidata foram comparados automaticamente com os dois documentos
de descoberta e coincidem exatamente. Não foram incluídos `clientId`, segredos,
tokens, endpoints substitutos ou configuração DCR. Os endpoints OAuth continuam
a ser obtidos pela descoberta existente.

Atualizar apenas `version` para `1.1.1` em `plugin.json` e
`.codex-plugin/plugin.json`. Nome, descrições, prompts, autoria, habilidades,
ícone, transporte e URL permanecem iguais à release de referência. A habilidade
e o ícone foram comparados byte a byte. O catálogo no código local continua com
75 nomes únicos: 25 ferramentas de leitura e 50 de escrita. Não houve alteração
nas definições nem na execução das ferramentas do servidor.

## Artefatos

- ZIP completo: `tmp/hub-vz-official-oauth-1.1.1/hub-vz-official-1.1.1.zip`.
- Fonte candidata: `tmp/hub-vz-official-oauth-1.1.1/candidate/hub-vz-official/`.
- Cópia da fonte 1.1.0: `tmp/hub-vz-official-oauth-1.1.1/baseline/hub-vz-official/`.
- Identidade e trava de release: `tmp/hub-vz-official-oauth-1.1.1/update-identity.json`.
- Evidência de comparação, descoberta e catálogo:
  `tmp/hub-vz-official-oauth-1.1.1/validation.json`.

SHA-256 do ZIP:
`17e44c3b8125270de2b9ae74f01877bae1fcce6175eb74c062ce8b8d8195f040`.

## Validação executada

| Comando ou verificação | Resultado |
| --- | --- |
| `npm run lint` | Aprovado, saída 0 |
| `npm run build` | Aprovado, saída 0 |
| `npm run test:mcp` | 16 testes aprovados, saída 0 |
| `node scripts/validate-mcp-production-readonly.mjs` | Descoberta e desafio aprovados; etapa autenticada pulada por ausência de token |
| Comparação dos arquivos da candidata | Apenas quatro arquivos alterados; versões e OAuth conforme acima |
| Política OAuth local com documento CIMD público | Aceita cliente atual, callback, resource, S256 e os três escopos |
| Inspeção do ZIP | Seis arquivos, incluindo os arquivos de compatibilidade ocultos |

O teste da política foi local e não enviou uma nova solicitação de autorização
ao Hub. Não foram emitidos tokens nem exercitadas escritas financeiras.

## Etapa restante após autorização da atualização

1. Ler novamente a release atual; se mudou, reconciliar a candidata antes de
   publicar. Usar o mesmo plugin ID e a trava `expected_release_id`; não criar
   outro plugin nem outro servidor registrado.
2. Atualizar a release existente com o ZIP e verificar por leitura os quatro
   arquivos alterados, a identidade e a versão.
3. No host ChatGPT, conferir que a conexão é OAuth/CIMD e iniciar a reconexão.
   O usuário deve concluir o login e o consentimento pelos três escopos.
4. Verificar o callback com `iss` e `state`, a troca do código com PKCE e o
   token vinculado ao recurso; manter credenciais fora de relatórios e logs.
5. Executar `initialize`, `notifications/initialized` e `tools/list` autenticados,
   confirmar 75 nomes únicos e consultar `hub_list_people` somente leitura.
6. Se as ferramentas continuarem ausentes, inspecionar a conexão OAuth do
   servidor registrado no host e seus erros de autorização antes de propor
   outra mudança de pacote ou backend.

O fluxo completo e as 75 ferramentas em produção autenticada ainda não foram
validados nesta investigação. A contagem 75 é do código local preservado, não
um `tools/list` autenticado novo. Publicar a candidata sem esta distinção não
comprovaria o restabelecimento da conexão.

Nenhuma publicação, push, migração, mudança de backend ou alteração financeira
foi executada. Nenhuma dependência foi adicionada.

## Referências oficiais

- [Empacotamento e configuração OAuth/CIMD](https://developers.openai.com/plugins/build/plugins)
- [Autenticação, desafio Bearer e metadados CIMD](https://developers.openai.com/plugins/build/auth)
