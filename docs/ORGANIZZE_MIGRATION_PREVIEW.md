# Organizze — extrair, conferir e importar

Branch: `codex/organizze-migration-preview`. Sem push ou deploy.

## Uso

1. Configure privadamente `ORGANIZZE_EMAIL`, `ORGANIZZE_API_KEY`,
   `ORGANIZZE_USER_AGENT` e `ORGANIZZE_HUB_USER_ID` em `.env.local`.
   A chave existente é reutilizada. Nunca use `NEXT_PUBLIC_` para esses valores.
2. Entre no Hub e abra **Importações → Organizze**. O período inicial é
   01/01/2023 até o dia atual de America/Cuiaba.
3. Use **Extrair histórico** ou **Carregar backup local**. Também pode abrir
   um JSON salvo anteriormente. O JSON é validado e vinculado ao usuário.
4. Confira quantidades, categorias e cartões. Na conciliação, cada movimentação
   começa fora dos totais: vincule explicitamente a um lançamento existente,
   escolha **É um lançamento novo** ou mantenha somente como histórico.
5. Para novos registros, confirme titularidade por registro ou em lote. Entradas
   exigem também sua natureza (receita própria, reembolso ou dinheiro de terceiros).
   Reembolsáveis exigem responsável; nenhum reembolso é criado automaticamente.
6. Revise possíveis correspondências. Para criar apesar de uma sugestão, marque
   que conferiu e se trata de um lançamento diferente. Confirme somente ao final.

A extração e a leitura do backup não gravam dados financeiros. A confirmação
é uma transação única: qualquer falha reverte o lote inteiro. O modo padrão
guarda o histórico sem criar categorias, cartões, faturas ou movimentações.
Somente dependências de novos lançamentos aprovados podem ser criadas. Repetir a
confirmação não duplica origens já importadas.

## Preparação única do banco

A migration `supabase/migrations/20261022201515_organizze_confirm_import.sql`
reutiliza `import_batches`, `import_rows` e as tabelas financeiras existentes.
Permite lote Organizze em JSON, origem Organizze nas contas a pagar, índice
único de origem por usuário e duas funções `SECURITY INVOKER` autenticadas.
Não cria módulo financeiro, não modifica políticas RLS nem reembolsos.

A migration foi aplicada ao Supabase oficial em 22/10/2026 após autorização
expressa, registrada pelo MCP como `20261022210830_organizze_confirm_import`.
O arquivo local aprovado conserva a versão `20261022201515`; não reaplicar
automaticamente com base apenas nessa diferença de timestamp.
As duas funções são `SECURITY INVOKER`, executáveis somente por autenticados.
O índice de origem foi confirmado e as políticas RLS e os reembolsos foram
comparados antes/depois, sem alterações. Nenhum lote Organizze foi importado.
Em ambientes sem a migration, a tela mantém a confirmação desabilitada.
Não há fallback por service role ou inserções parciais.

## Correção de conciliação — preparada, não aplicada à produção

A nova migration `20261022212106_organizze_reconciliation.sql` substitui o uso
na aplicação pelas funções `organizze_reconciliation_ready()` e
`confirm_organizze_reconciliation(p_rows,p_period)`, ambas `SECURITY INVOKER`.
Não cria tabelas, não altera RLS e não modifica registros financeiros existentes.
Revoga a confirmação legada do papel authenticated para impedir clientes antigos
de contornarem a revisão por registro. A autorização anterior cobriu apenas a
migration inicial; esta nova migration fica pendente de autorização separada.
A rota local recusa confirmar enquanto a função nova não estiver disponível.

Riscos corrigidos: comparação anterior restrita a data/descrição idênticas;
vínculo automático de uma coincidência; titularidade única por lote;
entrada bancária tratada como receita; total histórico de fatura incluído mesmo
quando suas compras não haviam sido selecionadas; histórico retido impedindo
uma futura conciliação. Os 1.879 destinos da versão anterior não são mais
selecionados automaticamente.

