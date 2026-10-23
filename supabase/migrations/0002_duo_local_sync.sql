-- Duo Lift localStorage sync.
--
-- 0001 modeled ids as uuid and users.id as auth.users. The Zustand store does
-- not: people are `user-cristian` / `user-amigo`, exercises are `ex-banca`,
-- and new rows are uuid *strings* from crypto.randomUUID(). This migration
-- widens those keys to text, adds nutrition / reminders / working loads, and
-- installs sync_apply() for the server (service role only).
--
-- SECURITY DRAFT — Especialista en seguridad, please review before any real
-- phone data is uploaded (keep DUO_LIFT_SYNC_ENABLED=false until then):
--   * RLS is enabled on every public table.
--   * anon and authenticated have no table privileges, so the publishable key
--     cannot read or write through the Data API.
--   * Policies below are the intended duo model once you grant them back to
--     `authenticated`: a JWT whose app_metadata.duo_id (never user_metadata)
--     matches the row. Either person in the duo can read and write that duo's
--     rows. user_id stays attribution, not the ACL, because both people share
--     one unlocked app and switch the active person in the header.
--   * The Next.js route /api/sync is the only writer today. It checks the
--     duo session cookie and calls sync_apply with the service role, which
--     bypasses RLS. Do not ship SUPABASE_SERVICE_ROLE_KEY to the browser.
--   * create_duo / join_duo from 0001 are removed. They are not used by the
--     cookie login. handle_new_user moves to schema private.

-- ---------------------------------------------------------------------------
-- Drop 0001 policies and auth helpers that pin uuid / auth.uid().
-- ---------------------------------------------------------------------------

drop policy if exists users_select on public.users;
drop policy if exists users_update on public.users;
drop policy if exists users_insert on public.users;
drop policy if exists duos_select on public.duos;
drop policy if exists duo_members_select on public.duo_members;
drop policy if exists exercises_select on public.exercise_catalog;
drop policy if exists exercises_insert on public.exercise_catalog;
drop policy if exists workouts_select on public.workouts;
drop policy if exists workouts_insert on public.workouts;
drop policy if exists workouts_update on public.workouts;
drop policy if exists workouts_delete on public.workouts;
drop policy if exists blocks_select on public.workout_blocks;
drop policy if exists blocks_write on public.workout_blocks;
drop policy if exists stations_select on public.block_stations;
drop policy if exists stations_write on public.block_stations;
drop policy if exists sets_select on public.set_logs;
drop policy if exists sets_write on public.set_logs;
drop policy if exists reactions_select on public.reactions;
drop policy if exists reactions_insert on public.reactions;

drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.join_duo(text);
drop function if exists public.create_duo(text);
drop function if exists public.current_duo_id();
drop function if exists public.handle_new_user();

-- ---------------------------------------------------------------------------
-- uuid -> text so client ids round-trip. FKs are recreated below.
-- users.id no longer references auth.users.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select conrelid, conname
    from pg_constraint
    where contype = 'f'
      and conrelid in (
        'public.users'::regclass,
        'public.duos'::regclass,
        'public.duo_members'::regclass,
        'public.exercise_catalog'::regclass,
        'public.workouts'::regclass,
        'public.workout_blocks'::regclass,
        'public.block_stations'::regclass,
        'public.set_logs'::regclass,
        'public.reactions'::regclass
      )
  loop
    execute format('alter table %s drop constraint %I', r.conrelid::regclass, r.conname);
  end loop;
end $$;

alter table public.users alter column id type text using id::text;

alter table public.duos alter column id drop default;
alter table public.duos alter column id type text using id::text;
alter table public.duos alter column id set default gen_random_uuid()::text;

alter table public.duo_members alter column duo_id type text using duo_id::text;
alter table public.duo_members alter column user_id type text using user_id::text;

alter table public.exercise_catalog alter column id drop default;
alter table public.exercise_catalog alter column id type text using id::text;
alter table public.exercise_catalog alter column id set default gen_random_uuid()::text;
alter table public.exercise_catalog alter column created_by_user_id type text using created_by_user_id::text;
alter table public.exercise_catalog alter column duo_id type text using duo_id::text;

