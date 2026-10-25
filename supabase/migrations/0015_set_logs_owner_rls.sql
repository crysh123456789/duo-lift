-- Owner-only UPDATE and DELETE for set_logs.
-- user_id is the workout owner (auth.uid() as text). It is filled on insert
-- and cannot be changed. UPDATE WITH CHECK keeps the new user_id equal to
-- auth.uid() and to the station's workout owner, so a series cannot move
-- to someone else.
-- DELETE is granted to authenticated only. anon and public have no policy
-- and no grant. Another signed-in user does not match auth.uid().
-- The app still removes a series with a sync tombstone (soft-delete). This
-- file is applied by Desarrollador after merge. The client does not run it.

create schema if not exists private;

alter table public.set_logs add column if not exists user_id text;

update public.set_logs sl
set user_id = w.user_id
from public.block_stations s
join public.workout_blocks b on b.id = s.block_id
join public.workouts w on w.id = b.workout_id
where sl.station_id = s.id
  and sl.user_id is distinct from w.user_id;

do $$
begin
  if exists (select 1 from public.set_logs where user_id is null) then
    raise exception 'set_logs_owner_missing';
  end if;
end $$;

alter table public.set_logs alter column user_id set not null;

alter table public.set_logs drop constraint if exists set_logs_user_id_fkey;
alter table public.set_logs
  add constraint set_logs_user_id_fkey
  foreign key (user_id) references public.users (id) on delete cascade;

create index if not exists set_logs_user_idx on public.set_logs (user_id);

create or replace function private.set_logs_lock_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text;
begin
  select w.user_id
  into v_owner
  from public.block_stations s
  join public.workout_blocks b on b.id = s.block_id
  join public.workouts w on w.id = b.workout_id
  where s.id = new.station_id;

  if v_owner is null then
    raise exception 'set_owner_missing' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.user_id := v_owner;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'user_id_immutable' using errcode = '42501';
  end if;

  if v_owner is distinct from old.user_id then
    raise exception 'user_id_immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.set_logs_lock_owner() from public, anon, authenticated;

drop trigger if exists set_logs_lock_owner on public.set_logs;
create trigger set_logs_lock_owner
  before insert or update on public.set_logs
  for each row
  execute function private.set_logs_lock_owner();

alter table public.set_logs enable row level security;
alter table public.set_logs force row level security;

drop policy if exists sets_select_own on public.set_logs;
drop policy if exists sets_insert_own on public.set_logs;
drop policy if exists sets_update_own on public.set_logs;
drop policy if exists sets_delete_own on public.set_logs;

create policy sets_select_own on public.set_logs
  for select to authenticated
  using (
    set_logs.deleted_at is null
    and set_logs.user_id = (select auth.uid())::text
    and exists (
      select 1
      from public.block_stations s
      join public.workout_blocks b on b.id = s.block_id
      join public.workouts w on w.id = b.workout_id
      where s.id = set_logs.station_id
        and s.deleted_at is null
        and b.deleted_at is null
        and w.deleted_at is null
        and w.user_id = (select auth.uid())::text
    )
  );

create policy sets_insert_own on public.set_logs
  for insert to authenticated
  with check (
    set_logs.deleted_at is null
    and set_logs.user_id = (select auth.uid())::text
    and exists (
      select 1
      from public.block_stations s
      join public.workout_blocks b on b.id = s.block_id
      join public.workouts w on w.id = b.workout_id
      where s.id = set_logs.station_id
        and s.deleted_at is null
        and b.deleted_at is null
        and w.deleted_at is null
        and w.user_id = (select auth.uid())::text
        and w.user_id = set_logs.user_id
    )
  );

create policy sets_update_own on public.set_logs
  for update to authenticated
  using (
    set_logs.user_id = (select auth.uid())::text
    and exists (
      select 1
      from public.block_stations s
      join public.workout_blocks b on b.id = s.block_id
      join public.workouts w on w.id = b.workout_id
      where s.id = set_logs.station_id
        and w.user_id = (select auth.uid())::text
    )
  )
  with check (
    set_logs.user_id = (select auth.uid())::text
    and exists (
      select 1
      from public.block_stations s
      join public.workout_blocks b on b.id = s.block_id
      join public.workouts w on w.id = b.workout_id
      where s.id = set_logs.station_id
        and w.user_id = set_logs.user_id
        and w.user_id = (select auth.uid())::text
    )
  );

create policy sets_delete_own on public.set_logs
  for delete to authenticated
  using (
    set_logs.user_id = (select auth.uid())::text
    and exists (
      select 1
      from public.block_stations s
      join public.workout_blocks b on b.id = s.block_id
      join public.workouts w on w.id = b.workout_id
      where s.id = set_logs.station_id
        and w.user_id = (select auth.uid())::text
    )
  );

revoke all on table public.set_logs from public, anon;
grant select, insert, update, delete on table public.set_logs to authenticated;

notify pgrst, 'reload schema';
