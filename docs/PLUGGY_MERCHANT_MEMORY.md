# HubVZ — Identificação de estabelecimentos

## O que os dados trazem

Auditoria somente leitura em 21/11/2026. Consultei `latest_raw` de 401 origens Pluggy na Caixa de Entrada oficial. Essa coluna preserva o registro bruto mais recente dos backups. Também inspecionei cinco JSONs locais do Meu Pluggy de 09/11, com 340 movimentações, para conferir a forma dos metadados. Os números da tabela são da amostra acumulada em produção. Contas são classificadas pela origem `BANK` ou `CREDIT`. A ausência de linhas Sicredi de cartão significa que esse recorte não mede o cartão dessa instituição. [Consulta de cobertura](../scripts/audit-pluggy-merchant-coverage.sql)

As duas descrições (`description` e `descriptionRaw`) aparecem em **401 de 401** movimentações. Em **todos os grupos** houve **0 registros com nome comercial ou razão social estruturados, CNPJ de estabelecimento, descrição do MCC ou categoria comercial enriquecida, CNAE, endereço, cidade, coordenadas, identificador de estabelecimento ou adquirente**. As colunas de contraparte se referem a pagamentos, com a presença de CNPJ conforme o tipo declarado pelo provedor. Elas ficam fora da identificação de comércio.

| Banco | Tipo | Registros | Descrição original | MCC | Metadados de cartão | Categoria de origem e ID | Nome de contraparte | CNPJ declarado da contraparte |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Nubank | Conta | 53 | 53 (100%) | 0 (0%) | 0 (0%) | 53 (100%) | 19 (35,8%) | 11 (20,8%) |
| Nubank | Cartão | 18 | 18 (100%) | 13 (72,2%) | 18 (100%) | 18 (100%) | 0 (0%) | 0 (0%) |
| XP | Conta | 33 | 33 (100%) | 0 (0%) | 0 (0%) | 33 (100%) | 6 (18,2%) | 0 (0%) |
| XP | Cartão | 265 | 265 (100%) | 254 (95,8%) | 265 (100%) | 262 (98,9%) | 0 (0%) | 0 (0%) |
| Sicredi | Conta | 14 | 14 (100%) | 0 (0%) | 0 (0%) | 14 (100%) | 11 (78,6%) | 0 (0%) |
| Sicredi | Cartão | 0 | — | — | — | — | — | — |
| Caixa | Conta | 4 | 4 (100%) | 0 (0%) | 0 (0%) | 4 (100%) | 1 (25,0%) | 0 (0%) |
| Caixa | Cartão | 3 | 3 (100%) | 1 (33,3%) | 3 (100%) | 3 (100%) | 0 (0%) | 0 (0%) |
| Mercado Pago | Conta | 7 | 7 (100%) | 0 (0%) | 0 (0%) | 7 (100%) | 2 (28,6%) | 0 (0%) |
| Mercado Pago | Cartão | 4 | 4 (100%) | 2 (50,0%) | 4 (100%) | 4 (100%) | 0 (0%) | 0 (0%) |
| **Total** | | **401** | **401 (100%)** | **270 (67,3%)** | **290 (72,3%)** | **398 (99,3%)** | **39 (9,7%)** | **11 (2,7%)** |

A categoria de origem é a classificação recebida no campo `category` do payload Pluggy. A documentação descreve `merchant` como campo opcional e o enriquecimento como serviço separado. Os backups do Meu Pluggy observados não continham esse enriquecimento. [Esquema de transações Pluggy](https://docs.pluggy.ai/pt/docs/products/transactions) · [Guia Meu Pluggy](https://meu.pluggy.ai/api-guide)

A BrasilAPI tem um endpoint público para consultar o cadastro por CNPJ, incluindo nome fantasia, razão social, CNAE e endereço. Como nenhum CNPJ comercial apareceu na amostra, o fluxo fica inteiramente local. Uma consulta futura deve partir de CNPJ comprovado e tratar o endereço retornado como cadastral. [Contrato CNPJ da BrasilAPI](https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/cnpj.json)

## Como funciona

A Caixa de Entrada já tinha regras por texto, histórico e sugestões em lote do Organizze, comparação com lançamentos do Hub e revisão manual. A memória usa as mesmas tabelas de importação e a aba **Regras**.

- Uma compra pode ser reconhecida por CNPJ com dígitos verificados, identificador comercial no mesmo banco, ou descrição normalizada confirmada. Nome comercial estruturado, MCC, CNAE e histórico ajudam a formular uma sugestão. Nenhum deles, isoladamente, comprova a loja exata. [Regra de dígitos do CNPJ](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj)
- A normalização remove variações de acento, pontuação, prefixo de cartão e códigos reconhecíveis de loja. A identificação permanece independente do valor, da data e da busca de duplicatas. Descrições genéricas, intermediários e evidências conflitantes ficam em revisão.
- Confirme pelo detalhe da compra para salvar o nome comercial e a categoria. Os identificadores são extraídos da origem; a interface não pede que se adivinhe um CNPJ. A aba Regras permite buscar, corrigir, desativar e reativar a associação. O sistema reutiliza uma confirmação idêntica e audita mudanças efetivas.
- O Organizze permanece com **1.956 registros**, incluindo **1.555 movimentações, 110 categorias e 20 tags**. As categorias históricas são agrupadas também pelo padrão comercial. Divergências mantêm a sugestão em revisão. Nenhum histórico entra no financeiro por causa dessa memória.
- A categoria confiável pode ser pré-selecionada. A titularidade só vem de revisão explícita. Confirmações de estabelecimentos afetam somente metadados da importação e auditoria. A operação de conciliação financeira continua separada.

## ChatGPT e publicação

O catálogo permanece com 82 ferramentas. `hub_list_import_movements` aceita `merchantStatus`; o detalhe inclui metadados e justificativa e `hub_list_import_rules` lista associações e versões. `hub_prepare_import_reviews` e `hub_confirm_import_reviews` reaproveitam a proposta assinada e a confirmação para `remember_merchant`, `edit_merchant` e `disable_merchant`. Para classificar em lote, indique cada compra e a categoria expressamente aprovada.

A migration `20261121160728_pluggy_merchant_memory.sql` instala o RPC de gravação, que usa a sessão e a RLS do proprietário. A migration MCP 1.2.0 ainda inédita passou a aceitar essas ações no lote assinado. A liberação exige autorização para a conciliação Organizze pendente, as migrations MCP e memória, o deploy e a atualização do mesmo plugin 1.2.0. Não há segredo adicional nem dependência paga. [Checklist da 1.2.0](HUB_VZ_1_2_0_RELEASE_CHECKLIST.md)

## Validação

Passaram `npm run test:imports` (100 testes Pluggy, Organizze e backups), `npm run test:mcp` (38), `npm run test:organizze:db` (5 em PostgreSQL isolado), lint e build. O teste HTTP no Supabase local confirmou autenticação, proposta aprovada, repetição pela sessão web, desativação e preservação do vínculo. O mesmo teste confirmou o agendamento por bearer e a persistência do relatório no Storage privado. Nenhuma migration foi aplicada em produção.
