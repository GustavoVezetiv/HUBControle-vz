# Importações em produção — 13/11/2026

## Fluxo restaurado

`/dashboard/imports` abre a Caixa de Entrada Financeira com os componentes atuais:
indicadores, gráfico, seis abas, identificação de bancos e filtros. A rota
`/dashboard/imports/pluggy` continua compatível. Planilhas CSV/XLSX ficam em
`/dashboard/imports/manual`; os acessos Organizze continuam disponíveis nessa tela.

A configuração Production exige `PLUGGY_HUB_USER_ID` e
`ORGANIZZE_HUB_USER_ID` iguais ao proprietário autenticado da integração.
Não inferir o proprietário pela primeira pessoa que abrir a página e não remover
a restrição de usuário. As credenciais MCP existentes permanecem inalteradas.

## Persistência dos históricos

Localmente os snapshots continuam em `tmp/pluggy-backups` e
`tmp/organizze-backups`. Na Vercel eles usam Supabase Storage, bucket privado
`hub-import-backups`, prefixo `<owner>/<source>/<backupId>/`. O acesso acontece
somente no servidor, depois da sessão proprietária. Nenhuma política pública ou
URL pública é criada. Um bucket público é recusado. O SDK existente usa a chave
server-only já configurada, sem fornecer essa chave ao navegador.

O bucket é provisionado privado quando ausente. Não há migration nas tabelas
financeiras. Novas coletas são imutáveis, persistem entre deploys e as leituras
acumulam as janelas anteriores sem inferir exclusões.

A seção “Restaurar históricos de origem” aceita os JSON já exportados pelo Hub.
O navegador compacta cada arquivo (máximo 4 MiB compactado, 80 MiB descompactado)
para respeitar o limite de request da Vercel. O endpoint valida origem, sessão,
proprietário, estrutura e conexão; identifica a cópia pelo conteúdo e verifica a
leitura de volta. Repetir a mesma restauração não duplica o snapshot.
Ela só preserva histórico de origem: não executa RPCs de criação de despesas,
receitas, reembolsos ou confirmação de importação.

Alternativa administrativa: `scripts/migrate-import-backups.mjs --owner UUID
--project REF` valida todos os arquivos sem escrever; `--apply` copia e confere
SHA-256. A chave administrativa deve vir do ambiente seguro, nunca de argumentos
ou do Git. Os arquivos locais são preservados em ambos os fluxos.

## Validação

- `npm run test:imports`: fixtures Pluggy/Organizze, isolamento, bucket privado,
  paginação, falhas de transporte, CSRF, proprietário e restauração idempotente.
- `npm run test:mcp`, `npm run lint`, `npm run build`.
- Navegador: menu Importações → indicadores/abas → histórico com dados;
  importação manual acessível; conexão MCP consultando perfil após o deploy.

A recuperação operacional não confirma nenhum lançamento financeiro. A revisão
e as confirmações já existentes para conciliação e importação são mantidas.