A conciliação considera mesmo valor e datas em até sete dias, inclusive data de
recebimento, sem exigir descrições idênticas. São sugestões, inclusive entre
módulos ou no próprio histórico, nunca vínculos automáticos. A ausência de
sugestão não prova que um registro é novo. Datas além da janela, diferenças de
valor e conciliações parciais/agregadas precisam de revisão manual; ficam fora
dos totais até uma decisão. Pagamentos/transferências continuam fora de novas
despesas/receitas.

O vínculo usa o ID financeiro existente, sem atualizar linha financeira alguma.
Origem original (Manual/HubVZ/Organizze/Pluggy), automação, referências conciliadas,
categoria e titularidade aparecem separadamente na tela. Assinaturas geradas e
recebimentos vinculados entram na comparação pelos lançamentos já existentes.
A consulta de referências inclui registros arquivados para não recriá-los.
Não há conector Pluggy nesta alteração; vínculos de origem já existentes no
ledger são reconhecidos sem confundir origem com categoria ou titularidade.

Histórico e categorias/tags originais ficam no backup e em `import_rows`.
Um registro somente de origem pode ser conciliado posteriormente: seu ID no
ledger e `raw_data` são preservados, com a revisão anterior em `mapped_data`.
Repetir uma origem já conciliada não altera nem duplica o destino.
A confirmação recarrega referências e o banco verifica o proprietário, os
valores/datas e possíveis duplicatas antes de criar novos lançamentos. Não há
service role, inferência de responsável nem geração automática de recorrências.

## Paginação e cobertura

O leitor usa host HTTPS fixo, GET, sem corpo ou redirecionamento, com timeout,
limite de resposta e erros controlados. Os links não são seguidos diretamente.
A próxima requisição é reconstruída com o endpoint e as datas já autorizados.

O defeito observado foi `page` inválido seguido de `page=2`, com datas repetidas
iguais. Recupera-se apenas um próximo número inequívoco e sequencial. Páginas
numéricas conflitantes, datas diferentes, outro host/caminho e parâmetros
inesperados continuam bloqueados. IDs repetidos entre páginas impedem falsa
completude. Cada página concluída tem recibo e os originais são preservados.

Uma página vazia encerra a listagem mesmo quando o servidor continua anunciando
`next` indefinidamente; esse comportamento observado em `/transfers` gera aviso
no backup. A validação de segurança do link ocorre antes desse encerramento.

As janelas são mensais, porque a API pode expandir os filtros para o mês inteiro.
O backup conserva respostas fora das datas exatas como contexto de faturas,
mas elas não geram registros operacionais do período escolhido.

404/405/410 de detalhes de movimentações, listagem de transferências e pagamentos
são avisos explícitos de recurso secundário indisponível; os demais registros
podem ser importados. Autenticação, 429, paginação insegura e dados em quarentena
continuam interrompendo a extração. Não se inventam recursos omitidos pela API.

## Vínculos e preservação

- Categorias: preserva nome, tipo, cor e hierarquia. `expenses`/`earnings` são
  traduzidos para os tipos Hub apenas no destino; os originais ficam no lote.
  Um cadastro existente é vinculado somente com tipo e hierarquia compatíveis.
  Não é sobrescrito. Colisão de nome/tipo em outra hierarquia recebe sufixo
  Organizze com ID original para respeitar a unicidade do Hub sem perder a origem.
- Cartões/faturas/compras: vínculos são resolvidos por IDs de origem. É possível
  escolher o cartão Hub correspondente antes de confirmar. Fatura existente
  divergente não é sobrescrita; seus registros ficam preservados para conciliação.
  Uma fatura nova recebe somente a soma de compras explicitamente selecionadas,
  com pagamento inicial zero. O total e os pagamentos históricos permanecem na
  origem; não são copiados para os totais atuais. Faturas existentes não são
  recalculadas ou sobrescritas; eventuais diferenças devem ser revisadas.
  Faturas positivas (saldo credor) ficam na origem, sem criar dívida fictícia.
  A conciliação consulta também faturas Hub posteriores ao período, pois compras
  do intervalo podem estar vinculadas a uma fatura com vencimento futuro.
