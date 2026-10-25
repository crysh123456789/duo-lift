-- Soft-delete a series the signed-in user owns.
-- sets_select_own requires deleted_at is null, and PostgreSQL applies that
-- SELECT policy as a WITH CHECK on UPDATE. sync_apply is security invoker,
-- so its UPDATE that sets deleted_at fails with 42501. The definer function
-- below reads auth.uid() itself (no owner argument) and sets deleted_at.
-- 0014 is left as it was. Desarrollador applies this after merge.

create or replace function public.soft_delete_own_set(p_set_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner text := (select auth.uid())::text;
begin
  if v_owner is null or p_set_id is null then
    return false;
  end if;

  update public.set_logs
  set deleted_at = now()
  where id = p_set_id
    and user_id = v_owner
    and deleted_at is null;

  return found;
end;
$$;

revoke all on function public.soft_delete_own_set(text) from public;
revoke execute on function public.soft_delete_own_set(text) from public, anon;
grant execute on function public.soft_delete_own_set(text) to authenticated;

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
  food_date text;
  kept_id text;
  acc_meals jsonb;
  acc_comment text;
  acc_raw text;
  acc_at timestamptz;
  version record;
  payload_has_kept boolean;
  rejected_food jsonb := '[]'::jsonb;
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

  -- food_days: at most 5000 rows and 16777216 bytes (16 MiB). Oversize writes nothing.
  if payload ? 'food_days'
     and jsonb_typeof(payload->'food_days') is distinct from 'array'
     and jsonb_typeof(payload->'food_days') is distinct from 'null' then
    raise exception 'food_days must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(payload->'food_days', '[]'::jsonb)) > 5000 then
    raise exception 'too many food_days' using errcode = '22023';
  end if;
  if octet_length(coalesce(payload->'food_days', '[]'::jsonb)::text) > 16777216 then
    raise exception 'food_days payload too large' using errcode = '54000';
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

  -- Profile columns are written here, as the table owner. authenticated has no UPDATE.
  perform public.apply_synced_user(payload);

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

  -- SELECT policy requires deleted_at is null, so this UPDATE cannot set it.
  perform public.soft_delete_own_set(sl.id)
  from public.set_logs sl
  join jsonb_to_recordset(coalesce(payload->'sets', '[]'::jsonb)) as s(
    id text,
    station_id text,
    round_index integer,
    set_index integer
  )
    on sl.station_id = s.station_id
   and sl.round_index = coalesce(s.round_index, 1)
   and sl.set_index = coalesce(s.set_index, 1)
  where sl.id is distinct from s.id
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

  -- Rows the caller does not own are not written. They come back as rejected.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', rejected_row.id,
        'date', rejected_row.date,
        'reason', rejected_row.reason
      )
      order by rejected_row.id
    ),
    '[]'::jsonb
  )
  into rejected_food
  from (
    select distinct
      f.id,
      f.date,
      case
        when f.user_id is distinct from v_uid then 'other_user'
        else 'foreign_id'
      end as reason
    from jsonb_to_recordset(coalesce(payload->'food_days', '[]'::jsonb)) as f(
      id text,
      user_id text,
      date text
    )
    where f.user_id is distinct from v_uid
       or exists (
         select 1
         from public.food_days foreign_fd
         where foreign_fd.id = f.id
           and foreign_fd.user_id is distinct from v_uid
       )
  ) as rejected_row;

  -- A different id for the same user and date is merged into the live row.
  -- That live row is not deleted and the other id is not inserted.
  for food_date in
    select distinct f.date
    from jsonb_to_recordset(coalesce(payload->'food_days', '[]'::jsonb)) as f(
      id text,
      user_id text,
      date text
    )
    where f.id ~ '^[A-Za-z0-9_-]{1,80}$'
      and f.user_id = v_uid
  and not exists (
    select 1
    from public.food_days foreign_fd
    where foreign_fd.id = f.id
      and foreign_fd.user_id is distinct from v_uid
  )
      and f.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  loop
    kept_id := null;
    select fd.id
    into kept_id
    from public.food_days fd
    where fd.user_id = v_uid
      and fd.date = food_date
      and fd.deleted_at is null
    order by fd.updated_at desc, fd.id desc
    limit 1;

    if kept_id is null then
      select f.id
      into kept_id
      from jsonb_to_recordset(coalesce(payload->'food_days', '[]'::jsonb)) as f(
        id text,
        user_id text,
        date text,
        updated_at timestamptz
      )
      where f.id ~ '^[A-Za-z0-9_-]{1,80}$'
        and f.user_id = v_uid
  and not exists (
    select 1
    from public.food_days foreign_fd
    where foreign_fd.id = f.id
      and foreign_fd.user_id is distinct from v_uid
  )
        and f.date = food_date
      order by coalesce(f.updated_at, now()) desc, f.id desc
      limit 1;
    end if;

    if kept_id is null then
      continue;
    end if;

    select exists (
      select 1
      from jsonb_to_recordset(coalesce(payload->'food_days', '[]'::jsonb)) as f(
        id text,
        user_id text,
        date text
      )
      where f.id = kept_id
        and f.user_id = v_uid
  and not exists (
    select 1
    from public.food_days foreign_fd
    where foreign_fd.id = f.id
      and foreign_fd.user_id is distinct from v_uid
  )
        and f.date = food_date
    ) into payload_has_kept;

    acc_meals := '{}'::jsonb;
    acc_comment := '';
    acc_raw := null;
    acc_at := '-infinity';

    for version in
      select
        versions.meals,
        versions.comment,
        versions.raw_input,
        versions.updated_at,
        versions.id
      from (
        select
          fd.meals,
          coalesce(fd.comment, '') as comment,
          fd.raw_input,
          fd.updated_at,
          fd.id
        from public.food_days fd
        where not payload_has_kept
          and fd.id = kept_id
          and fd.user_id = v_uid
          and fd.deleted_at is null
        union all
        select
          coalesce(f.meals, '{}'::jsonb),
          coalesce(f.comment, ''),
          f.raw_input,
          coalesce(f.updated_at, now()),
          f.id
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
  and not exists (
    select 1
    from public.food_days foreign_fd
    where foreign_fd.id = f.id
      and foreign_fd.user_id is distinct from v_uid
  )
          and f.date = food_date
      ) as versions
      order by versions.updated_at asc, versions.id asc
    loop
      acc_meals := public.merge_food_meals(acc_meals, version.meals);
      if btrim(coalesce(version.comment, '')) <> '' then
        acc_comment := version.comment;
      end if;
      if version.raw_input is not null then
        acc_raw := version.raw_input;
      end if;
      if version.updated_at > acc_at then
        acc_at := version.updated_at;
      end if;
    end loop;

    if acc_at = '-infinity' then
      acc_at := now();
    end if;

    insert into public.food_days (id, user_id, duo_id, date, meals, comment, raw_input, updated_at)
    values (
      kept_id,
      v_uid,
      v_label,
      food_date,
      acc_meals,
      coalesce(acc_comment, ''),
      acc_raw,
      acc_at
    )
    on conflict (id) do update set
      deleted_at = null,
      user_id = v_uid,
      date = excluded.date,
      meals = excluded.meals,
      comment = excluded.comment,
      raw_input = excluded.raw_input,
      updated_at = excluded.updated_at
    where food_days.user_id = v_uid;
  end loop;

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
        'exercises', 'foodDays', 'workingLoads', 'mealItems'
      )
      and t.id ~ '^[A-Za-z0-9_:-]{1,161}$'
  loop
    -- Demo ids stay on the server. Ignore the request and do not record a tombstone.
    if rec.entity_id like 'w-cr-%' or rec.entity_id like 'w-am-%' then
      continue;
    end if;
    v_deleted := 0;
    if rec.entity = 'sets' then
      if public.soft_delete_own_set(rec.entity_id) then
        v_deleted := 1;
      end if;
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
    elsif rec.entity = 'mealItems' then
      -- After the meal merge, drop every copy of an item the phone deleted.
      -- Record the tombstone even when this row was already empty so another
      -- device learns the clear.
      update public.food_days f
      set meals = stripped.meals
      from (
        select fd.id, public.strip_meal_item(fd.meals, rec.entity_id) as meals
        from public.food_days fd
        where fd.user_id = v_uid
          and fd.deleted_at is null
      ) as stripped
      where f.id = stripped.id
        and f.meals is distinct from stripped.meals;
      get diagnostics v_deleted = row_count;
    end if;

    if v_deleted > 0 or rec.entity = 'mealItems' then
      insert into public.user_tombstones (user_id, entity, entity_id, deleted_at)
      values (v_uid, rec.entity, rec.entity_id, now())
      on conflict (user_id, entity, entity_id) do update set
        deleted_at = excluded.deleted_at;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'rejected', jsonb_build_object('food_days', rejected_food)
  );
end;
$$;

revoke all on function public.sync_apply(jsonb) from public;
revoke all on function public.sync_apply(jsonb) from anon;
revoke all on function public.sync_apply(jsonb) from service_role;
grant execute on function public.sync_apply(jsonb) to authenticated;

notify pgrst, 'reload schema';
