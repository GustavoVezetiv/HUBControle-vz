# Category Scopes

O Hub VZ agora suporta `scopes` em `categories` para controlar em quais telas cada categoria pode aparecer.

## Regras

- Uma categoria pode ter mais de um escopo.
- Categoria sem `scopes` continua funcionando e o app usa fallback pelo `type`.
- Registros antigos nao sao removidos nem perdem a categoria atual.
- Quando um registro antigo usa categoria fora do escopo da tela, a UI mostra aviso e permite trocar.

## Escopos usados agora

- `expense`
- `income`
- `reimbursement`
- `purchase`
- `goal`
- `invoice`
- `place`
- `leisure`
- `routine`
- `professional`
- `general`

## Filtros por tela

- Contas: `expense`, `general`
- Receitas: `income`, `general`
- Reembolsos: `reimbursement`, `expense`, `general`
- Compras e desejos: `purchase`, `general`
- Metas: `goal`, `general`
- Faturas e lancamentos: `expense`, `invoice`, `general`
- Roles e lugares: `place`, `leisure`, `general`

## Migracao

Rodar a migration `supabase/migrations/202606190002_add_category_scopes.sql` no Supabase antes de testar em ambiente remoto.
