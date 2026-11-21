---
name: hub-vz
description: Consulte, crie e atualize dados financeiros e de rotina no Hub VZ oficial. Consulte e concilie origens bancárias do Meu Pluggy e o histórico do Organizze mediante aprovação.
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

## Caixa de Entrada e conciliação

- Consulte as conexões com `hub_get_import_connections`. Liste os itens com
  `hub_list_import_movements` e detalhe os selecionados com
  `hub_get_import_movement`. Use `hub_list_import_rules` para apresentar regras
  salvas e sugestões do histórico, com suas justificativas.
- Diferencie instituição, origem, categoria, titularidade e status. Mantenha
  a titularidade em aberto quando o responsável for desconhecido. Use tags do
  Organizze como referência de classificação.
- Para vincular, apresente as possíveis correspondências e preserve o
  lançamento, a fatura e o reembolso existentes. Pendências, transferências,
  pagamentos de fatura e estornos devem continuar em revisão ou no histórico.
- Use `hub_prepare_import_reviews` com o identificador e a versão de cada item
  selecionado. Apresente todos os efeitos da proposta, inclusive dependências
  e novos lançamentos. Trate a criação como último recurso para movimentações
  liquidadas com natureza e titularidade confirmadas.
- Aguarde o usuário aprovar essa proposta específica com a frase apresentada.
  Então chame `hub_confirm_import_reviews` com o ID da proposta e a frase que
  ele enviou. Use o mesmo ID em caso de resposta interrompida. Se origem ou
  destino mudar, consulte novamente e peça aprovação para a nova proposta.
- Para movimentações externas, utilize esse fluxo em vez de criar registros
  diretamente nas ferramentas dos módulos. Informe o resultado de cada item.

## Estabelecimentos

- Filtre `hub_list_import_movements` por `merchantStatus`, usando
  `needs_review` para dúvidas e conflitos ou `recognized` para reconhecidos.
  Use o detalhe para mostrar a evidência comercial disponível. MCC e CNAE
  sugerem o ramo. Valor e data não são critérios para reconhecer a loja.
- Para aprender com uma compra, prepare `remember_merchant` com a origem,
  versão, nome confirmado e categoria. Para corrigir, reativar ou desativar
  consulte a associação em `hub_list_import_rules` e use seu `sourceKey` e
  `updatedAt` com `edit_merchant` ou `disable_merchant`. Mostre a proposta e
  aguarde a confirmação antes de executar.
- Classificar compras aprovadas em lote exige selecionar cada origem e
  categoria. A memória comercial não muda o vínculo financeiro nem indica
  titularidade, responsável ou direito a reembolso.