- Tags, parcelas, recorrências e todos os payloads originais permanecem em
  `import_rows.raw_data`; nomes de tags e vínculos ficam em `mapped_data`.
  `source_key` liga cada registro Hub à origem Organizze para futura conciliação
  com Pluggy. Recorrências históricas não ativam geração automática de ocorrências.
- Contas bancárias: o Hub não possui um módulo bancário. Ficam no lote como
  cadastros de origem, ligados às movimentações; não viram contas a pagar.
- Transferências: conserva ambas as pernas e os IDs de contrapartida no lote,
  sem criar despesas/receitas artificiais.
- Pagamentos de fatura: conserva eventos e vínculos; a importação não copia o total pago
  histórico para uma fatura nova, sem duplicar a liquidação em uma conta/despesa adicional.
- Estornos/créditos de cartão: como o modelo atual aceita apenas valores positivos
  de débito, ficam preservados na origem para conciliação, sem inverter seu sinal
  e transformá-los em novas despesas.
- Correspondências exigem escolha explícita; ambiguidades ficam para revisão.
  Dependências ausentes e conflitos financeiros não ganham vínculos arbitrários.
- Nenhum reembolso existente é alterado ou criado. Não se inferem pessoas,
  reembolsos ou regras internas de aprendizado a partir de tags/descrições.

## Backup e execução local

`npm run extract:organizze` usa o mesmo leitor e extrator para salvar desde
01/01/2023 até hoje em `tmp/organizze-backups/<data>/organizze-backup.json`.
Há checkpoints e `--resume <pasta>` para retomar. Só consulta o Organizze;
não carrega nem grava Supabase. A tela também salva um backup local ao terminar.

Os backups contêm dados pessoais completos e estão ignorados pelo Git e pelo
upload Vercel. O console mostra apenas contagens, progresso e erros controlados.
O backup usa `{ snapshot, selectedKeys: [] }` e guarda IDs, origens, recibos,
erros e recursos indisponíveis. Não contém credenciais de configuração.

## Validação

Extração real de 22/10/2026: período solicitado 01/01/2023–22/10/2026,
2.705 consultas concluídas, 1.956 registros únicos (8 contas, 6 cartões,
110 categorias, 277 faturas e 1.555 movimentações), 20 tags e nenhuma quarentena.
As movimentações retornadas no período vão de 29/06/2025 a 25/09/2026.
A API não retornou movimentações anteriores ou posteriores nessas janelas.

Após a revisão de conciliação, o backup completo foi testado novamente em banco
local: modo padrão com 1.956 origens e zero destinos financeiros novos; 1.500
movimentações classificáveis e 366 com sugestões internas (não duplicatas
comprovadas). A aprovação de uma despesa criou somente ela e uma categoria
necessária, reutilizando o histórico já guardado. Repetir criou zero destinos.
Todas essas operações foram revertidas por `ROLLBACK`.
Na prévia autenticada com as referências reais do Hub em 22/10/2026, foram
sinalizadas 369 movimentações com possíveis correspondências (Hub ou histórico),
com zero novos registros pré-selecionados. Isso não é uma contagem de duplicatas
comprovadas; cada vínculo ou criação exige revisão.

Na versão inicial (antes desta revisão), o lote completo foi executado em Postgres Docker local, com proprietário
sintético e referências vazias: 1.891 novos destinos e 65 registros de origem.
A repetição criou zero destinos e reconheceu as 1.956 origens. Ambas as execuções
foram revertidas por `ROLLBACK`; nenhum dado financeiro oficial foi gravado.

- `npm run test:organizze`: cliente, paginação, extração, preservação, revisão por registro, preparação
  do importador e autorização/CSRF/confirmação da rota.
- `ORGANIZZE_TEST_CONTAINER=hubvz-organizze-test-... npm run test:organizze:db`:
  Postgres Docker local com dados sintéticos. Cria banco isolado e testa a
  migration, atomicidade, repetição, vínculos, tags, RLS, destinos adulterados
  e preservação de reembolsos. Nunca se conecta ao Supabase configurado.
- `npm run lint` e `npm run build`.

Referências: [API Organizze](https://developers.organizze.com.br/) e
[funções de banco Supabase](https://supabase.com/docs/guides/database/functions).
