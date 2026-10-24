-- Manual protein (g/day) and calorie targets, per user.
-- Null until that person sets them. This file does not insert a default.
-- 0007 and 0008 are unchanged. sync_apply is replaced only to persist the new columns.

alter table public.users add column if not exists protein_target_g integer;
alter table public.users add column if not exists kcal_target integer;

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
    end,
    protein_target_g = case
      when src.protein_target_g is null then null
      when src.protein_target_g between 1 and 1000 then src.protein_target_g
      else dest.protein_target_g
    end,
    kcal_target = case
      when src.kcal_target is null then null
      when src.kcal_target between 1 and 20000 then src.kcal_target
      else dest.kcal_target
    end
  from jsonb_to_recordset(coalesce(payload->'users', '[]'::jsonb)) as src(
    id text,
    display_name text,
    avatar_hue integer,
    unit_system text,
    height_cm numeric,
    weight_kg numeric,
    nutrition_goal text,
    protein_target_g integer,
    kcal_target integer
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
    deleted_at = null,
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
    deleted_at = null,
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
    deleted_at = null,
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
    deleted_at = null,
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

  update public.set_logs sl
  set deleted_at = now()
  from jsonb_to_recordset(coalesce(payload->'sets', '[]'::jsonb)) as s(
    id text,
    station_id text,
    round_index integer,
    set_index integer
  )
  where sl.station_id = s.station_id
    and sl.round_index = coalesce(s.round_index, 1)
    and sl.set_index = coalesce(s.set_index, 1)
    and sl.id is distinct from s.id
    and sl.deleted_at is null
    and sl.id not like 'w-cr-%'
    and sl.id not like 'w-am-%'
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
    deleted_at = null,
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
    deleted_at = null,
    kind = excluded.kind,
    body = excluded.body
  where reactions.from_user_id = v_uid;

  update public.food_days existing
  set deleted_at = now()
  from jsonb_to_recordset(coalesce(payload->'food_days', '[]'::jsonb)) as incoming(
    id text,
    user_id text,
    date text
  )
  where existing.user_id = v_uid
    and incoming.user_id = v_uid
    and existing.date = incoming.date
    and existing.id is distinct from incoming.id
    and existing.deleted_at is null
    and existing.id not like 'w-cr-%'
    and existing.id not like 'w-am-%';

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
    deleted_at = null,
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
    deleted_at = null,
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
    -- Demo ids stay on the server. Ignore the request and do not record a tombstone.
    if rec.entity_id like 'w-cr-%' or rec.entity_id like 'w-am-%' then
      continue;
    end if;
    v_deleted := 0;
    if rec.entity = 'sets' then
      update public.set_logs sl
      set deleted_at = now()
      where sl.id = rec.entity_id
        and sl.deleted_at is null
        and exists (
          select 1
          from public.block_stations st
          join public.workout_blocks b on b.id = st.block_id
          join public.workouts w on w.id = b.workout_id
          where st.id = sl.station_id and w.user_id = v_uid
        );
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'reactions' then
      update public.reactions r
      set deleted_at = now()
      where r.id = rec.entity_id
        and r.deleted_at is null
        and r.from_user_id = v_uid
        and exists (
          select 1 from public.workouts w
          where w.id = r.workout_id and w.user_id = v_uid
        );
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'stations' then
      update public.block_stations st
      set deleted_at = now()
      where st.id = rec.entity_id
        and st.deleted_at is null
        and exists (
          select 1
          from public.workout_blocks b
          join public.workouts w on w.id = b.workout_id
          where b.id = st.block_id and w.user_id = v_uid
        );
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'blocks' then
      update public.workout_blocks b
      set deleted_at = now()
      where b.id = rec.entity_id
        and b.deleted_at is null
        and exists (
          select 1 from public.workouts w
          where w.id = b.workout_id and w.user_id = v_uid
        );
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'workouts' then
      update public.workouts w
      set deleted_at = now()
      where w.id = rec.entity_id
        and w.deleted_at is null
        and w.user_id = v_uid;
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'foodDays' then
      update public.food_days f
      set deleted_at = now()
      where f.id = rec.entity_id
        and f.deleted_at is null
        and f.user_id = v_uid;
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'workingLoads' then
      update public.working_loads l
      set deleted_at = now()
      where l.deleted_at is null
        and l.user_id = v_uid
        and l.user_id = split_part(rec.entity_id, ':', 1)
        and l.exercise_id = substr(rec.entity_id, length(split_part(rec.entity_id, ':', 1)) + 2);
      get diagnostics v_deleted = row_count;
    elsif rec.entity = 'exercises' then
      update public.exercise_catalog e
      set deleted_at = now()
      where e.id = rec.entity_id
        and e.deleted_at is null
        and e.created_by_user_id = v_uid;
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

notify pgrst, 'reload schema';
