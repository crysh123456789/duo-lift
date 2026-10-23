-- Auth per person.
--
-- Supabase Auth owns identity. Each account is auth.users plus a public.users
-- row whose id is auth.uid()::text. RLS is user_id = auth.uid(), not a shared
-- duo id. /api/sync calls sync_apply as the signed-in user (security invoker).
-- service_role is not granted execute and is not the normal path.
--
-- Legacy gym history (user-cristian / user-amigo) can be attached to an account
-- only through private.claim_legacy_history. The winning update is
-- `set claimed_by = auth.uid() where claimed_by is null`. A second account
-- cannot claim the same history. The client does not pass a duo id, and no
-- policy reads duo_id or user_metadata.
--
-- DUO_LIFT_PASSWORD is retired by the app. Delete it from the host after this
-- migration is applied and both people can sign in. See README.

-- ---------------------------------------------------------------------------
-- One-shot legacy claim. private is not an API schema. claimed_by has no
-- ON DELETE SET NULL, so deleting an account does not reopen the history.
-- ---------------------------------------------------------------------------

create table private.legacy_claims (
  legacy_key text primary key,
  legacy_user_id text not null unique,
  claimed_by uuid,
  claimed_at timestamptz,
  constraint legacy_claims_key_chk check (legacy_key in ('cristian', 'kviedes')),
  constraint legacy_claims_pair_chk check (
    (claimed_by is null and claimed_at is null)
    or (claimed_by is not null and claimed_at is not null)
  )
);

create unique index legacy_claims_claimed_by_uidx
  on private.legacy_claims (claimed_by)
  where claimed_by is not null;

insert into private.legacy_claims (legacy_key, legacy_user_id)
values
  ('cristian', 'user-cristian'),
  ('kviedes', 'user-amigo')
on conflict (legacy_key) do nothing;

create table private.history_decisions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  choice text not null,
  decided_at timestamptz not null default now(),
  constraint history_decisions_choice_chk check (choice in ('clean', 'cristian', 'kviedes'))
);

revoke all on table private.legacy_claims from public, anon, authenticated;
revoke all on table private.history_decisions from public, anon, authenticated;