alter table public.workouts alter column id drop default;
alter table public.workouts alter column id type text using id::text;
alter table public.workouts alter column id set default gen_random_uuid()::text;
alter table public.workouts alter column user_id type text using user_id::text;
alter table public.workouts alter column duo_id type text using duo_id::text;

alter table public.workout_blocks alter column id drop default;
alter table public.workout_blocks alter column id type text using id::text;
alter table public.workout_blocks alter column id set default gen_random_uuid()::text;
alter table public.workout_blocks alter column workout_id type text using workout_id::text;

alter table public.block_stations alter column id drop default;
alter table public.block_stations alter column id type text using id::text;
alter table public.block_stations alter column id set default gen_random_uuid()::text;
alter table public.block_stations alter column block_id type text using block_id::text;
alter table public.block_stations alter column exercise_id type text using exercise_id::text;

alter table public.set_logs alter column id drop default;
alter table public.set_logs alter column id type text using id::text;
alter table public.set_logs alter column id set default gen_random_uuid()::text;
alter table public.set_logs alter column station_id type text using station_id::text;

alter table public.reactions alter column id drop default;
alter table public.reactions alter column id type text using id::text;
alter table public.reactions alter column id set default gen_random_uuid()::text;
alter table public.reactions alter column workout_id type text using workout_id::text;
alter table public.reactions alter column from_user_id type text using from_user_id::text;

alter table public.users add column if not exists height_cm numeric;
alter table public.users add column if not exists weight_kg numeric;
alter table public.users add column if not exists nutrition_goal text;

alter table public.duo_members
  add constraint duo_members_duo_id_fkey foreign key (duo_id) references public.duos (id) on delete cascade;
alter table public.duo_members
  add constraint duo_members_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;
alter table public.exercise_catalog
  add constraint exercise_catalog_created_by_user_id_fkey foreign key (created_by_user_id) references public.users (id);
alter table public.exercise_catalog
  add constraint exercise_catalog_duo_id_fkey foreign key (duo_id) references public.duos (id) on delete cascade;
alter table public.workouts
  add constraint workouts_user_id_fkey foreign key (user_id) references public.users (id) on delete cascade;
alter table public.workouts
  add constraint workouts_duo_id_fkey foreign key (duo_id) references public.duos (id) on delete cascade;
alter table public.workout_blocks
  add constraint workout_blocks_workout_id_fkey foreign key (workout_id) references public.workouts (id) on delete cascade;
alter table public.block_stations
  add constraint block_stations_block_id_fkey foreign key (block_id) references public.workout_blocks (id) on delete cascade;
alter table public.block_stations
  add constraint block_stations_exercise_id_fkey foreign key (exercise_id) references public.exercise_catalog (id);
alter table public.set_logs
  add constraint set_logs_station_id_fkey foreign key (station_id) references public.block_stations (id) on delete cascade;
alter table public.reactions
  add constraint reactions_workout_id_fkey foreign key (workout_id) references public.workouts (id) on delete cascade;
alter table public.reactions
  add constraint reactions_from_user_id_fkey foreign key (from_user_id) references public.users (id) on delete cascade;

-- 0001 seeded the catalog with random uuids. The client catalog uses stable
-- slugs and is upserted by sync. Drop only rows nothing references yet.
delete from public.exercise_catalog e
where e.duo_id is null
  and e.created_by_user_id is null
  and not exists (select 1 from public.block_stations s where s.exercise_id = e.id);

create table public.food_days (
  id text primary key,
  user_id text not null references public.users (id) on delete cascade,
  duo_id text not null references public.duos (id) on delete cascade,
  date text not null,
  meals jsonb not null,
  comment text not null default '',
  raw_input text,
  updated_at timestamptz not null default now(),
  constraint food_days_user_date_uidx unique (user_id, date)
);

create index food_days_duo_idx on public.food_days (duo_id, date);

