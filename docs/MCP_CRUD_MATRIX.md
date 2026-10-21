# Matriz CRUD do MCP

Esta matriz descreve a superficie MCP homologada no staging e publicada no Hub
VZ oficial. Ela nao substitui os fluxos especializados da interface do Hub.

## Operacoes diretas

| Modulo | Consultar | Criar | Atualizar | Arquivar/restaurar | Observacoes |
| --- | --- | --- | --- | --- | --- |
| Contas a pagar | Sim | Sim, com categoria/pessoa por ID ou nome | Sim, somente manuais | Sim | Recorrencia, juros, risco e notas estao cobertos. Vinculos automaticos nao podem ser forjados. |
| Receitas, lancamentos, compras, metas e reembolsos | Sim | Sim | Sim | Onde o modulo suporta | Delegam ao RPC financeiro V1 ja homologado. |
| Pessoas | Listar e buscar por nome | Sim | Sim | Desativar | O historico permanece vinculado. |
| Categorias | Listar e buscar por nome | Sim | Sim | Desativar | Escopos e tipo sao validados. |
| Cartoes | Sim | Sim | Sim | Desativar | Nao armazena dados sensiveis de pagamento. |
| Assinaturas | Sim, com participantes e ocorrencias | Sim | Sim | Sim | A criacao e a importacao nao geram cobrancas. Participantes sao atualizados atomicamente. |
| Faturas | Sim | Sim | Sim | Sim | Alterar ou arquivar fatura quitada pede confirmacao explicita. |
| Parcelamentos | Sim | Sim | Sim | Nao aplicavel | Gerar contas e registrar parcela respeitam o bloqueio para parcelamentos de cartao. |
| Planos de pagamento | Sim | Sim | Sim | Item pode ser removido com confirmacao | A fonte de cada item deve pertencer ao mesmo usuario. |
| Roles e lugares | Sim | Sim | Sim | Sim | Nao gera despesa automaticamente. |
| Notas | Sim | Sim | Sim | Excluir com confirmacao | Apenas organizacao; nao possui acesso generico a entidades. |
| Perfil | Sim | Atualizar | Atualizar | Nao aplicavel | Apenas preferencias persistidas no perfil. Preferencias locais do navegador ficam fora do MCP. |

## Confirmacoes no chat

- `hub_archive_record` e `hub_archive_subscription`: `confirmDestructiveChange=true` e `CONFIRMO ARQUIVAR`.
- `hub_delete_note` e `hub_remove_payment_plan_item`: `confirmDestructiveChange=true` e `CONFIRMO EXCLUIR`.
- Atualizar ou arquivar fatura quitada: `confirmDestructiveChange=true` e `CONFIRMO ALTERAR FATURA QUITADA`.

Cada escrita exige `idempotencyKey`; atualizacoes exigem `expectedUpdatedAt` da
leitura anterior. O banco bloqueia repeticao com argumentos diferentes e
registra auditoria na mesma transacao.

## Fluxos propositalmente restritos

- Pagamentos externos, transferencias bancarias e movimentacao de dinheiro.
- Criacao de cobranca de assinatura e conciliacao automatica de faturas:
  continuam no fluxo especializado da interface, pois afetam varios registros.
- Operacoes do Google Tasks e alteracoes de rotina: continuam fora deste MCP.
- Importacao de assinatura aceita itens estruturados que o ChatGPT extraiu de
  PDF, CSV ou XLSX; o endpoint MCP nao recebe nem persiste o arquivo bruto.

## Estado de publicacao

As migrations locais de staging sao `202610120001` ate `202610120004`. A
producao recebeu a unica migration consolidada
`20261010170629_mcp_complete_modules_production`, equivalente ao estado final
homologado. O plugin privado `Hub VZ - Oficial` esta na versao 1.1.0 e descobre
dinamicamente as 75 ferramentas expostas pelo endpoint.