-- Profile numbers copied once at signup. Not an authorization input.
create or replace function private.optional_numeric(raw text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;
  return btrim(raw)::numeric;
exception
  when others then
    return null;
end;
$$;

revoke all on function private.optional_numeric(text) from public, anon, authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  display_name text;
begin
  -- display_name is a profile seed. Policies never read user_metadata.
  display_name := left(
    coalesce(
      nullif(btrim(meta->>'display_name'), ''),
      split_part(coalesce(nullif(new.email, ''), 'athlete@duo.lift'), '@', 1)
    ),
    80
  );
  insert into public.users (id, email, display_name, avatar_hue, height_cm, weight_kg)
  values (
    new.id::text,
    coalesce(new.email, ''),
    display_name,
    abs(hashtext(new.id::text)) % 360,
    private.optional_numeric(meta->>'height_cm'),
    private.optional_numeric(meta->>'weight_kg')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claim and decline. security definer so the rewrite can see legacy rows the
-- caller does not own yet. auth.uid() is the only identity. p_key is an
-- allowlist, not a duo id.
-- ---------------------------------------------------------------------------

create or replace function private.claim_legacy_history(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_claim private.legacy_claims%rowtype;
  v_choice text;
  v_from text;
  v_to text;
  v_email text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_key is null or p_key not in ('cristian', 'kviedes') then
    raise exception 'invalid_history' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('duo-lift-legacy'), hashtext(p_key));

  select choice into v_choice
  from private.history_decisions
  where user_id = v_uid;
  if v_choice is not null and v_choice is distinct from p_key then
    raise exception 'already_decided' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from private.legacy_claims
    where claimed_by = v_uid and legacy_key is distinct from p_key
  ) then
    raise exception 'already_decided' using errcode = 'P0001';
  end if;

  select * into v_claim
  from private.legacy_claims
  where legacy_key = p_key
  for update;

  if not found then
    raise exception 'invalid_history' using errcode = '22023';
  end if;

  if v_claim.claimed_by is not null and v_claim.claimed_by is distinct from v_uid then
    raise exception 'already_claimed' using errcode = 'P0001';
  end if;

  v_from := v_claim.legacy_user_id;
  v_to := v_uid::text;
  v_email := nullif(auth.jwt() ->> 'email', '');

  insert into public.users (id, email, display_name, avatar_hue)
  values (
    v_to,
    coalesce(v_email, v_to || '@duo.lift'),
    left(split_part(coalesce(v_email, 'atleta@duo.lift'), '@', 1), 80),
    abs(hashtext(v_to)) % 360
  )
  on conflict (id) do nothing;

  if v_claim.claimed_by is null then
    begin
      update private.legacy_claims
      set claimed_by = v_uid, claimed_at = now()
      where legacy_key = p_key
        and claimed_by is null;
      if not found then
        raise exception 'already_claimed' using errcode = 'P0001';
      end if;
    exception
      when unique_violation then
        raise exception 'already_decided' using errcode = 'P0001';
    end;

    delete from public.working_loads dest
    using public.working_loads legacy
    where dest.user_id = v_to
      and legacy.user_id = v_from
      and dest.exercise_id = legacy.exercise_id;

    update public.working_loads
    set user_id = v_to
    where user_id = v_from;

    delete from public.food_days legacy
    using public.food_days dest
    where legacy.user_id = v_from
      and dest.user_id = v_to
      and legacy.date = dest.date
      and legacy.updated_at <= dest.updated_at;

    delete from public.food_days dest
    using public.food_days legacy
    where dest.user_id = v_to
      and legacy.user_id = v_from
      and dest.date = legacy.date;

    update public.food_days
    set user_id = v_to
    where user_id = v_from;

    update public.workouts
    set user_id = v_to
    where user_id = v_from;

    update public.reactions
    set from_user_id = v_to
    where from_user_id = v_from;

    update public.exercise_catalog
    set created_by_user_id = v_to
    where created_by_user_id = v_from;

    -- Do not rewrite duo_members. Membership is not an ACL, and attaching the
    -- session to the shared duo would leave duo id open if a policy used it.
    update public.users dest
    set
      height_cm = coalesce(dest.height_cm, src.height_cm),
      weight_kg = coalesce(dest.weight_kg, src.weight_kg),
      nutrition_goal = coalesce(dest.nutrition_goal, src.nutrition_goal)
    from public.users src
    where dest.id = v_to
      and src.id = v_from;
  end if;

  insert into private.history_decisions (user_id, choice)
  values (v_uid, p_key)
  on conflict (user_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'choice', p_key,
    'legacy_user_id', v_from
  );
end;
$$;

create or replace function private.decline_legacy_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_choice text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from private.legacy_claims where claimed_by = v_uid) then
    raise exception 'already_decided' using errcode = 'P0001';
  end if;

  insert into private.history_decisions (user_id, choice)
  values (v_uid, 'clean')
  on conflict (user_id) do nothing;

  select choice into v_choice
  from private.history_decisions
  where user_id = v_uid;

  if v_choice is distinct from 'clean' then
    raise exception 'already_decided' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true, 'choice', 'clean');
end;
$$;

create or replace function private.legacy_history_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_choice text;
  v_open jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select choice into v_choice
  from private.history_decisions
  where user_id = v_uid;

  if v_choice is null then
    select legacy_key into v_choice
    from private.legacy_claims
    where claimed_by = v_uid;
  end if;

  select coalesce(jsonb_agg(legacy_key order by legacy_key), '[]'::jsonb)
  into v_open
  from private.legacy_claims
  where claimed_by is null;

  return jsonb_build_object(
    'decision', v_choice,
    'open', v_open
  );
end;
$$;

grant usage on schema private to authenticated;

revoke all on function private.claim_legacy_history(text) from public, anon;
revoke all on function private.decline_legacy_history() from public, anon;
revoke all on function private.legacy_history_status() from public, anon;
grant execute on function private.claim_legacy_history(text) to authenticated;
grant execute on function private.decline_legacy_history() to authenticated;
grant execute on function private.legacy_history_status() to authenticated;

