-- One-time: convert profiles.xp from legacy lifetime XP → XP toward next level.
-- Old curve: threshold(L) = 100 + (L - 1) * 50
-- Also reconciles focus_level with the level derived from lifetime XP.
--
-- Migrates when:
--   xp >= new next-level threshold for focus_level (invalid as progress), OR
--   xp >= old lifetime total to reach focus_level+1 (clearly past this level)
-- Already-progress rows are left unchanged. Safe-ish to re-run.

do $$
declare
  r record;
  remaining integer;
  lvl integer;
  threshold integer;
  reach_next integer;
  l integer;
  new_next integer;
  should_migrate boolean;
  fl integer;
begin
  for r in select id, focus_level, xp from public.profiles loop
    fl := greatest(coalesce(r.focus_level, 1), 1);

    reach_next := 0;
    for l in 1..fl loop
      reach_next := reach_next + (100 + (l - 1) * 50);
    end loop;

    new_next := 75 + 20 * fl + 5 * fl * fl;

    should_migrate :=
      coalesce(r.xp, 0) >= new_next
      or coalesce(r.xp, 0) >= reach_next;

    if not should_migrate then
      continue;
    end if;

    remaining := greatest(0, coalesce(r.xp, 0));
    lvl := 1;
    loop
      threshold := 100 + (lvl - 1) * 50;
      exit when remaining < threshold or lvl >= 999;
      remaining := remaining - threshold;
      lvl := lvl + 1;
    end loop;

    update public.profiles
    set
      focus_level = lvl,
      xp = remaining
    where id = r.id
      and (focus_level is distinct from lvl or xp is distinct from remaining);
  end loop;
end $$;
