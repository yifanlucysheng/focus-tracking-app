-- Rename focus_flame → focus_streak (run once in Supabase SQL Editor)
-- Safe if the column was already renamed.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'focus_flame'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'focus_streak'
  ) then
    alter table public.profiles rename column focus_flame to focus_streak;
  end if;
end $$;