create or replace function public.claim_legacy_history(p_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.claim_legacy_history(p_key);
$$;

create or replace function public.decline_legacy_history()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.decline_legacy_history();
$$;

create or replace function public.legacy_history_status()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.legacy_history_status();
$$;

revoke all on function public.claim_legacy_history(text) from public, anon;
revoke all on function public.decline_legacy_history() from public, anon;
revoke all on function public.legacy_history_status() from public, anon;
grant execute on function public.claim_legacy_history(text) to authenticated;
grant execute on function public.decline_legacy_history() to authenticated;
grant execute on function public.legacy_history_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Per-user reminders and tombstones. The old duo-scoped tables stay, with no
-- policies and no grants, so a session cannot read the shared duo through them.
-- ---------------------------------------------------------------------------

create table public.user_reminders (
  user_id text primary key references public.users (id) on delete cascade,
  settings jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.user_tombstones (
  user_id text not null references public.users (id) on delete cascade,
  entity text not null,
  entity_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, entity, entity_id)
);

-- ---------------------------------------------------------------------------
-- Drop the duo-wide policies. jwt_duo_id / app_metadata.duo_id is not an ACL.
-- ---------------------------------------------------------------------------

drop policy if exists users_duo_select on public.users;
drop policy if exists users_duo_update on public.users;
drop policy if exists duos_duo_all on public.duos;
drop policy if exists duo_members_duo_all on public.duo_members;
drop policy if exists exercises_duo_select on public.exercise_catalog;
drop policy if exists exercises_duo_insert on public.exercise_catalog;
drop policy if exists exercises_duo_update on public.exercise_catalog;
drop policy if exists exercises_duo_delete on public.exercise_catalog;
drop policy if exists workouts_duo_all on public.workouts;
drop policy if exists blocks_duo_all on public.workout_blocks;
drop policy if exists stations_duo_all on public.block_stations;
drop policy if exists sets_duo_all on public.set_logs;
drop policy if exists reactions_duo_all on public.reactions;
drop policy if exists food_days_duo_all on public.food_days;
drop policy if exists working_loads_duo_all on public.working_loads;
drop policy if exists reminders_duo_all on public.duo_reminders;
drop policy if exists tombstones_duo_select on public.sync_tombstones;

drop function if exists public.jwt_duo_id();

alter table public.user_reminders enable row level security;
alter table public.user_tombstones enable row level security;
alter table public.users enable row level security;
alter table public.duos enable row level security;
alter table public.duo_members enable row level security;
alter table public.exercise_catalog enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_blocks enable row level security;
alter table public.block_stations enable row level security;
alter table public.set_logs enable row level security;
alter table public.reactions enable row level security;
alter table public.food_days enable row level security;
alter table public.working_loads enable row level security;
alter table public.duo_reminders enable row level security;
alter table public.sync_tombstones enable row level security;

-- (select auth.uid()) is planned once per statement, not once per row.
create policy users_select_own on public.users
  for select to authenticated
  using (id = (select auth.uid())::text);

create policy users_update_own on public.users
  for update to authenticated
  using (id = (select auth.uid())::text)
  with check (id = (select auth.uid())::text);

create policy workouts_own on public.workouts
  for all to authenticated
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

create policy food_days_own on public.food_days
  for all to authenticated
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

create policy working_loads_own on public.working_loads
  for all to authenticated
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

create policy reminders_own on public.user_reminders
  for all to authenticated
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

create policy tombstones_own on public.user_tombstones
  for all to authenticated
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

create policy blocks_own on public.workout_blocks
  for all to authenticated
  using (exists (
    select 1 from public.workouts w
    where w.id = workout_blocks.workout_id
      and w.user_id = (select auth.uid())::text
  ))
  with check (exists (
    select 1 from public.workouts w
    where w.id = workout_blocks.workout_id
      and w.user_id = (select auth.uid())::text
  ));

create policy stations_own on public.block_stations
  for all to authenticated
  using (exists (
    select 1
    from public.workout_blocks b
    join public.workouts w on w.id = b.workout_id
    where b.id = block_stations.block_id
      and w.user_id = (select auth.uid())::text
  ))
  with check (exists (
    select 1
    from public.workout_blocks b
    join public.workouts w on w.id = b.workout_id
    where b.id = block_stations.block_id
      and w.user_id = (select auth.uid())::text
  ));

create policy sets_own on public.set_logs
  for all to authenticated
  using (exists (
    select 1
    from public.block_stations s
    join public.workout_blocks b on b.id = s.block_id
    join public.workouts w on w.id = b.workout_id
    where s.id = set_logs.station_id
      and w.user_id = (select auth.uid())::text
  ))
  with check (exists (
    select 1
    from public.block_stations s
    join public.workout_blocks b on b.id = s.block_id
    join public.workouts w on w.id = b.workout_id
    where s.id = set_logs.station_id
      and w.user_id = (select auth.uid())::text
  ));

create policy reactions_select_own on public.reactions
  for select to authenticated
  using (exists (
    select 1 from public.workouts w
    where w.id = reactions.workout_id
      and w.user_id = (select auth.uid())::text
  ));

create policy reactions_insert_own on public.reactions
  for insert to authenticated
  with check (
    from_user_id = (select auth.uid())::text
    and exists (
      select 1 from public.workouts w
      where w.id = reactions.workout_id
        and w.user_id = (select auth.uid())::text
    )
  );

create policy reactions_update_own on public.reactions
  for update to authenticated
  using (
    from_user_id = (select auth.uid())::text
    and exists (
      select 1 from public.workouts w
      where w.id = reactions.workout_id
        and w.user_id = (select auth.uid())::text
    )
  )
  with check (
    from_user_id = (select auth.uid())::text
    and exists (
      select 1 from public.workouts w
      where w.id = reactions.workout_id
        and w.user_id = (select auth.uid())::text
    )
  );

create policy reactions_delete_own on public.reactions
  for delete to authenticated
  using (
    from_user_id = (select auth.uid())::text
    and exists (
      select 1 from public.workouts w
      where w.id = reactions.workout_id
        and w.user_id = (select auth.uid())::text
    )
  );

-- Global catalog (created_by null) is readable. Custom rows are the author's.
-- duo_id is not an access check.
create policy exercises_select_visible on public.exercise_catalog
  for select to authenticated
  using (
    created_by_user_id is null
    or created_by_user_id = (select auth.uid())::text
  );

create policy exercises_insert_own on public.exercise_catalog
  for insert to authenticated
  with check (created_by_user_id = (select auth.uid())::text);

create policy exercises_update_own on public.exercise_catalog
  for update to authenticated
  using (created_by_user_id = (select auth.uid())::text)
  with check (created_by_user_id = (select auth.uid())::text);

create policy exercises_delete_own on public.exercise_catalog
  for delete to authenticated
  using (created_by_user_id = (select auth.uid())::text);

-- duos, duo_members, duo_reminders, sync_tombstones: RLS on, no policy.
-- authenticated cannot read or write them.

-- ---------------------------------------------------------------------------
-- sync_apply writes only auth.uid(). duo id is stored as a required label on
-- workouts (the column is NOT NULL) and is never consulted for access.
-- security invoker: RLS applies to the caller. service_role cannot execute it.
-- ---------------------------------------------------------------------------

create or replace function public.sync_apply(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid text := (select auth.uid())::text;
  v_label text;
  rec record;
  v_deleted integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'payload must be an object';
  end if;
  if jsonb_array_length(coalesce(payload->'sets', '[]'::jsonb)) > 20000
     or jsonb_array_length(coalesce(payload->'workouts', '[]'::jsonb)) > 5000 then
    raise exception 'payload too large';
  end if;

  -- Label only. Missing or unknown ids fall back to the caller's own row, then
  -- the historical duo-1 shell. This does not grant access to that duo.
  v_label := payload #>> '{duo,id}';
  if v_label is null or v_label !~ '^[A-Za-z0-9_-]{1,80}$' then
    v_label := coalesce(
      (select w.duo_id from public.workouts w where w.user_id = v_uid limit 1),
      'duo-1'
    );
  end if;

  update public.users as dest
  set
    email = coalesce(nullif(auth.jwt() ->> 'email', ''), dest.email),
    display_name = case
      when nullif(btrim(src.display_name), '') is null then dest.display_name
      else left(btrim(src.display_name), 80)
    end,
    avatar_hue = coalesce(src.avatar_hue, dest.avatar_hue),
    unit_system = case when src.unit_system = 'lb' then 'lb' else 'kg' end,
    height_cm = src.height_cm,
    weight_kg = src.weight_kg,
    nutrition_goal = case
      when src.nutrition_goal in ('surplus_muscle', 'maintain', 'cut') then src.nutrition_goal
      else dest.nutrition_goal
    end
  from jsonb_to_recordset(coalesce(payload->'users', '[]'::jsonb)) as src(
    id text,
    display_name text,
    avatar_hue integer,
    unit_system text,
    height_cm numeric,
    weight_kg numeric,
    nutrition_goal text
  )
  where dest.id = v_uid
    and src.id = v_uid;

  insert into public.exercise_catalog (
    id, name, muscle_group, equipment, is_unilateral, created_by_user_id, duo_id
  )
  select
    e.id,
    left(e.name, 200),
    e.muscle_group,
    e.equipment,
    coalesce(e.is_unilateral, false),
    v_uid,
    null
  from jsonb_to_recordset(coalesce(payload->'exercises', '[]'::jsonb)) as e(
    id text,
    name text,
    muscle_group text,
    equipment text,
    is_unilateral boolean,
    created_by_user_id text
  )
  where e.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and e.created_by_user_id = v_uid
    and coalesce(e.name, '') <> ''
  on conflict (id) do update set
    name = excluded.name,
    muscle_group = excluded.muscle_group,
    equipment = excluded.equipment,
    is_unilateral = excluded.is_unilateral
  where exercise_catalog.created_by_user_id = v_uid;

  insert into public.workouts (
    id, user_id, duo_id, started_at, ended_at, status, notes, perceived_exertion, title
  )
  select
    w.id,
    v_uid,
    v_label,
    coalesce(w.started_at, now()),
    w.ended_at,
    case
      when w.status in ('in_progress', 'completed', 'abandoned') then w.status
      else 'in_progress'
    end,
    w.notes,
    case when w.perceived_exertion between 1 and 10 then w.perceived_exertion else null end,
    w.title
  from jsonb_to_recordset(coalesce(payload->'workouts', '[]'::jsonb)) as w(
    id text,
    user_id text,
    started_at timestamptz,
    ended_at timestamptz,
    status text,
    notes text,
    perceived_exertion smallint,
    title text
  )
  where w.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and w.user_id = v_uid
  on conflict (id) do update set
    user_id = v_uid,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    status = excluded.status,
    notes = excluded.notes,
    perceived_exertion = excluded.perceived_exertion,
    title = excluded.title
  where workouts.user_id = v_uid;

  insert into public.workout_blocks (
    id, workout_id, position, kind, name, target_rounds, rest_between_rounds_sec, rest_sec
  )
  select
    b.id,
    b.workout_id,
    coalesce(b.position, 1),
    case when b.kind in ('straight', 'circuit', 'rest') then b.kind else 'straight' end,
    b.name,
    coalesce(b.target_rounds, 1),
    b.rest_between_rounds_sec,
    b.rest_sec
  from jsonb_to_recordset(coalesce(payload->'blocks', '[]'::jsonb)) as b(
    id text,
    workout_id text,
    position integer,
    kind text,
    name text,
    target_rounds integer,
    rest_between_rounds_sec integer,
    rest_sec integer
  )
  where b.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and exists (
      select 1 from public.workouts w
      where w.id = b.workout_id and w.user_id = v_uid
    )
  on conflict (id) do update set
    workout_id = excluded.workout_id,
    position = excluded.position,
    kind = excluded.kind,
    name = excluded.name,
    target_rounds = excluded.target_rounds,
    rest_between_rounds_sec = excluded.rest_between_rounds_sec,
    rest_sec = excluded.rest_sec
  where exists (
    select 1 from public.workouts w
    where w.id = workout_blocks.workout_id and w.user_id = v_uid
  );

  insert into public.block_stations (id, block_id, exercise_id, position, notes)
  select
    s.id,
    s.block_id,
    s.exercise_id,
    coalesce(s.position, 1),
    s.notes
  from jsonb_to_recordset(coalesce(payload->'stations', '[]'::jsonb)) as s(
    id text,
    block_id text,
    exercise_id text,
    position integer,
    notes text
  )
  where s.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and exists (select 1 from public.exercise_catalog e where e.id = s.exercise_id)
    and exists (
      select 1
      from public.workout_blocks b
      join public.workouts w on w.id = b.workout_id
      where b.id = s.block_id and w.user_id = v_uid
    )
  on conflict (id) do update set
    block_id = excluded.block_id,
    exercise_id = excluded.exercise_id,
    position = excluded.position,
    notes = excluded.notes
  where exists (
    select 1
    from public.workout_blocks b
    join public.workouts w on w.id = b.workout_id
    where b.id = block_stations.block_id and w.user_id = v_uid
  );

  delete from public.set_logs sl
  using jsonb_to_recordset(coalesce(payload->'sets', '[]'::jsonb)) as s(
    id text,
    station_id text,
    round_index integer,
    set_index integer
  )
  where sl.station_id = s.station_id
    and sl.round_index = coalesce(s.round_index, 1)
    and sl.set_index = coalesce(s.set_index, 1)
    and sl.id is distinct from s.id
    and s.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and exists (
      select 1
      from public.block_stations st
      join public.workout_blocks b on b.id = st.block_id
      join public.workouts w on w.id = b.workout_id
      where st.id = sl.station_id and w.user_id = v_uid
    );

  insert into public.set_logs (
    id, station_id, round_index, set_index, reps, reps_right, weight_kg,
    duration_sec, rpe, is_warmup, completed, logged_at
  )
  select
    s.id,
    s.station_id,
    coalesce(s.round_index, 1),
    coalesce(s.set_index, 1),
    s.reps,
    s.reps_right,
    s.weight_kg,
    s.duration_sec,
    s.rpe,
    coalesce(s.is_warmup, false),
    coalesce(s.completed, false),
    coalesce(s.logged_at, now())
  from jsonb_to_recordset(coalesce(payload->'sets', '[]'::jsonb)) as s(
    id text,
    station_id text,
    round_index integer,
    set_index integer,
    reps integer,
    reps_right integer,
    weight_kg numeric,
    duration_sec integer,
    rpe numeric,
    is_warmup boolean,
    completed boolean,
    logged_at timestamptz
  )
  where s.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and exists (
      select 1
      from public.block_stations st
      join public.workout_blocks b on b.id = st.block_id
      join public.workouts w on w.id = b.workout_id
      where st.id = s.station_id and w.user_id = v_uid
    )
  on conflict (id) do update set
    station_id = excluded.station_id,
    round_index = excluded.round_index,
    set_index = excluded.set_index,
    reps = excluded.reps,
    reps_right = excluded.reps_right,
    weight_kg = excluded.weight_kg,
    duration_sec = excluded.duration_sec,
    rpe = excluded.rpe,
    is_warmup = excluded.is_warmup,
    completed = excluded.completed,
    logged_at = excluded.logged_at
  where exists (
    select 1
    from public.block_stations st
    join public.workout_blocks b on b.id = st.block_id
    join public.workouts w on w.id = b.workout_id
    where st.id = set_logs.station_id and w.user_id = v_uid
  );

  insert into public.reactions (id, workout_id, from_user_id, kind, body, created_at)
  select
    r.id,
    r.workout_id,
    v_uid,
    case when r.kind = 'fire' then 'fire' else 'comment' end,
    r.body,
    coalesce(r.created_at, now())
  from jsonb_to_recordset(coalesce(payload->'reactions', '[]'::jsonb)) as r(
    id text,
    workout_id text,
    from_user_id text,
    kind text,
    body text,
    created_at timestamptz
  )
  where r.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and r.from_user_id = v_uid
    and exists (
      select 1 from public.workouts w
      where w.id = r.workout_id and w.user_id = v_uid
    )
  on conflict (id) do update set
    kind = excluded.kind,
    body = excluded.body
  where reactions.from_user_id = v_uid;

  delete from public.food_days existing
  using jsonb_to_recordset(coalesce(payload->'food_days', '[]'::jsonb)) as incoming(
    id text,
    user_id text,
    date text
  )
  where existing.user_id = v_uid
    and incoming.user_id = v_uid
    and existing.date = incoming.date
    and existing.id is distinct from incoming.id;

  insert into public.food_days (id, user_id, duo_id, date, meals, comment, raw_input, updated_at)
  select
    f.id,
    v_uid,
    v_label,
    f.date,
    coalesce(f.meals, '{}'::jsonb),
    coalesce(f.comment, ''),
    f.raw_input,
    coalesce(f.updated_at, now())
  from jsonb_to_recordset(coalesce(payload->'food_days', '[]'::jsonb)) as f(
    id text,
    user_id text,
    date text,
    meals jsonb,
    comment text,
    raw_input text,
    updated_at timestamptz
  )
  where f.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and f.user_id = v_uid
    and f.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  on conflict (id) do update set
    user_id = v_uid,
    date = excluded.date,
    meals = excluded.meals,
    comment = excluded.comment,
    raw_input = excluded.raw_input,
    updated_at = excluded.updated_at
  where food_days.user_id = v_uid;

  insert into public.working_loads (user_id, exercise_id, weight_kg, reps, reps_right, updated_at)
  select
    v_uid,
    l.exercise_id,
    l.weight_kg,
    coalesce(l.reps, 8),
    l.reps_right,
    now()
  from jsonb_to_recordset(coalesce(payload->'working_loads', '[]'::jsonb)) as l(
    user_id text,
    exercise_id text,
    weight_kg numeric,
    reps integer,
    reps_right integer
  )
  where l.user_id = v_uid
    and l.exercise_id ~ '^[A-Za-z0-9_-]{1,80}$'
    and exists (select 1 from public.exercise_catalog e where e.id = l.exercise_id)
    and l.weight_kg is not null
  on conflict (user_id, exercise_id) do update set
    weight_kg = excluded.weight_kg,
    reps = excluded.reps,
    reps_right = excluded.reps_right,
    updated_at = now()
  where working_loads.user_id = v_uid;

  if payload ? 'reminders' and jsonb_typeof(payload->'reminders') = 'object' then
    insert into public.user_reminders (user_id, settings, updated_at)
    values (v_uid, payload->'reminders', now())
    on conflict (user_id) do update set
      settings = excluded.settings,
      updated_at = now();
  end if;

  for rec in
    select t.entity, t.id as entity_id
    from jsonb_to_recordset(coalesce(payload->'tombstones', '[]'::jsonb)) as t(entity text, id text)
    where t.entity in (
        'workouts', 'blocks', 'stations', 'sets', 'reactions',
        'exercises', 'foodDays', 'workingLoads'
      )
      and t.id ~ '^[A-Za-z0-9_:-]{1,161}$'
  loop
    v_deleted := 0;
    if rec.entity = 'sets' then
      delete from public.set_logs sl
      where sl.id = rec.entity_id
        and exists (
          select 1
          from public.block_stations st
          join public.workout_blocks b on b.id = st.block_id
          join public.workouts w on w.id = b.workout_id
          where st.id = sl.station_id and w.user_id = v_uid
        );
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'reactions' then
      delete from public.reactions r
      where r.id = rec.entity_id
        and r.from_user_id = v_uid
        and exists (
          select 1 from public.workouts w
          where w.id = r.workout_id and w.user_id = v_uid
        );
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'stations' then
      delete from public.block_stations st
      where st.id = rec.entity_id
        and exists (
          select 1
          from public.workout_blocks b
          join public.workouts w on w.id = b.workout_id
          where b.id = st.block_id and w.user_id = v_uid
        );
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'blocks' then
      delete from public.workout_blocks b
      where b.id = rec.entity_id
        and exists (
          select 1 from public.workouts w
          where w.id = b.workout_id and w.user_id = v_uid
        );
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'workouts' then
      delete from public.workouts w
      where w.id = rec.entity_id and w.user_id = v_uid;
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'foodDays' then
      delete from public.food_days f
      where f.id = rec.entity_id and f.user_id = v_uid;
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'workingLoads' then
      delete from public.working_loads l
      where l.user_id = v_uid
        and l.user_id = split_part(rec.entity_id, ':', 1)
        and l.exercise_id = substr(rec.entity_id, length(split_part(rec.entity_id, ':', 1)) + 2);
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'exercises' then
      delete from public.exercise_catalog e
      where e.id = rec.entity_id and e.created_by_user_id = v_uid;
      get diagnostics v_deleted = row_count;
    end if;

    if v_deleted > 0 then
      insert into public.user_tombstones (user_id, entity, entity_id, deleted_at)
      values (v_uid, rec.entity, rec.entity_id, now())
      on conflict (user_id, entity, entity_id) do update set
        deleted_at = excluded.deleted_at;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'user_id', v_uid);
end;
$$;

revoke all on function public.sync_apply(jsonb) from public;
revoke all on function public.sync_apply(jsonb) from anon;
revoke all on function public.sync_apply(jsonb) from service_role;
grant execute on function public.sync_apply(jsonb) to authenticated;

revoke all on table
  public.users,
  public.duos,
  public.duo_members,
  public.exercise_catalog,
  public.workouts,
  public.workout_blocks,
  public.block_stations,
  public.set_logs,
  public.reactions,
  public.food_days,
  public.working_loads,
  public.duo_reminders,
  public.sync_tombstones,
  public.user_reminders,
  public.user_tombstones
from anon, authenticated;

grant select, update on public.users to authenticated;
grant select, insert, update, delete on
  public.workouts,
  public.workout_blocks,
  public.block_stations,
  public.set_logs,
  public.reactions,
  public.food_days,
  public.working_loads,
  public.exercise_catalog,
  public.user_reminders,
  public.user_tombstones
to authenticated;

notify pgrst, 'reload schema';
