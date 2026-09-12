-- Add session summary fields to profiles (synced from extension/website on session complete).
-- Aggregates only — not full browsing history.
-- Run once in Supabase SQL Editor.

alter table public.profiles
  add column if not exists longest_session_ms integer not null default 0,
  add column if not exists sessions_completed integer not null default 0,
  add column if not exists top_distraction text,
  add column if not exists top_productive_site text,
  add column if not exists character_health integer not null default 0;

alter table public.profiles
  drop constraint if exists profiles_longest_session_ms_nonnegative;
alter table public.profiles
  add constraint profiles_longest_session_ms_nonnegative
  check (longest_session_ms >= 0);

alter table public.profiles
  drop constraint if exists profiles_sessions_completed_nonnegative;
alter table public.profiles
  add constraint profiles_sessions_completed_nonnegative
  check (sessions_completed >= 0);

alter table public.profiles
  drop constraint if exists profiles_character_health_range;
alter table public.profiles
  add constraint profiles_character_health_range
  check (character_health >= 0 and character_health <= 100);
