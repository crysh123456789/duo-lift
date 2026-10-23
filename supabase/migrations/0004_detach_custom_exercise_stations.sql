-- Duo-owned exercises are referenced by block_stations with ON DELETE RESTRICT.
-- A tombstone (or deleting the duo, which cascades to that exercise) has to
-- remove those stations first. Global catalog rows (duo_id is null) stay
-- restricted so a shared exercise cannot be wiped out from under a workout.
--
-- If Seguridad later grants DELETE on exercise_catalog to authenticated,
-- also grant execute on private.detach_exercise_stations() to that role.
-- The function lives in private so PostgREST does not expose it.

create or replace function private.detach_exercise_stations()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.duo_id is not null then
    delete from public.block_stations where exercise_id = old.id;
  end if;
  return old;
end;
$$;

revoke all on function private.detach_exercise_stations() from public;
revoke all on function private.detach_exercise_stations() from anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.detach_exercise_stations() to service_role;

drop trigger if exists exercise_catalog_detach_stations on public.exercise_catalog;
create trigger exercise_catalog_detach_stations
  before delete on public.exercise_catalog
  for each row execute function private.detach_exercise_stations();
