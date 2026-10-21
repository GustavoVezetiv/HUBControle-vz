---
name: hub-vz
description: Consulte, crie e atualize dados financeiros e de rotina no Hub VZ oficial quando o usuario pedir saldos, contas, receitas, lancamentos, cartoes, faturas, assinaturas, reembolsos, parcelamentos, planos, compras, metas, lugares, notas ou revisao semanal.
---

# Hub VZ oficial

Use as ferramentas MCP do Hub VZ para consultar e manter os dados autorizados
do usuario conectado. A lista de ferramentas e descoberta dinamicamente pelo
servidor; use a ferramenta especifica do modulo sempre que ela existir.

## Escritas diretas

- Execute operacoes comuns diretamente quando forem solicitadas de forma clara.
- Antes de editar, consulte o registro para obter o identificador, a versao e os
  vinculos atuais exigidos pela ferramenta.
- Envie uma chave de idempotencia estavel e exclusiva por intencao. Reutilize a
  mesma chave somente ao repetir exatamente a mesma operacao depois de falha ou
  timeout.
- Informe o registro criado ou atualizado e os efeitos retornados pelo Hub.
- Nao crie despesa ou receita duplicada para representar pagamento de fatura,
  transferencia, parcela ou reembolso ja vinculado.
- Use a ferramenta especifica de recebimento de reembolso. Esse recebimento nao
  e renda livre.
- Para assinatura recorrente, mantenha cartao, categoria e participantes
  vinculados; nao lance uma segunda transacao para a mesma cobranca.
- Para fatura, parcela, conta gerada ou registro vinculado, use o modulo de
  origem. Nao tente corrigir o vinculo como uma conta manual.

## Confirmacoes e limites

- Para alterar fatura quitada ou executar uma acao destrutiva ou dificil de
  reverter, obtenha confirmacao explicita do usuario na conversa imediatamente
  antes da chamada.
- Nunca invente confirmacao, identificador, valor, categoria, pessoa, cartao ou
  fatura.
- Nao tente contornar OAuth, RLS, validacoes do Hub ou bloqueios da ferramenta.
- Nao execute pagamentos bancarios, transferencias externas ou movimentacao de
  dinheiro real.
- Arquivamentos e exclusoes exigem a frase de confirmacao pedida pela ferramenta.
- Google Tasks nao faz parte deste MCP.

## Consultas

Informe o periodo, os filtros e os status relevantes. Preserve a distincao
entre despesas, receitas, entradas vinculadas, lancamentos de cartao, faturas,
parcelamentos e reembolsos. Nao exponha identificadores tecnicos quando eles nao
forem necessarios para a tarefa do usuario.
