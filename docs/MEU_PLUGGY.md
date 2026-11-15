# Meu Pluggy — cinco bancos e conciliação

Área: **Importações → Meu Pluggy**, `/dashboard/imports/pluggy`.
Instituições: Nubank, XP Banking, Sicredi, Caixa Econômica Federal e Mercado Pago.
Uma aplicação demo e um item proxy diferente para cada banco, sem novas dependências.

## Configuração local

Os consentimentos do Data Passport e os proxies da aplicação são passos distintos.
Como os bancos já estão conectados no Meu Pluggy:

1. Abra [Dashboard Pluggy](https://dashboard.pluggy.ai/), entre em **Applications**
   e na aplicação **demo**. Use o botão de conectar e escolha **Meu Pluggy**.
   Se ele não aparecer, habilite esse conector na configuração do widget da aplicação.
2. Selecione cada conexão existente do seu Data Passport. Não selecione um
   conector bancário direto nem cadastre novamente CPF/senha do banco.
3. Nos detalhes de cada conexão/item criada **dentro da aplicação demo**, copie
   seu **Item ID**. O ID do conector e o ID original do Data Passport são diferentes.
   Não é necessário nem suportado listar esses IDs com `GET /v2/items` pessoal.
4. Configure `.env.local` na raiz do projeto e reinicie o servidor:

```dotenv
PLUGGY_CLIENT_ID=<Client ID da aplicação demo>
PLUGGY_CLIENT_SECRET=<Client Secret da mesma aplicação>
PLUGGY_NUBANK_ITEM_ID=<item proxy Nubank>
PLUGGY_XP_ITEM_ID=<item proxy XP Banking>
PLUGGY_SICREDI_ITEM_ID=<item proxy Sicredi>
PLUGGY_CAIXA_ITEM_ID=<item proxy Caixa>
PLUGGY_MERCADO_PAGO_ITEM_ID=<item proxy Mercado Pago>
```

O UUID proprietário reutiliza `ORGANIZZE_HUB_USER_ID` já configurado; opcionalmente
pode ser explicitado em `PLUGGY_HUB_USER_ID`. Nada usa `NEXT_PUBLIC_` ou service role.
IDs inválidos ou atribuídos a dois bancos ficam bloqueados. Como o proxy identifica
seu conector genericamente como MeuPluggy, a associação banco/item é explícita na
configuração do proprietário, não uma dedução pelo nome do conector.

A tela mostra separadamente configuração pendente, proxy ausente/inválido,
aguardando primeira consulta, dados disponíveis, consentimento/atualização pendente
ou erro da última consulta. Nenhum banco é declarado validado só por estar configurado.

## Dados e sincronização

A única operação POST na Pluggy é `/auth`, no backend. A chave privada é compartilhada
entre os cinco leitores e reutilizada por 110 minutos. Após 401, renova uma única vez.
Dados são lidos somente por GET, com HTTPS fixo, sem redirects/cache, timeout e erros
controlados sem corpo bruto ou credenciais:

- `/items/{id}`, `/accounts`, `/v2/transactions` e `/bills`;
- `/investments` e `/investments/{id}/transactions`, quando disponíveis.

Transações seguem `next` como query opaca, com conta, filtros e endpoint conferidos.
Demais listas conferem páginas/totais/IDs. Investimentos e movimentos embutidos são
preservados por ID. Autenticação, escopo, limites e paginação inválida interrompem
a coleta daquele banco; 403/404/405/422 de produtos secundários viram avisos explícitos
de recurso indisponível/sem permissão. Nenhuma tentativa contorna a permissão negada;
403 do próprio item permanece bloqueante. Produtos parciais aparecem como tal.
Falhar um banco não apaga o backup anterior nem impede consultar os demais.

Ao abrir a tela, conexões configuradas sem coleta nas últimas 24 horas são consultadas
uma vez. Há consulta manual por banco/todos e filtro de datas para movimentações.
Isso lê os dados disponíveis do proxy; não força sincronização no banco, não cria
conexões nem usa PATCH. A atualização original permanece no Meu Pluggy.

Para coleta diária mesmo com o navegador fechado, há duas opções **não agendadas
automaticamente nesta entrega**:

- No computador pessoal, executar `npm run sync:pluggy` diariamente pelo Agendador
  de Tarefas, com diretório inicial na raiz deste projeto. O script usa as mesmas
  variáveis, ignora coletas recentes e somente grava backups locais. `-- --force`
  força nova leitura da API, não uma atualização no banco.
- Em servidor com armazenamento durável, chamar `GET /api/pluggy/sync` com
  `Authorization: Bearer <CRON_SECRET>`. Configure esse segredo privadamente.
  Sem ele a rota retorna 401. Não põe o segredo na URL. Não faz push/deploy,
  não instala cron, não grava financeiro e não usa credenciais Supabase privilegiadas.

A rotina sem sessão Hub guarda as origens em disco. Ao abrir a interface autenticada,
esses registros entram no ledger/caixa de entrada se a migration estiver disponível.
Não há webhook ou cliente extra desnecessário. Produtos retornados e cobertura real
só podem ser confirmados depois de consultar as cinco conexões com credenciais reais.

## Caixa de entrada e preservação

### Entrada unificada e classificação em lote (15/11/2026)

A Caixa de entrada passa a mostrar compras e receitas tanto POSTED quanto PENDING,
sem misturar o status do banco com a decisão do usuário. Uma compra em fatura aberta
pode receber categoria antes do fechamento. PENDING continua sem permissão de
preparar lançamento ou vincular um registro financeiro; não muda os totais do Hub.
Transferências ambíguas, créditos/estornos, dados incompletos e itens adiados ficam
em **Revisar**. Pagamentos de fatura e operações internas identificadas continuam
em **Ignorados**. O motivo completo aparece ao expandir, sem repetir avisos em cada linha.

O topo foi reduzido a três indicadores. Filtros extras e fontes/arquivos começam
recolhidos. Banco, busca, período atual e composição da seleção continuam acessíveis.
No detalhe, a classificação existente fica recolhida; categoria, titularidade e
destinação são salvas sem alterar os lançamentos oficiais.
O Tailwind passa a usar `darkMode: "class"`, igual ao seletor de tema existente do
Hub. Antes, variantes `dark:` seguiam o sistema operacional e podiam divergir do
tema escolhido no app. A validação visual usa inclusive preferências opostas do SO.

**Classificar em lote** apresenta os padrões do histórico Organizze, categoria de
origem, intervalo de datas, frequência, tags e exemplos atuais alcançados. Sugestões
com pelo menos duas ocorrências, categoria compatível e única no Hub e sem conflitos
podem ser selecionadas (até 20 regras por execução). Não há seleção inicial nem
criação silenciosa. Cada regra usa o endpoint `action=rule` e a RPC `save_pluggy_rule`
já existentes, sequencialmente. A restrição única por usuário/padrão impede duplicação;
uma falha interrompe o restante e informa quantas regras já foram salvas. A unidade
atômica é cada regra, não o lote inteiro. Nenhuma migration nova é necessária.

As regras confirmadas sugerem categoria nos itens ainda não revisados, inclusive
nas próximas consultas. Não sobrescrevem revisões manuais nem atribuem titularidade
por tags do Organizze. Categoria conflitante, tipo receita/despesa divergente,
equivalência ausente, padrão sem repetição e sobreposição conflitante exigem ajuste.
Uma cobrança Microsoft recorrente pode compartilhar classificação, mas permanece
um registro distinto; mesma descrição/valor não autoriza conciliação automática.

Categorias do banco e do Organizze permanecem referências distintas da categoria do
Hub. Equivalências usam o caminho hierárquico e o tipo. Categorias ausentes não são
criadas por esse lote: há acesso ao cadastro existente de Categorias para criação
ou ajuste antes de salvar a regra. Esta entrega não adiciona ferramentas MCP para
editar a caixa de entrada; a classificação em lote aqui é pela interface do Hub.

As fontes de integração desta tela são Pluggy (movimentos bancários atuais) e
Organizze (histórico e padrões). CSV/XLSX continua sendo uma alternativa manual.
Ler o histórico já preservado não exige reativar a extração na API Organizze.

### Diagnóstico de atualização e progresso (15/11/2026)

Uma consulta real e autenticada no Hub oficial confirmou que a visualização
principal parava em 03/11 porque mostrava apenas a fila de movimentos POSTED
aptos à revisão. A origem XP já continha movimentos de cartão até 14/11,
exibidos em Pendentes. Uma nova consulta com término em 15/11 retornou 265
movimentos de cartão: 198 POSTED e 67 PENDING. Não foram criados lançamentos
financeiros para essa verificação; somente a coleta existente de origem foi usada.
Não é possível afirmar que dados posteriores já estejam disponíveis na API.

No cartão, PENDING pode representar compra em fatura ainda aberta ou parcela
futura, não falha de sincronização nem inexistência da compra. A entrada unificada
descrita acima torna essas compras visíveis na fila principal e separa o status do
provedor das revisões que dependem do usuário.
Nada converte PENDING em POSTED ou em nova despesa automaticamente.

O botão de sincronização percorre contas/cartões, páginas de movimentações,
faturas e investimentos disponíveis para o período solicitado. Ele relê o proxy
Meu Pluggy; não faz PATCH no item e não força a atualização da conexão original
no banco. O guia pessoal da Pluggy informa atualização diária da conexão original.
As datas de consulta no Hub, atualização informada pelo provedor, último movimento
de cartão e período da consulta são apresentadas separadamente.

`POST /api/pluggy/dashboard` com `action=sync` mantém a resposta JSON compatível.
Quando o cliente envia `Accept: application/x-ndjson`, retorna eventos por linha:

```json
{"type":"progress","progress":{"phase":"transactions","message":"Movimentações: conta/cartão 1 de 3 · página 1 · 20 registros recebidos","percent":20}}
{"type":"result","data":{"financialWrites":0}}
```

O objeto `data` real é a mesma projeção completa já retornada em JSON. Erros
intermediários retornam `type=error` com mensagem sanitizada; não produzem um
resultado de sucesso. O progresso mede etapas concluídas, não tempo restante,
quantidade de bytes ou novos lançamentos. Cada conexão é consultada em sequência.
A autenticação proprietária e a checagem de origem acontecem antes de abrir o
stream. O parser suporta fragmentação UTF-8 e rejeita término sem resultado.

A consulta diária só pode ser pulada quando o backup recente cobre todo o período
solicitado; uma coleta de ontem não satisfaz automaticamente o intervalo de hoje.
O período padrão de 45 dias foi mantido, agora com atalhos Este mês e Últimos 45
dias. O resultado discrimina movimentos novos/atualizados da origem e preservação
dos registros já existentes; consultar não significa importar para o financeiro.

O histórico Organizze oficial possui 1.555 movimentações, 110 categorias e 20 tags,
com período solicitado até 22/10/2026. Ele é lido do arquivo, agora com os registros
mais recentes primeiro. A consulta real a `/api/organizze/preview?action=extract`
para `/categories` retornou configuração ausente em produção: são necessárias
ORGANIZZE_EMAIL, ORGANIZZE_API_KEY e ORGANIZZE_USER_AGENT no servidor. A leitura
do arquivo não depende dessas credenciais, mas uma nova extração depende.
Nenhum segredo foi exibido ou alterado nesta verificação. A própria aba possui
acesso explícito à extração existente; sugestões de conciliação não vinculam nem
duplicam títulos por conta própria.

As credenciais locais existentes foram conferidas separadamente com uma única
requisição GET `/categories`, usando o leitor já implementado: 110 categorias
retornadas, sem paginação pendente e zero gravações financeiras. Assim, o acesso
local à API foi comprovado, mas não substitui a configuração ausente no servidor
oficial. As credenciais não foram publicadas nem exibidas.

Importações fica no grupo Financeiro e também é acessível pelo resumo já existente
no Dashboard. O menu mobile ganhou rolagem interna com altura dinâmica, áreas
seguras, bloqueio do fundo, Escape, retorno/contenção do foco e itens recolhidos
inertes. Tocar em uma rota fecha o drawer, preservando a navegação existente.
O cabeçalho de fechamento permanece visível mesmo quando a lista do menu rola.

Validação final desta revisão: 48 testes Pluggy, 35 Organizze, 5 de armazenamento
e 4 de restauração aprovados (92), executados sequencialmente com heap limitado.
`npm run lint` e `npm run build` aprovados. O build foi concluído com um trabalhador
(`CIRCLE_NODE_TOTAL=2`) e heap máximo de 768 MiB, após encerrar as prévias locais.
Playwright usa componentes reais e fixtures, quatro larguras, temas claro/escuro
independentes do SO, stream de progresso, classificação de compras PENDING,
falha parcial/repetição de lote de regras sem duplicação e drawer mobile.
Nenhum teste cria lançamentos reais ou acessa os bancos; os servidores de prévia
são encerrados ao terminar. Nenhuma migration ou dependência foi adicionada.

Fontes: [guia Meu Pluggy](https://meu.pluggy.ai/api-guide),
[ciclo de compras e parcelas de cartão](https://docs.pluggy.ai/en/docs/products/credit-card-installments),
[status de transação](https://docs.pluggy.ai/en/reference/transaction/transactions-retrieve).

### Resumo visual e acessos

A caixa de entrada usa acentos vivos em verde, azul, rosa e âmbar, com cores
adaptadas aos temas claro/escuro e texto/ícones acompanhando os sinais de cor.
O gráfico **O que ainda precisa entrar no Hub** considera todos os resultados
filtrados (não somente a página de 20 itens): saídas em conta, entradas em conta,
compras no cartão e outros itens a revisar. Cada item participa de um único grupo.
Ignorados e já vinculados ficam fora do total a revisar e aparecem no rodapé.
Correspondências e pendências ainda não resolvidas continuam no gráfico; os
números são contagens de revisão, não valores somados ao financeiro nem promessa
de que toda entrada representa renda livre.

O mesmo resumo aparece no Dashboard, no período selecionado, somente para o
proprietário da integração. Ele faz uma leitura GET da API existente; não força
coleta bancária, staging, classificação ou importação. Falha de consulta mostra
indisponibilidade, sem inventar contagem zero. O acesso **Revisar movimentações**
leva as datas para a mesma tela Meu Pluggy, com parâmetros validados.

Há acesso **Financeiro → Caixa de entrada**, mantendo também o caminho original
em Importações. A navegação usa o destino mais específico para não marcar dois
itens simultaneamente. Nas configurações, a caixa de entrada pode ser escolhida
como tela inicial e atalho favorito; preferências existentes são preservadas.
Esta etapa não habilita importação financeira definitiva automática, nem altera
a sincronização de leitura já existente.

Validação visual: Playwright conferiu a composição filtrada, quatro larguras,
claro/escuro e o resumo do Dashboard consultando apenas GET, com datas no link
da revisão. Testes unitários cobrem contagens sem sobreposição, exclusão de
ignorados/vinculados, período válido e apenas um item ativo na navegação.
`npm run test:pluggy` (40), `npm run test:organizze` (35), `npm run lint` e
`npm run build` aprovados. Nenhum teste gravou dados financeiros reais.

### Entradas, bancos e histórico (09/11/2026)

A conferência dos backups disponíveis encontrou 340 movimentos: 59 créditos,
sendo 51 em contas e 8 em cartões. A separação anterior enviava todo movimento
com `paymentData` para revisão; isso incluía portabilidade de salário. Operações
explícitas de salário liquidadas em conta agora podem permanecer na caixa de
entrada, mantendo titularidade pendente. PIX/TED, créditos ambíguos e resgates
continuam com tratamento próprio. Nenhum crédito é automaticamente renda livre.

Os filtros **Entradas na conta**, **Saídas** e **Créditos de cartão** contam os
itens da fila visível. **Ver todas as filas** reúne os recebidos no mesmo período,
preservando a situação e o motivo de cada um. A antiga fila Pendentes foi substituída
por Revisar conforme a organização acima; ignorados são referências separadas, não
itens excluídos. O motivo detalhado aparece ao expandir o item.

As tags de banco são apenas apresentação: cores de XP, Caixa, Sicredi, Nubank,
Mercado Pago e outros bancos, com ícones distintos para conta e cartão. O produto
original (por exemplo, Visa Infinite quando informado) permanece visível.
Nenhum cartão ou conta financeira é cadastrado automaticamente.

A conciliação usa a instituição explícita do vínculo Pluggy, emissor/nome do cartão
Hub ou conta/cartão do histórico Organizze já vinculado. Banco desconhecido nunca
ganha confiança alta por descrição semelhante. Bancos distintos e conta/cartão
incompatíveis são descartados. Mesmo banco + valor + data recebe 90/100; descrição
equivalente sobe para 98/100. Datas próximas e banco desconhecido reduzem a
pontuação. É uma heurística de comparação, não uma probabilidade estatística nem
uma autorização para vincular sem escolha humana.

A aba **Histórico Organizze** carrega o backup automaticamente dentro do Meu Pluggy,
com listas de movimentações, categorias/hierarquia e tags pesquisáveis. O arquivo
disponível já contém 1.956 registros, 1.555 movimentações, 110 categorias e 20 tags
da API (período 01/01/2023 a 22/10/2026); não é uma cópia sincronizada até hoje.
Tags vêm das movimentações e categorias da extração `/categories`; não foi
inventado endpoint de tags nem repetida a extração inteira sem necessidade.
Correspondências históricas confiáveis sugerem a categoria Hub somente quando
hierarquia e tipo são compatíveis e únicos, com aceitação explícita na revisão.
Tags originais ficam visíveis e pesquisáveis; não atribuem titularidade nem geram
reembolsos. Referência de arquivo não se torna vínculo financeiro sem registro Hub.

**Configurações → Telas e atalhos → Ao trocar página de uma lista** permite escolher
início, rodapé ou manter posição nas listas paginadas de importações/Organizze.
A preferência usa o armazenamento local existente por usuário, sem migration.
Somente Anterior/Próxima dispara rolagem; carregar dados ou filtrar não a dispara.

Validação desta etapa: 38 testes Pluggy e 35 Organizze aprovados, lint e build
completos aprovados. A prévia Playwright usa fixtures para verificar entradas em
várias filas, tags de banco/cartão, leitura embutida do histórico/categorias/tags,
conciliação explícita e as três preferências de rolagem, além de quatro larguras
e capturas claro/escuro. A inspeção dos backups reais foi somente leitura; nenhum
teste criou, editou ou importou registros financeiros reais.

### Revisão visual da caixa de entrada

A tela abre na **Caixa de Entrada Financeira**. O resumo mostra bancos com coleta
disponível (configuração sozinha não conta como conexão validada), última coleta
no Hub, itens novos ainda não revisados, classificação incompleta, possíveis
correspondências e itens automaticamente separados dos novos lançamentos.
Contagens de movimentos respeitam banco e período; novos e classificação são
indicadores sobrepostos e não devem ser somados. A última coleta não promete
que todos os bancos atualizaram no mesmo horário.

- **Caixa de entrada**: compras/despesas e receitas/créditos liquidados em BRL,
  sem indícios de pagamento/transferência e sem possível vínculo existente.
- **Conciliação**: correspondências a revisar e vínculos já confirmados, com
  filtro próprio. A comparação mostra descrição, valor, data e origem do registro
  existente. A confiança considera banco identificado, data e descrição sobre
  valores iguais, conforme a pontuação descrita acima.
  Nenhuma confiança autoriza vínculo automático.
- **Pendentes**: liquidação bancária, PIX/TED/DOC/TEF, pagamentos a conferir,
  crédito/estorno, dados inválidos, moeda estrangeira ou revisão adiada manualmente.
  PIX/TED não comprova transferência própria e nunca atribui titularidade.
- **Ignorados**: referências marcadas pelo usuário e operações bancárias explícitas
  de pagamento de fatura, transferência interna, estorno técnico, informação ou
  aplicação/resgate. Esta separação é uma projeção de leitura, não grava uma nova
  classificação no banco. Estorno/crédito ambíguo vai para revisão.
- **Histórico Organizze**: acesso à consulta existente, fora da fila de novos itens.
- **Regras**: mesmo cadastro e aplicação de regras confirmadas já existentes.

Cada linha mostra data, descrição, banco/cartão, valor, tipo, situação e ação.
Revisão, titularidade, comparação e IDs ficam na expansão da linha; dados técnicos
ficam em uma segunda expansão fechada por padrão. Conexões, produtos, avisos e
download JSON ficam na seção recolhida ao final. No celular, as linhas reorganizam
os campos e as abas têm rolagem horizontal, sem alargar a página.

**Vincular** usa a revisão existente, com seleção explícita e versão esperada;
**Ignorar** salva o estado de referência existente; **Preparar novo** abre o módulo
de cadastro correspondente após avisar sobre possíveis duplicatas. Não foi criada
importação definitiva, reembolso automático, tabela, migration ou novo endpoint.
Titularidade continua pendente, salvo escolha manual ou regra confirmada explícita.

Validação local: `npm run test:pluggy`, `npm run test:organizze`,
`npm run lint` e `npm run build`. Os testes da caixa de entrada usam apenas fixtures.
`node scripts/preview-pluggy-inbox.mjs` abre a prévia isolada em `127.0.0.1:3188`;
`--check` executa a conferência com Playwright já instalado (ou indicado em
`PLUGGY_PLAYWRIGHT_PATH`), salva capturas em `tmp/pluggy-inbox-preview` e encerra.
A prévia usa os componentes reais com registros fictícios em memória e bloqueia
requisições externas, sem cliente bancário/Supabase. Não instala dependências.

Validação desta reorganização (09/11/2026): 35 testes Pluggy e 35 Organizze
aprovados; lint e build completos aprovados. O build usou um único worker
(`CIRCLE_NODE_TOTAL=2`) e heap limitado; a primeira execução foi interrompida
quando a memória livre do computador caiu, e a execução final passou após a
recuperação de memória. Playwright conferiu as abas, seleção explícita para
vínculo, payload versionado da revisão, quatro larguras (1440, 1024, 768 e 390),
capturas claro/escuro e ausência de erros JavaScript. Esses fluxos usaram apenas
fixtures locais, sem sincronizar bancos reais nem gravar registros financeiros.

- Backups privados em `tmp/pluggy-backups/<id>/pluggy-backup.json`, fora do Git/upload.
  A tela acumula janelas sobrepostas por conta/ID, conservando movimentações antigas
  e a versão mais recente do provedor; ausência na próxima janela não significa exclusão.
  Contas antigas ausentes na última coleta exibem aviso de dado anterior.
- Download JSON autenticado por banco inclui dados pessoais originais. CPF, titular
  bancário e conta completa não são enviados na projeção usada pela interface.
- Novas movimentações recebem estado novo/pendente na caixa de entrada, **fora dos
  totais financeiros**. Classificar não cria compra, receita, transferência ou reembolso.
- Conciliação exige escolha explícita de um lançamento Hub existente, mesmo valor
  e proximidade de até sete dias. A origem recebe o ID canônico existente; o lançamento
  mantém seu ID, categoria, titularidade e vínculos com recebimentos, reembolsos,
  assinaturas e faturas. Organizze e Pluggy podem apontar para o mesmo ID.
- Vínculo canônico não pode ser trocado/removido por uma reclassificação. A revisão
  usa versão para rejeitar formulário desatualizado. Se valor/data da origem mudar
  depois do vínculo, a interface alerta e preserva o lançamento financeiro.
- Uma movimentação realmente nova continua na caixa de entrada; seu cadastro
  financeiro efetivo usa os módulos existentes (links de lançamentos/cartões),
  com confirmação humana, e depois pode ser conciliado. Esta entrega não implementa
  geração automática de novos lançamentos financeiros canônicos.
- Lotes internos Pluggy no histórico de importações abrem a própria área Meu Pluggy;
  não entram na revisão/importação financeira genérica de planilhas.
- Origem Meu Pluggy, instituição/cartão, categoria bancária, categoria Hub, referências
  Organizze, titularidade e situação são campos separados. Titularidade inicial é nula.
- Pagamento de fatura e crédito/estorno de cartão não viram nova receita/compra.
  PIX/TED não prova transferência entre contas próprias: essa decisão é explícita.
  Transferência própria/pagamento/histórico pode ser marcado sem impacto nos totais.
- Investimentos, posições, aplicações e resgates são somente leitura. PENDING e moeda
  diferente de BRL não ganham correspondências financeiras por valor BRL liquidado.
- O backup Organizze permanece intacto: 1.956 origens, 1.555 movimentações,
  110 categorias e 20 tags, consultáveis em `/dashboard/imports/organizze/history`.
  Nada desse histórico foi importado automaticamente nesta etapa.

## Regras confirmadas

A aba Regras permite cadastrar/editar/ativar/desativar texto contido na descrição,
por exemplo `MICROSOFT` → categoria Hub Assinaturas. Somente categorias do próprio
usuário e de tipo compatível são usadas. Sugestões do Organizze agrupam descrições,
categorias e tags históricas; não copiam regras internas do Organizze nem inferem
responsável por descrição/tag. Sugestão não vira regra ativa sem confirmação.

Regra confirmada preenche categoria da entrada, preservando a categoria bancária.
Titularidade só é atribuída se escolhida explicitamente na regra; padrão é pendente.
Regras conflitantes sinalizam ambiguidade. Revisões manuais e dados canônicos não
são sobrescritos por reprocessamento. Nenhuma regra gera reembolsos.

## Persistência e migrations

Revisadas as duas migrations Organizze: a primeira habilita o ledger JSON e já foi
aplicada com autorização anterior; `20261022212106_organizze_reconciliation.sql`
permaneceu preparada sem aplicação nesta entrega. Seus vínculos não atualizam
financeiro/reembolsos. A RPC antiga só é revogada quando essa migration for aprovada;
a aplicação revisada não a chama e bloqueia confirmação sem readiness nova.

Nova migration **preparada e não aplicada em produção**:
`20261023145056_pluggy_inbox_reconciliation.sql`.

Reutiliza `import_batches`/`import_rows`, sem novas tabelas ou alterações financeiras:

- índice único por usuário/source_key Pluggy e por padrão de regra;
- `stage_pluggy_rows`: entrada idempotente, origem inicial imutável e última versão
  separada; mantém revisões manuais e ID canônico nos reprocessamentos;
- `review_pluggy_row`: classificação ou vínculo explícito a destino existente;
- `save_pluggy_rule`: regra confirmada em metadados de lote, sem excluir histórico;
- `pluggy_inbox_ready`: bloqueia gravações até a migration estar disponível.

Funções SECURITY INVOKER, search_path vazio, auth.uid(), referências próprias,
permissões apenas para authenticated e RLS existente. Nenhuma INSERT/UPDATE/DELETE
em tabelas financeiras nem alteração de políticas. Aprovar/aplicar esta migration
é necessário para salvar regras/classificações/vínculos no Supabase; consultas e
backups locais funcionam antes disso. Não aplicar automaticamente a migration inicial
Organizze de novo: a versão registrada no banco tem timestamp diferente do arquivo.

O filesystem `tmp/` é local. Antes de produção, precisa de armazenamento durável
para os backups e execução da rotina no mesmo host; filesystem efêmero Vercel não
oferece essa garantia. Não foi feito deploy nem prometida persistência em nuvem.

## Endpoints e validação

- `GET /api/pluggy/dashboard`: visão unificada e configurações (sem segredos).
- `GET /api/pluggy/dashboard?action=download&institution=<banco>`: backup próprio.
- `POST /api/pluggy/dashboard`: sync/refresh/review/rule; sessão proprietária, mesma
  origem, itemId fixo no servidor e confirmação explícita para vínculos/regras.
- `GET /api/pluggy/sync`: rotina opcional autenticada por segredo, somente origens.
- A rota antiga `/api/pluggy` permanece compatível com a prévia Nubank anterior.

Comandos: `npm run test:pluggy`, `npm run test:organizze`,
`ORGANIZZE_TEST_CONTAINER=<container local> npm run test:organizze:db`,
`npm run lint`, `npm run build`.

Testes usam fixtures para os cinco bancos e Postgres Docker local com dados
sintéticos. Conferem produtos/páginas, credencial compartilhada, escopos, CSRF,
rotina diária, regras, revisão explícita, repetição e igualdade integral dos registros
financeiros/reembolsos antes/depois da conciliação. Não usam banco real para testes.

Validação de 23/10/2026: **32 testes Pluggy + 35 Organizze + 3 Postgres aprovados**;
`npm run lint` e `npm run build` aprovados. No navegador, sessão Hub autenticada →
nova API → referências RLS/arquivo local → resposta renderizada confirmou os cinco
cartões de instituições com configuração pendente, a caixa de entrada bloqueada
para gravação sem migration e 100 sugestões de regras ainda não confirmadas.
O backup Organizze manteve o SHA-256 da extração anterior.

| Limite verificado | Resultado |
| --- | --- |
| Navegador → API Hub → referências/arquivo → interface | Conferido com sessão real; sem gravação financeira |
| Autenticação/GETs/produtos Pluggy | Conferidos com fixtures; dados bancários reais pendentes de configuração |
| SQL de staging/regras/vínculos e RLS | Conferidos em Postgres Docker local com dados sintéticos |
| Sincronização diária sem navegador | Código/testes prontos; agendamento não criado |

Em 23/10/2026 as duas credenciais e os cinco IDs ainda estão ausentes neste ambiente.
O usuário optou por configurar depois. Nenhum produto real de qualquer banco foi
validado nesta entrega, nenhuma migration foi aplicada em produção e nenhum dado
financeiro oficial foi importado/alterado. O Organizze pode ser desativado quando
os cinco proxies tiverem coleta real conferida, conciliação revisada e pelo menos
um ciclo diário validado com backups duráveis; até lá mantenha o JSON histórico.

Fontes: [Meu Pluggy pessoal](https://meu.pluggy.ai/api-guide),
[autenticação](https://docs.pluggy.ai/en/reference/authentication),
[transações](https://docs.pluggy.ai/en/reference/transaction/transactions-list-by-cursor),
[investimentos](https://docs.pluggy.ai/en/reference/investment/investments-list),
[movimentos de investimentos](https://docs.pluggy.ai/en/reference/investment/investment-transactions-list),
[funções Supabase](https://supabase.com/docs/guides/database/functions).
