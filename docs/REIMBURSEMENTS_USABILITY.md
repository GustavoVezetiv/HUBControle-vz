# Reembolsos — datas, busca e filtros

Atualização de 22/10/2026, isolada para publicação na branch
`codex/reimbursements-production-20261022`. As alterações Organizze permanecem
na cópia de desenvolvimento e não integram esta entrega. Sem migration ou
alteração de dados reais.

## Escopo da publicação

A publicação contém apenas as melhorias de reembolsos descritas abaixo. O código
MCP foi conferido contra o deployment oficial anterior
`dpl_HvRrUyJCWZ2zcnybeSuKkzMfeDJV`: os arquivos de autenticação e rota foram
mantidos nos mesmos bytes de produção, excluindo uma proposta OAuth ainda não
publicada da branch de desenvolvimento. Dependências, variáveis, RLS, plugin e
infraestrutura de banco permanecem com a configuração existente.

## Data prevista

Ao abrir **Novo reembolso** ou **Lançamento agrupado**, o formulário sugere o
quinto dia útil do mês seguinte à data atual em **America/Cuiaba**. A data é
editável. O botão **Usar 5º dia útil do próximo mês** reaplica a sugestão atual.
Alterar pessoa, categoria ou status não recalcula nem substitui uma data manual.
Editar um título existente mantém sua data original, inclusive quando ela está
vazia. A sugestão não depende do período que está sendo usado para filtrar a lista.

Conforme a escolha do usuário, o cálculo desconta sábados, domingos e feriados
nacionais brasileiros: 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11
(desde 2024), 25/12 e Sexta-feira da Paixão calculada pela Páscoa gregoriana.
Feriados estaduais/municipais e pontos facultativos (incluindo Carnaval e Corpus
Christi) não são incluídos nesse calendário. A data continua editável para esses casos.

