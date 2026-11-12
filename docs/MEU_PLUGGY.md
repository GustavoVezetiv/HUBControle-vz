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
preservando a situação e o motivo de cada um. Pendentes significa aguardar a
liquidação bancária ou revisão de natureza/dados; ignorados são referências
separadas, não itens excluídos. O motivo aparece na própria linha.

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
