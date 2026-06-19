alter table public.categories
  add column if not exists scopes text[];

comment on column public.categories.scopes
  is 'Optional category scopes. Null or empty behaves as general in the app.';

update public.categories
set scopes = case lower(type::text)
  when 'expense' then array['expense']
  when 'income' then array['income']
  when 'reimbursement' then array['reimbursement']
  when 'debt' then array['expense']
  when 'planned_purchase' then array['purchase']
  when 'purchase' then array['purchase']
  when 'goal' then array['goal']
  when 'places' then array['place']
  when 'leisure' then array['leisure']
  when 'transfer' then array['general']
  when 'other' then array['general']
  when 'general' then array['general']
  else array['general']
end
where scopes is null
   or cardinality(scopes) = 0;