Referência do calendário: [Portaria da Primeira-Secretaria do Senado para 2026](https://adm.senado.gov.br/normas/ui/pub/normaConsultada?2=&idNorma=14384729),
que identifica feriados e pontos facultativos separadamente.

Exemplos:

| Criado em | Sugestão |
| --- | --- |
| 22/10/2026 | 09/11/2026 (Finados em 02/11) |
| 01/04/2026 | 08/05/2026 (feriado de 01/05) |
| 31/12/2026 | 08/01/2027 (feriado de 01/01) |

A mesma função já era utilizada para gerar saldo restante depois de um pagamento
único parcial. Os novos saldos gerados por esse fluxo também passam a descontar
feriados nacionais, sempre tomando como referência a data do recebimento.
Títulos existentes não são recalculados nem migrados.

## Seletores com busca

Pessoa responsável, categoria e status do novo reembolso passam a usar campos
com texto digitável. A busca ignora acentos e diferenças entre maiúsculas e
minúsculas. É possível apagar a consulta, digitar outra e navegar com ↑/↓ e Enter.
Enter escolhe uma opção sem salvar o formulário. Escape fecha primeiro a lista;
um novo Escape pode fechar o modal, seguindo o comportamento já existente.
Texto digitado só se torna valor selecionado ao escolher uma opção. O botão de
limpar remove explicitamente o valor; o campo obrigatório de pessoa continua validado.

- **Pessoas:** nome, ícone representativo do tipo e vínculo (Família, Cliente,
  Amigo, Pagador, Outro); inativos ficam identificados. O esquema atual não possui
  foto/ícone de pessoa salvo: nenhum campo novo foi inventado ou adicionado.
- **Categorias:** ícone e cor já cadastrados, nome, tipo e escopos de uso, como
  “Despesa · Contas e despesas · Faturas e lançamentos · Reembolsos”. A busca
  também encontra esses detalhes. As restrições de escopo existentes continuam valendo.
- **Status:** rótulos existentes com ícones visuais. Não foram criados status novos.

Os seletores de pessoa/categoria dos filtros e do lançamento agrupado também
usam a busca. Os campos de categoria dos vínculos financeiros dentro do formulário
seguem a mesma apresentação. Os seletores de categoria de outras telas permanecem
com o comportamento anterior.

## Filtros adicionais

Em **Mais filtros**, é possível combinar:

- Saldo: todos, em aberto, quitados ou encerrados.
- Vencimento: qualquer data, vencidos com saldo, vencem hoje, hoje + próximos
  sete dias, ou sem data prevista.
- Recorrência: avulsos, recorrentes, ou ambos. Ocorrências filhas de uma série
  são consideradas recorrentes, mesmo com `is_recurring = false`.
- Cartão vinculado: cartão específico ou sem cartão; resolve o vínculo tanto
  pelo lançamento quanto pela fatura diretamente associada.
- Faixa mínima/máxima do principal ainda a receber, sem juros.

Os vencidos são calculados pela data e pelo saldo, mesmo quando o status salvo
ainda está “A receber”. Recebidos, perdoado, cancelado, renegociado e saldo
transferido não entram como dívida aberta. Valores inválidos ou faixa invertida
exibem erro e não produzem resultados silenciosamente mais amplos.

O filtro de categoria inclui **Sem categoria**. A busca geral passa a considerar
descrição, pessoa, categoria, notas e nome do cartão, sem exigir acentos.
Todos os critérios são combinados com o período e os filtros anteriores.

O contador informa quantos títulos passaram pelos filtros. A lista filtrada é
também a base enviada ao relatório. Os cards gerais e o resumo por pessoa
mantêm o recorte de período que já utilizavam. **Salvar visualização padrão**
guarda os filtros adicionais junto aos existentes; **Limpar filtros** os restaura.

## Testes e prévia local

- `npm run test:reimbursements:usability`: testes unitários de calendário,
  criação/edição do formulário, fuso, filtros, saldos, vínculos e busca.
- `npm run lint` e `npm run build`: verificações obrigatórias.
- `npm run preview:reimbursements`: servidor de revisão em
  `http://127.0.0.1:3187/?period=all`. Usa os componentes reais com dados
  inteiramente fictícios e um cliente simulado que recusa toda mutação.

O script de prévia usa apenas os compiladores já instalados no projeto. Não lê
`.env.local`, não consulta o Supabase e não usa as credenciais Organizze. Os assets
gerados ficam em `tmp/reimbursements-preview/`, ignorados pelo Git e excluídos do
lint porque contêm bundles de terceiros, não fontes do projeto. Para reconstruir
os assets de uma prévia já aberta: `node scripts/preview-reimbursements.mjs --build-only`.
O servidor atende apenas os três assets fixos de demonstração na interface loopback.

A validação no navegador deve conferir busca por vínculo de pessoa, busca de
categoria por nome/escopo, Enter/Escape, data sugerida/editável, vencidos com
saldo e persistência dos filtros após recarregar. Não é necessário salvar nenhum
reembolso real para verificar esse fluxo.

Validação concluída nesta entrega:

- `npm run test:reimbursements:usability`: **9/9 aprovados**.
- `npm run lint`: aprovado, sem erros ou avisos nas fontes.
- `npm run build`: aprovado.
- Navegador: busca por Família/Cliente e por escopo “faturas”; consulta sem
  resultados, apagar e redigitar; Enter seleciona sem salvar; Escape fecha só a
  lista; novo formulário e agrupado sugerem 09/11/2026; alteração manual para
  10/11/2026 permanece ao escolher outro status; botão reaplica 09/11/2026.
- Navegador: “Vencidos com saldo” reduz a amostra fictícia de dois para um título;
  salvar/recarregar mantém o filtro e limpar retorna aos dois títulos.

As capturas locais e o servidor de prévia usam somente os dados fictícios do
script. Os testes no navegador não constituem gravação ou consulta financeira real.
