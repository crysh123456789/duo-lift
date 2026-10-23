-- Follow-up for databases that already applied the first draft of 0002.
-- Fresh installs that run the updated 0002 already have these indexes and
-- the split exercise policies. This file is idempotent either way.
--
-- exercises_duo_write was FOR ALL, so SELECT matched it and exercises_duo_select.
-- Split writes so the catalog SELECT policy stays the only one.

drop policy if exists exercises_duo_write on public.exercise_catalog;
drop policy if exists exercises_duo_insert on public.exercise_catalog;
drop policy if exists exercises_duo_update on public.exercise_catalog;
drop policy if exists exercises_duo_delete on public.exercise_catalog;

create policy exercises_duo_insert on public.exercise_catalog
  for insert to authenticated
  with check (duo_id = (select public.jwt_duo_id()));

create policy exercises_duo_update on public.exercise_catalog
  for update to authenticated
  using (duo_id = (select public.jwt_duo_id()))
  with check (duo_id = (select public.jwt_duo_id()));

create policy exercises_duo_delete on public.exercise_catalog
  for delete to authenticated
  using (duo_id = (select public.jwt_duo_id()));

create index if not exists block_stations_exercise_id_idx
  on public.block_stations (exercise_id);
create index if not exists exercise_catalog_created_by_user_id_idx
  on public.exercise_catalog (created_by_user_id);
create index if not exists exercise_catalog_duo_id_idx
  on public.exercise_catalog (duo_id);
create index if not exists reactions_from_user_id_idx
  on public.reactions (from_user_id);
create index if not exists reactions_workout_id_idx
  on public.reactions (workout_id);
create index if not exists working_loads_exercise_id_idx
  on public.working_loads (exercise_id);
