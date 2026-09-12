-- Focus Buddy friendships
-- Run in Supabase → SQL Editor (after profiles.sql)

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now(),
  constraint friendships_status_check
    check (status in ('pending', 'accepted', 'rejected')),
  constraint friendships_no_self_check
    check (requester_id <> addressee_id)
);

-- One active friendship (pending or accepted) per unordered pair of users.
-- Rejected rows are excluded so a later re-request is allowed.
create unique index if not exists friendships_unique_active_pair
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  )
  where status in ('pending', 'accepted');

create index if not exists friendships_requester_status_idx
  on public.friendships (requester_id, status);

create index if not exists friendships_addressee_status_idx
  on public.friendships (addressee_id, status);

alter table public.friendships enable row level security;

-- Users can read friendships they are part of.
create policy "Users can read own friendships"
  on public.friendships
  for select
  to authenticated
  using (
    auth.uid() = requester_id
    or auth.uid() = addressee_id
  );

-- Users can send friend requests as themselves (pending only).
create policy "Users can send friend requests"
  on public.friendships
  for insert
  to authenticated
  with check (
    auth.uid() = requester_id
    and status = 'pending'
  );

-- Addressee can accept or reject a pending request.
create policy "Addressee can respond to pending requests"
  on public.friendships
  for update
  to authenticated
  using (
    auth.uid() = addressee_id
    and status = 'pending'
  )
  with check (
    auth.uid() = addressee_id
    and status in ('accepted', 'rejected')
  );
