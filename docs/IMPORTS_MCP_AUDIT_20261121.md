# HubVZ — Auditoria das integrações e conciliação pelo MCP

Auditoria realizada em 21/11/2026, pela sessão autenticada do proprietário em `hub.vezetiv.dev`. A versão ativa da aplicação era o commit `2261f5ce59054ea74a7ba7d2ca3662a4942b557c`, publicado em 15/11/2026 às 20h08 em Cuiabá. A versão instalada do plugin oficial era 1.1.1. A verificação usou as projeções de leitura da aplicação, sem reimportar backups, acionar o cron ou confirmar lançamentos.

## Produção

O backend publicado usa o bucket `hub-import-backups` em produção e recusa a leitura se o bucket estiver público. As consultas autenticadas devolveram os cinco backups Pluggy e o histórico Organizze. As coletas XP, Sicredi, Caixa e Mercado Pago e o backup Organizze antecedem o deployment ativo e continuaram legíveis nele. A coleta Nubank mais recente ocorreu depois desse deployment.

| Banco | Última coleta em Cuiabá | Janela da última coleta | Datas das movimentações disponíveis | Contas | Cartões | Faturas | Movimentações | Investimentos / movimentos de investimento |
|---|---|---|---|---:|---:|---:|---:|---:|
| Nubank | 16/11 09h44 | 02/10 a 16/11 | 29/09 a 13/11 | 1 | 1 | 13 | 71 | 100 / 11 |
| XP | 15/11 18h46 | 30/09 a 15/11 | 25/09 a 14/11 | 2 | 1 | 8 | 298 | 12 / 18 |
| Sicredi | 15/11 19h34 | 01/10 a 15/11 | 02/10 a 10/11 | 2 | 1 | 8 | 14 | 0 / 0 |
| Caixa | 15/11 19h34 | 01/10 a 15/11 | 01/10 a 05/11 | 1 | 1 | 7 | 7 | 0 / 0 |
| Mercado Pago | 15/11 19h34 | 01/10 a 15/11 | 02/10 a 09/11 | 1 | 1 | 12 | 11 | 0 / 0 |

Todas as datas da tabela são de 2026. A cobertura descreve os registros disponíveis nos backups acumulados. Dias sem movimentos e períodos fora da janela da última coleta não comprovam ausência de transações na instituição.

- A Caixa de Entrada projetou as mesmas **401 movimentações**, cada uma com chave de origem única e versão persistida. `ready=true`, `stagingPending=false`. A projeção indicou dois itens com possíveis vínculos (Nubank e Sicredi), uma referência histórica (Mercado Pago) e nenhum vínculo canônico nessas 401 linhas. Investimentos e faturas têm projeções próprias.
- O histórico Organizze retornou **1.956 registros, 1.555 movimentações, 110 categorias e 20 tags**. O backup foi coletado em 22/10/2026 com janela solicitada de 01/01/2023 a 22/10/2026. As datas dos movimentos no arquivo vão de 29/06/2025 a 25/10/2026, incluindo datas posteriores ao fim solicitado. O arquivo foi preservado integralmente e o importador exige cobertura para criar ou vincular esses registros.
- A prontidão Pluggy e a leitura do seu ledger foram verificadas pela aplicação. A prévia web do Organizze não mostrou o indicador de prontidão nesta sessão. A consulta administrativa do Supabase ao projeto oficial foi recusada. Assim, ficam pendentes a confirmação direta do RPC de conciliação Organizze, o inventário de migrations e grants na produção e a busca de linhas órfãs do ledger ou de arquivos não referenciados.
- A aplicação indica os cinco proxies como configurados e legíveis e reconhece o proprietário das duas integrações. A consulta de metadados de ambiente no Vercel foi recusada. A disponibilidade de `CRON_SECRET`, `MCP_CONFIRMATION_SECRET` e a identificação do plano ativo ficaram sem confirmação. Nenhum valor foi consultado ou exibido. A rota de cron publicada retornou `401` sem credencial.

## Versão proposta

O servidor passa de 75 para 82 ferramentas. O pacote local 1.2.0 preserva a identidade do plugin oficial `plugins_6aca5085e5ec8191979e7f79bee62d7f`, o endpoint e a configuração OAuth/CIMD da versão instalada. O catálogo vem de `tools/list` no servidor autenticado.

