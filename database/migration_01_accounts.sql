-- Stage 1 migration (accounts + device binding). Run once in Supabase -> SQL Editor, after schema.sql.

alter table public.profiles
  add column enrollment_no text,
  add column phone text,
  add column device_id text unique;   -- one device can be linked to only one account

alter table public.attendance
  add column method text not null default 'qr' check (method in ('qr','manual')),
  add column device_id text,
  add column marked_by uuid references public.profiles(id);

-- Sign-up trigger: reads the form fields. 'admin' can never be chosen at sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, full_name, role, enrollment_no, phone)
  values (
    new.id,
    coalesce(m->>'full_name', ''),
    case when m->>'role' = 'teacher' then 'teacher' else 'student' end,
    nullif(m->>'enrollment_no', ''),
    nullif(m->>'phone', '')
  );
  return new;
end $$;

-- Privacy: browsers can no longer read phone numbers or device ids (the Flask server still can).
revoke select on public.profiles from anon, authenticated;
grant select (id, full_name, role, enrollment_no, created_at) on public.profiles to authenticated;