create table public.working_loads (
  user_id text not null references public.users (id) on delete cascade,
  exercise_id text not null references public.exercise_catalog (id) on delete cascade,
  weight_kg numeric not null,
  reps integer not null,
  reps_right integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

create table public.duo_reminders (
  duo_id text primary key references public.duos (id) on delete cascade,
  settings jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.sync_tombstones (
  duo_id text not null references public.duos (id) on delete cascade,
  entity text not null,
  entity_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (duo_id, entity, entity_id)
);

-- ---------------------------------------------------------------------------
-- Atomic upsert used by /api/sync. security invoker: only service_role can
-- execute it, and service_role is what bypasses RLS. Not granted to anon.
-- ---------------------------------------------------------------------------

create or replace function public.sync_apply(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_duo_id text;
  rec record;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'payload must be an object';
  end if;
  if jsonb_array_length(coalesce(payload->'sets', '[]'::jsonb)) > 20000
     or jsonb_array_length(coalesce(payload->'workouts', '[]'::jsonb)) > 5000 then
    raise exception 'payload too large';
  end if;

  v_duo_id := payload #>> '{duo,id}';
  if v_duo_id is null or v_duo_id !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'invalid duo id';
  end if;

  insert into public.duos (id, name, invite_code, created_at)
  values (
    v_duo_id,
    coalesce(nullif(trim(payload #>> '{duo,name}'), ''), 'Duo Lift'),
    coalesce(nullif(trim(payload #>> '{duo,invite_code}'), ''), 'GYM2'),
    coalesce((payload #>> '{duo,created_at}')::timestamptz, now())
  )
  on conflict (id) do update set
    name = excluded.name,
    invite_code = excluded.invite_code;

  insert into public.users (
    id, email, display_name, avatar_hue, unit_system, height_cm, weight_kg, nutrition_goal, created_at
  )
  select
    u.id,
    left(u.email, 320),
    left(coalesce(u.display_name, ''), 80),
    coalesce(u.avatar_hue, 78),
    case when u.unit_system = 'lb' then 'lb' else 'kg' end,
    u.height_cm,
    u.weight_kg,
    u.nutrition_goal,
    coalesce(u.created_at, now())
  from jsonb_to_recordset(coalesce(payload->'users', '[]'::jsonb)) as u(
    id text,
    email text,
    display_name text,
    avatar_hue integer,
    unit_system text,
    height_cm numeric,
    weight_kg numeric,
    nutrition_goal text,
    created_at timestamptz
  )
  where u.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and coalesce(u.email, '') <> ''
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    avatar_hue = excluded.avatar_hue,
    unit_system = excluded.unit_system,
    height_cm = excluded.height_cm,
    weight_kg = excluded.weight_kg,
    nutrition_goal = excluded.nutrition_goal;

  insert into public.duo_members (duo_id, user_id, role, joined_at)
  select
    v_duo_id,
    m.user_id,
    case when m.role = 'owner' then 'owner' else 'member' end,
    coalesce(m.joined_at, now())
  from jsonb_to_recordset(coalesce(payload->'members', '[]'::jsonb)) as m(
    user_id text,
    role text,
    joined_at timestamptz
  )
  where m.user_id ~ '^[A-Za-z0-9_-]{1,80}$'
    and exists (select 1 from public.users u where u.id = m.user_id)
  on conflict (duo_id, user_id) do update set
    role = excluded.role;

  insert into public.exercise_catalog (
    id, name, muscle_group, equipment, is_unilateral, created_by_user_id, duo_id
  )
  select
    e.id,
    left(e.name, 200),
    e.muscle_group,
    e.equipment,
    coalesce(e.is_unilateral, false),
    case
      when exists (select 1 from public.users u where u.id = e.created_by_user_id) then e.created_by_user_id
      else null
    end,
    case when e.duo_id = v_duo_id then v_duo_id else null end
  from jsonb_to_recordset(coalesce(payload->'exercises', '[]'::jsonb)) as e(
    id text,
    name text,
    muscle_group text,
    equipment text,
    is_unilateral boolean,
    created_by_user_id text,
    duo_id text
  )
  where e.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and coalesce(e.name, '') <> ''
  on conflict (id) do update set
    name = excluded.name,
    muscle_group = excluded.muscle_group,
    equipment = excluded.equipment,
    is_unilateral = excluded.is_unilateral,
    created_by_user_id = excluded.created_by_user_id,
    duo_id = excluded.duo_id;

  insert into public.workouts (
    id, user_id, duo_id, started_at, ended_at, status, notes, perceived_exertion, title
  )
  select
    w.id,
    w.user_id,
    v_duo_id,
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
    and exists (
      select 1 from public.duo_members m
      where m.duo_id = v_duo_id and m.user_id = w.user_id
    )
  on conflict (id) do update set
    user_id = excluded.user_id,
    duo_id = excluded.duo_id,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    status = excluded.status,
    notes = excluded.notes,
    perceived_exertion = excluded.perceived_exertion,
    title = excluded.title;

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
      where w.id = b.workout_id and w.duo_id = v_duo_id
    )
  on conflict (id) do update set
    workout_id = excluded.workout_id,
    position = excluded.position,
    kind = excluded.kind,
    name = excluded.name,
    target_rounds = excluded.target_rounds,
    rest_between_rounds_sec = excluded.rest_between_rounds_sec,
    rest_sec = excluded.rest_sec;

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
      where b.id = s.block_id and w.duo_id = v_duo_id
    )
  on conflict (id) do update set
    block_id = excluded.block_id,
    exercise_id = excluded.exercise_id,
    position = excluded.position,
    notes = excluded.notes;

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
      where st.id = s.station_id and w.duo_id = v_duo_id
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
    logged_at = excluded.logged_at;

  insert into public.reactions (id, workout_id, from_user_id, kind, body, created_at)
  select
    r.id,
    r.workout_id,
    r.from_user_id,
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
    and exists (select 1 from public.users u where u.id = r.from_user_id)
    and exists (
      select 1 from public.workouts w
      where w.id = r.workout_id and w.duo_id = v_duo_id
    )
  on conflict (id) do update set
    workout_id = excluded.workout_id,
    from_user_id = excluded.from_user_id,
    kind = excluded.kind,
    body = excluded.body;

  delete from public.food_days existing
  using jsonb_to_recordset(coalesce(payload->'food_days', '[]'::jsonb)) as incoming(
    id text,
    user_id text,
    date text
  )
  where existing.duo_id = v_duo_id
    and existing.user_id = incoming.user_id
    and existing.date = incoming.date
    and existing.id is distinct from incoming.id;

  insert into public.food_days (id, user_id, duo_id, date, meals, comment, raw_input, updated_at)
  select
    f.id,
    f.user_id,
    v_duo_id,
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
    and f.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and exists (
      select 1 from public.duo_members m
      where m.duo_id = v_duo_id and m.user_id = f.user_id
    )
  on conflict (id) do update set
    user_id = excluded.user_id,
    duo_id = excluded.duo_id,
    date = excluded.date,
    meals = excluded.meals,
    comment = excluded.comment,
    raw_input = excluded.raw_input,
    updated_at = excluded.updated_at;

  insert into public.working_loads (user_id, exercise_id, weight_kg, reps, reps_right, updated_at)
  select
    l.user_id,
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
  where exists (
      select 1 from public.duo_members m
      where m.duo_id = v_duo_id and m.user_id = l.user_id
    )
    and exists (select 1 from public.exercise_catalog e where e.id = l.exercise_id)
    and l.weight_kg is not null
  on conflict (user_id, exercise_id) do update set
    weight_kg = excluded.weight_kg,
    reps = excluded.reps,
    reps_right = excluded.reps_right,
    updated_at = now();

  if payload ? 'reminders' and jsonb_typeof(payload->'reminders') = 'object' then
    insert into public.duo_reminders (duo_id, settings, updated_at)
    values (v_duo_id, payload->'reminders', now())
    on conflict (duo_id) do update set
      settings = excluded.settings,
      updated_at = now();
  end if;

  for rec in
    select t.entity, t.id as entity_id
    from jsonb_to_recordset(coalesce(payload->'tombstones', '[]'::jsonb)) as t(entity text, id text)
    where t.entity in (
        'workouts', 'blocks', 'stations', 'sets', 'reactions',
        'exercises', 'foodDays', 'workingLoads', 'members'
      )
      and t.id ~ '^[A-Za-z0-9_:-]{1,161}$'
  loop
    if rec.entity = 'sets' then
      delete from public.set_logs sl
      where sl.id = rec.entity_id
        and exists (
          select 1
          from public.block_stations st
          join public.workout_blocks b on b.id = st.block_id
          join public.workouts w on w.id = b.workout_id
          where st.id = sl.station_id and w.duo_id = v_duo_id
        );
    elsif rec.entity = 'reactions' then
      delete from public.reactions r
      where r.id = rec.entity_id
        and exists (
          select 1 from public.workouts w
          where w.id = r.workout_id and w.duo_id = v_duo_id
        );
    elsif rec.entity = 'stations' then
      delete from public.block_stations st
      where st.id = rec.entity_id
        and exists (
          select 1
          from public.workout_blocks b
          join public.workouts w on w.id = b.workout_id
          where b.id = st.block_id and w.duo_id = v_duo_id
        );
    elsif rec.entity = 'blocks' then
      delete from public.workout_blocks b
      where b.id = rec.entity_id
        and exists (
          select 1 from public.workouts w
          where w.id = b.workout_id and w.duo_id = v_duo_id
        );
    elsif rec.entity = 'workouts' then
      delete from public.workouts w
      where w.id = rec.entity_id and w.duo_id = v_duo_id;
    elsif rec.entity = 'foodDays' then
      delete from public.food_days f
      where f.id = rec.entity_id and f.duo_id = v_duo_id;
    elsif rec.entity = 'workingLoads' then
      delete from public.working_loads l
      where l.user_id = split_part(rec.entity_id, ':', 1)
        and l.exercise_id = substr(rec.entity_id, length(split_part(rec.entity_id, ':', 1)) + 2)
        and exists (
          select 1 from public.duo_members m
          where m.duo_id = v_duo_id and m.user_id = l.user_id
        );
    elsif rec.entity = 'exercises' then
      delete from public.exercise_catalog e
      where e.id = rec.entity_id and e.duo_id = v_duo_id;
    elsif rec.entity = 'members' then
      delete from public.duo_members m
      where m.duo_id = v_duo_id
        and rec.entity_id = v_duo_id || ':' || m.user_id;
    end if;

    insert into public.sync_tombstones (duo_id, entity, entity_id, deleted_at)
    values (v_duo_id, rec.entity, rec.entity_id, now())
    on conflict (duo_id, entity, entity_id) do update set
      deleted_at = excluded.deleted_at;
  end loop;

  return jsonb_build_object('ok', true, 'duo_id', v_duo_id);
end;
$$;

revoke all on function public.sync_apply(jsonb) from public;
revoke all on function public.sync_apply(jsonb) from anon, authenticated;
grant execute on function public.sync_apply(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Draft RLS. Grants to anon/authenticated are revoked at the bottom, so these
-- policies do not open the Data API. They document the duo model for review.
-- app_metadata.duo_id is server-controlled. Do not switch this to user_metadata.
-- ---------------------------------------------------------------------------

create or replace function public.jwt_duo_id()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'duo_id', '');
$$;

revoke all on function public.jwt_duo_id() from public;
revoke all on function public.jwt_duo_id() from anon;
grant execute on function public.jwt_duo_id() to authenticated;

create policy users_duo_select on public.users
  for select to authenticated
  using (exists (
    select 1 from public.duo_members m
    where m.user_id = users.id
      and m.duo_id = (select public.jwt_duo_id())
  ));

create policy users_duo_update on public.users
  for update to authenticated
  using (exists (
    select 1 from public.duo_members m
    where m.user_id = users.id
      and m.duo_id = (select public.jwt_duo_id())
  ))
  with check (exists (
    select 1 from public.duo_members m
    where m.user_id = users.id
      and m.duo_id = (select public.jwt_duo_id())
  ));

create policy duos_duo_all on public.duos
  for all to authenticated
  using (id = (select public.jwt_duo_id()))
  with check (id = (select public.jwt_duo_id()));

create policy duo_members_duo_all on public.duo_members
  for all to authenticated
  using (duo_id = (select public.jwt_duo_id()))
  with check (duo_id = (select public.jwt_duo_id()));

create policy exercises_duo_select on public.exercise_catalog
  for select to authenticated
  using (duo_id is null or duo_id = (select public.jwt_duo_id()));

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

create policy workouts_duo_all on public.workouts
  for all to authenticated
  using (duo_id = (select public.jwt_duo_id()))
  with check (duo_id = (select public.jwt_duo_id()));

create policy blocks_duo_all on public.workout_blocks
  for all to authenticated
  using (exists (
    select 1 from public.workouts w
    where w.id = workout_blocks.workout_id
      and w.duo_id = (select public.jwt_duo_id())
  ))
  with check (exists (
    select 1 from public.workouts w
    where w.id = workout_blocks.workout_id
      and w.duo_id = (select public.jwt_duo_id())
  ));

create policy stations_duo_all on public.block_stations
  for all to authenticated
  using (exists (
    select 1
    from public.workout_blocks b
    join public.workouts w on w.id = b.workout_id
    where b.id = block_stations.block_id
      and w.duo_id = (select public.jwt_duo_id())
  ))
  with check (exists (
    select 1
    from public.workout_blocks b
    join public.workouts w on w.id = b.workout_id
    where b.id = block_stations.block_id
      and w.duo_id = (select public.jwt_duo_id())
  ));

create policy sets_duo_all on public.set_logs
  for all to authenticated
  using (exists (
    select 1
    from public.block_stations s
    join public.workout_blocks b on b.id = s.block_id
    join public.workouts w on w.id = b.workout_id
    where s.id = set_logs.station_id
      and w.duo_id = (select public.jwt_duo_id())
  ))
  with check (exists (
    select 1
    from public.block_stations s
    join public.workout_blocks b on b.id = s.block_id
    join public.workouts w on w.id = b.workout_id
    where s.id = set_logs.station_id
      and w.duo_id = (select public.jwt_duo_id())
  ));

create policy reactions_duo_all on public.reactions
  for all to authenticated
  using (exists (
    select 1 from public.workouts w
    where w.id = reactions.workout_id
      and w.duo_id = (select public.jwt_duo_id())
  ))
  with check (exists (
    select 1 from public.workouts w
    where w.id = reactions.workout_id
      and w.duo_id = (select public.jwt_duo_id())
  ));

create policy food_days_duo_all on public.food_days
  for all to authenticated
  using (duo_id = (select public.jwt_duo_id()))
  with check (duo_id = (select public.jwt_duo_id()));

create policy working_loads_duo_all on public.working_loads
  for all to authenticated
  using (exists (
    select 1 from public.duo_members m
    where m.user_id = working_loads.user_id
      and m.duo_id = (select public.jwt_duo_id())
  ))
  with check (exists (
    select 1 from public.duo_members m
    where m.user_id = working_loads.user_id
      and m.duo_id = (select public.jwt_duo_id())
  ));

create policy reminders_duo_all on public.duo_reminders
  for all to authenticated
  using (duo_id = (select public.jwt_duo_id()))
  with check (duo_id = (select public.jwt_duo_id()));

create policy tombstones_duo_select on public.sync_tombstones
  for select to authenticated
  using (duo_id = (select public.jwt_duo_id()));

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
  public.sync_tombstones
from anon, authenticated;

-- Profile row for a future Supabase Auth user. Not used by the duo cookie.
-- Display name comes from the email, not from user-editable user_metadata.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, avatar_hue)
  values (
    new.id::text,
    coalesce(new.email, ''),
    split_part(coalesce(nullif(new.email, ''), 'athlete@duo.lift'), '@', 1),
    abs(hashtext(new.id::text)) % 360
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;
revoke all on function private.handle_new_user() from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant execute on function private.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Custom exercises are referenced by stations with ON DELETE RESTRICT.
-- Deleting a duo-owned exercise (tombstone, or cascade when the duo goes)
-- has to drop those stations first. Global catalog rows stay restricted.
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

notify pgrst, 'reload schema';
