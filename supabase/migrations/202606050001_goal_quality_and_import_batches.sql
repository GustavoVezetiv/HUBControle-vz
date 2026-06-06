alter table public.goals
  add column if not exists goal_category text not null default 'personal',
  add column if not exists goal_kind text not null default 'qualitative',
  add column if not exists manual_progress_percent numeric,
  add column if not exists urgency_level text not null default 'no_target',
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;

alter table public.goals
  alter column target_amount drop not null,
  alter column current_amount drop not null,
  alter column monthly_contribution drop not null;

alter table public.planned_purchases
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;

alter table public.goals
  drop constraint if exists goals_goal_category_check,
  add constraint goals_goal_category_check
    check (goal_category in ('personal', 'professional', 'course', 'education', 'project'));

alter table public.goals
  drop constraint if exists goals_goal_kind_check,
  add constraint goals_goal_kind_check
    check (goal_kind in ('qualitative', 'financial', 'numeric'));

alter table public.goals
  drop constraint if exists goals_manual_progress_percent_check,
  add constraint goals_manual_progress_percent_check
    check (manual_progress_percent is null or (manual_progress_percent >= 0 and manual_progress_percent <= 100));

alter table public.goals
  drop constraint if exists goals_urgency_level_check,
  add constraint goals_urgency_level_check
    check (urgency_level in ('comfortable', 'attention', 'urgent', 'no_target'));
