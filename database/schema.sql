-- QR Attendance schema. Run once in Supabase -> SQL Editor.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student','teacher','admin')),
  created_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  teacher_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.enrollments (
  class_id uuid references public.classes(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  primary key (class_id, student_id)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id),
  is_active boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Holds the per-session signing secret. RLS on + no policies = only the server can read it.
create table public.session_secrets (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  secret text not null
);

create table public.attendance (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  marked_at timestamptz not null default now(),
  unique (session_id, student_id)
);

-- New sign-ups always start as 'student'. Roles are changed only by an admin (dashboard/SQL).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Helper functions (security definer) so policies don't recurse into each other.
create function public.my_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() $$;
create function public.teaches(cid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes where id = cid and teacher_id = auth.uid()) $$;
create function public.enrolled_in(cid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.enrollments where class_id = cid and student_id = auth.uid()) $$;

alter table public.profiles        enable row level security;
alter table public.classes         enable row level security;
alter table public.enrollments     enable row level security;
alter table public.sessions        enable row level security;
alter table public.session_secrets enable row level security;
alter table public.attendance      enable row level security;

-- Read-only policies. All writes go through the Flask server (service_role key) or the dashboard.
create policy "profiles read" on public.profiles for select using (
  id = auth.uid() or public.my_role() = 'admin'
  or exists (select 1 from public.enrollments e where e.student_id = profiles.id and public.teaches(e.class_id))
);
create policy "classes read" on public.classes for select using (
  teacher_id = auth.uid() or public.enrolled_in(id) or public.my_role() = 'admin'
);
create policy "enrollments read" on public.enrollments for select using (
  student_id = auth.uid() or public.teaches(class_id) or public.my_role() = 'admin'
);
create policy "sessions read" on public.sessions for select using (
  teacher_id = auth.uid() or public.my_role() = 'admin'
);
create policy "attendance read" on public.attendance for select using (
  student_id = auth.uid() or public.my_role() = 'admin'
  or exists (select 1 from public.sessions s where s.id = attendance.session_id and s.teacher_id = auth.uid())
);

-- Real-time: the teacher's page subscribes to new attendance rows (RLS still applies).
alter publication supabase_realtime add table public.attendance;
