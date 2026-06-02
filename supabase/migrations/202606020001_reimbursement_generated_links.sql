alter table public.accounts_payable
  add column if not exists reimbursement_id uuid references public.reimbursements(id) on delete set null;

alter table public.credit_card_transactions
  add column if not exists reimbursement_id uuid references public.reimbursements(id) on delete set null;

alter table public.accounts_payable
  drop constraint if exists accounts_payable_source_type_check;

alter table public.accounts_payable
  add constraint accounts_payable_source_type_check
  check (source_type in ('manual', 'recurring', 'installment', 'reimbursement'));

create unique index if not exists accounts_payable_unique_reimbursement_link_idx
  on public.accounts_payable(user_id, reimbursement_id)
  where reimbursement_id is not null;

create unique index if not exists credit_card_transactions_unique_reimbursement_link_idx
  on public.credit_card_transactions(user_id, reimbursement_id)
  where reimbursement_id is not null;
