-- Focus Buddy profiles
-- Run in Supabase → SQL Editor

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  focus_level integer not null default 1,
  xp integer not null default 0,
  focus_flame integer not null default 0,
  created_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(username) between 3 and 24),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]+$')
);

create unique index if not exists profiles_username_unique
  on public.profiles (username);

alter table public.profiles enable row level security;

-- Authenticated users can read profiles (needed later for friends-by-username).
create policy "Authenticated users can read profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

-- Allow username availability checks during sign-up (before a session exists).
create policy "Anyone can check usernames"
  on public.profiles
  for select
  to anon
  using (true);

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