| Ferramenta | Operação |
|---|---|
| `hub_get_import_connections` | Estado, volume e cobertura por conexão, prontidão e relatório privado da última execução do cron |
| `hub_list_import_movements` | Filtros por origem, período, banco, conta, cartão, status, titularidade e texto, com paginação |
| `hub_get_import_movement` | Origem, categoria, regras, correspondências com justificativa e histórico |
| `hub_list_import_rules` | Regras salvas e novas sugestões derivadas do histórico |
| `hub_refresh_import_inbox` | Atualização do staging a partir dos backups Pluggy já existentes |
| `hub_prepare_import_reviews` | Proposta de classificação, pendência, histórico, vínculo ou criação para até 20 fontes explícitas |
| `hub_confirm_import_reviews` | Confirmação da proposta exata, com retorno e auditoria por item |

A leitura é limitada ao proprietário configurado. Para revisar, informe a chave e a versão devolvidas pela consulta. A preparação assina e guarda a proposta no servidor por 10 minutos. A skill exige aprovação do usuário para a proposta apresentada. A chamada de confirmação recebe somente o ID e a frase `CONFIRMO CONCILIAR`. O servidor valida proprietário, assinatura, vencimento e versões, e devolve o mesmo resultado ao repetir o ID. A frase é uma exigência do fluxo conversacional e sua autoria não é verificável de forma independente no protocolo MCP.

A criação requer titularidade e natureza informadas, além de verificações de duplicação em transação. Movimentações incertas, compras pendentes, transferências e pagamentos de fatura ficam no staging ou no histórico. Vínculos afetam apenas os registros de origem e preservam o canônico e seus reembolsos. Uma compra nova de cartão exige fatura correspondente, com revalidação da versão de faturas abertas. Se uma compra mudar a versão da fatura antes de outra confirmação no lote, o segundo item retorna conflito e precisa de uma nova proposta. A criação bancária conserva a origem e a titularidade no ledger quando o módulo canônico não tem esses campos. Categorias e tags originais continuam no backup e servem às sugestões.

## Sincronização diária

O agendamento proposto invoca `/api/pluggy/sync` uma vez por dia às 13h UTC, 9h em Cuiabá. O horário é compatível com a frequência do Hobby na granularidade de uma hora. O Vercel envia `CRON_SECRET` como bearer e a rota compara o segredo em tempo constante. São lidos os dados já atualizados pelo Meu Pluggy. Cada instituição tem horário inicial, final, resultado e erro sanitizado, no log da função e no relatório do bucket privado. A execução não confirma revisões nem cria lançamentos financeiros.

Referências oficiais. [Limites e agendamento no Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing) · [Proteção de cron no Vercel](https://vercel.com/docs/cron-jobs/manage-cron-jobs) · [Guia da API Meu Pluggy](https://meu.pluggy.ai/api-guide).

## Validação para liberar

Validação local aprovada com 98 testes de importação e backup, 38 testes MCP e 4 testes de integração no PostgreSQL local. `npm run lint` e `npm run build` também passaram. A validação pública em produção confirmou o binding OAuth e o desafio sem token. O teste autenticado das novas ferramentas fica para depois da publicação.

1. Com acesso administrativo autorizado, confirmar os RPCs Organizze e Pluggy, as migrations de escrita MCP e o bucket privado no projeto oficial. Verificar as variáveis de produção pela presença.
2. Autorizar a migration `20261121145945_mcp_confirm_import_reviews.sql` e o deploy. Conferir a leitura da Caixa de Entrada e a primeira execução diária no log e no bucket.
3. Atualizar o mesmo plugin privado, depois renovar a conexão do ChatGPT se o catálogo em cache não for atualizado. Testar `initialize`, `tools/list` com 82 ferramentas e uma consulta de conexões autenticada. Para o teste técnico de leitura, usar `MCP_PRODUCTION_TEST_EXPECTED_TOOL_COUNT=82` com `npm run test:mcp:production:readonly` e a credencial OAuth do proprietário no ambiente local.
4. Testar primeiro a preparação de um lote e a confirmação em ambiente com dados sintéticos. Em produção, confirmar somente o lote selecionado pelo proprietário.
