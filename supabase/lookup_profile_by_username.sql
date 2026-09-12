-- Allow finding a user by username when sending a friend request.
-- Needed when profiles SELECT RLS is tighter than "read all profiles"
-- (otherwise Add Friend only works for people you can already see).
--
-- Run in Supabase → SQL Editor.

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
