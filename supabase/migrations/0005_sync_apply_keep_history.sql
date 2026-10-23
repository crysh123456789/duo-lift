-- Fail the upload when a workout does not land, instead of returning ok
-- after silently skipping it. A blank email no longer drops the person
-- (and then every workout of theirs). A duplicate set slot drops the other id
-- in that slot so one serie cannot roll back the whole history. A blank email
-- does not replace an email already stored for that person.
--
-- security invoker, execute granted to service_role only. anon and
-- authenticated stay revoked. The service role bypasses RLS; the browser
-- never receives that key.

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
    left(coalesce(nullif(trim(u.email), ''), u.id || '@duo.lift'), 320),
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
  on conflict (id) do update set
    email = case
      when excluded.email = excluded.id || '@duo.lift' then users.email
      else excluded.email
    end,
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

  -- Same station/round/set slot with a different id would abort the whole upload.
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
      where st.id = sl.station_id and w.duo_id = v_duo_id
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

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(payload->'workouts', '[]'::jsonb)) as w(id text, user_id text)
    where w.id ~ '^[A-Za-z0-9_-]{1,80}$'
      and w.user_id ~ '^[A-Za-z0-9_-]{1,80}$'
      and not exists (
        select 1 from public.workouts existing
        where existing.id = w.id and existing.duo_id = v_duo_id
      )
  ) then
    raise exception 'workout history was not stored';
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

