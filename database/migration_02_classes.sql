-- Join codes and join dates. Safe to run even if you already ran the Stage 2 SQL.
alter table public.classes add column if not exists join_code text unique;
update public.classes set join_code = upper(substr(md5(id::text), 1, 6)) where join_code is null;
alter table public.classes alter column join_code set not null;
alter table public.enrollments
  add column if not exists joined_at timestamptz not null default now(),
  add column if not exists left_at timestamptz;
