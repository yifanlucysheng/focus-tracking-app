-- Focus Buddy profiles
-- Run in Supabase → SQL Editor

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  focus_level integer not null default 1,
  xp integer not null default 0,
  focus_streak integer not null default 0,
  longest_session_ms integer not null default 0,
  sessions_completed integer not null default 0,
  top_distraction text,
  top_productive_site text,
  character_health integer not null default 0,
  created_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(username) between 3 and 24),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]+$')
);

create unique index if not exists profiles_username_unique
  on public.profiles (username);

alter table public.profiles enable row level security;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists "Anyone can check usernames" on public.profiles;
create policy "Anyone can check usernames"
  on public.profiles
  for select
  to anon
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Friend lookup by username (bypasses SELECT RLS so Add Friend works for new people).
create or replace function public.lookup_profile_by_username(requested_username text)
returns table (
  id uuid,
  username text,
  focus_level integer,
  xp integer,
  focus_streak integer,
  longest_session_ms integer,
  sessions_completed integer,
  top_distraction text,
  top_productive_site text,
  character_health integer,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.username,
    p.focus_level,
    p.xp,
    p.focus_streak,
    p.longest_session_ms,
    p.sessions_completed,
    p.top_distraction,
    p.top_productive_site,
    p.character_health,
    p.created_at
  from public.profiles p
  where p.username = lower(trim(both from coalesce(requested_username, '')))
  limit 1;
$$;

revoke all on function public.lookup_profile_by_username(text) from public;
grant execute on function public.lookup_profile_by_username(text) to authenticated;
grant execute on function public.lookup_profile_by_username(text) to anon;

-- Auto-create a profiles row when a new auth user is created (username from signup metadata).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uname text;
begin
  uname := lower(trim(coalesce(new.raw_user_meta_data->>'username', '')));
  if uname ~ '^[a-z0-9_]{3,24}$' then
    insert into public.profiles (id, username, focus_level, xp, focus_streak)
    values (new.id, uname, 1, 0, 0)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
