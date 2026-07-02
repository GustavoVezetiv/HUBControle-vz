alter table public.income_sources
  add column if not exists linked_payment_type text,
  add column if not exists linked_payment_id uuid,
  add column if not exists linked_module text,
  add column if not exists linked_record_id uuid,
  add column if not exists is_generated boolean not null default false,
  add column if not exists linked_credit_card_invoice_id uuid references public.credit_card_invoices(id) on delete set null,
  add column if not exists linked_account_payable_id uuid references public.accounts_payable(id) on delete set null,
  add column if not exists linked_installment_id uuid references public.installments(id) on delete set null,
  add column if not exists linked_reimbursement_id uuid references public.reimbursements(id) on delete set null;

alter table public.accounts_payable
  add column if not exists linked_module text,
  add column if not exists linked_record_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'income_sources_linked_payment_type_check'
      and conrelid = 'public.income_sources'::regclass
  ) then
    alter table public.income_sources
      add constraint income_sources_linked_payment_type_check
      check (
        linked_payment_type is null
        or linked_payment_type in (
          'invoice_payment',
          'installment_payment',
          'reimbursement_receipt',
          'account_payment'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'income_sources_linked_module_check'
      and conrelid = 'public.income_sources'::regclass
  ) then
    alter table public.income_sources
      add constraint income_sources_linked_module_check
      check (
        linked_module is null
        or linked_module in (
          'accounts_payable',
          'credit_card_invoices',
          'credit_card_transactions',
          'installments',
          'reimbursements',
          'income_sources'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_payable_linked_module_check'
      and conrelid = 'public.accounts_payable'::regclass
  ) then
    alter table public.accounts_payable
      add constraint accounts_payable_linked_module_check
      check (
        linked_module is null
        or linked_module in (
          'accounts_payable',
          'credit_card_invoices',
          'credit_card_transactions',
          'installments',
          'reimbursements',
          'income_sources'
        )
      );
  end if;
end $$;

create index if not exists income_sources_linked_invoice_idx
  on public.income_sources(user_id, linked_credit_card_invoice_id)
  where linked_credit_card_invoice_id is not null;

create index if not exists income_sources_linked_account_idx
  on public.income_sources(user_id, linked_account_payable_id)
  where linked_account_payable_id is not null;

create index if not exists income_sources_linked_installment_idx
  on public.income_sources(user_id, linked_installment_id)
  where linked_installment_id is not null;

create index if not exists income_sources_linked_reimbursement_idx
  on public.income_sources(user_id, linked_reimbursement_id)
  where linked_reimbursement_id is not null;

create index if not exists income_sources_linked_module_record_idx
  on public.income_sources(user_id, linked_module, linked_record_id)
  where linked_module is not null
    and linked_record_id is not null;

create index if not exists accounts_payable_linked_module_record_idx
  on public.accounts_payable(user_id, linked_module, linked_record_id)
  where linked_module is not null
    and linked_record_id is not null;

alter table public.accounts_payable
  drop constraint if exists accounts_payable_source_type_check;

alter table public.accounts_payable
  add constraint accounts_payable_source_type_check
  check (source_type in ('manual', 'recurring', 'installment', 'reimbursement', 'invoice_payment'));

create unique index if not exists accounts_payable_unique_invoice_payment_idx
  on public.accounts_payable(user_id, credit_card_invoice_id)
  where source_type = 'invoice_payment'
    and credit_card_invoice_id is not null;

update public.income_sources
set
  linked_module = case linked_payment_type
    when 'invoice_payment' then 'credit_card_invoices'
    when 'installment_payment' then 'installments'
    when 'reimbursement_receipt' then 'reimbursements'
    when 'account_payment' then 'accounts_payable'
    else linked_module
  end,
  linked_record_id = linked_payment_id,
  is_generated = true
where linked_payment_type is not null
  and linked_payment_id is not null
  and (linked_module is null or linked_record_id is null);

update public.accounts_payable
set
  linked_module = 'credit_card_invoices',
  linked_record_id = credit_card_invoice_id,
  is_generated = true
where source_type = 'invoice_payment'
  and credit_card_invoice_id is not null
  and (linked_module is null or linked_record_id is null);

update public.accounts_payable
set
  linked_module = 'installments',
  linked_record_id = installment_id
where source_type = 'installment'
  and installment_id is not null
  and (linked_module is null or linked_record_id is null);
