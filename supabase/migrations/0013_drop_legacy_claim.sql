-- Drop the legacy claim RPC and stop a null phone goal from wiping the server.
-- 0001 through 0012 are not edited.
--
-- claim_legacy_history is revoked and dropped in public and private, every
-- overload. private.legacy_claims cannot be dropped: decline_legacy_history
-- and legacy_history_status still read it. The rows are deleted and every
-- grant is revoked. The claim-only normalize trigger goes with them.
-- extensions.crypt stays: it may be the real pgcrypto function.
-- private.optional_numeric stays: handle_new_user still calls it.
--
-- sync_apply stays security invoker with search_path = public, same as
-- 0007-0012, so RLS still applies to the signed-in user.
--
-- Before this migration, a null protein_target_g or kcal_target in the
-- payload was written onto public.users (ranges were 1..1000 and 1..20000,
-- and weight_kg was not checked). A phone whose local goal was still null
-- therefore erased a server goal. After this migration:
--   * null or absent does not overwrite a non-null server goal
--   * a null is stored only when that key is present and targets_updated_at
--     is strictly newer than public.users.targets_updated_at
--   * a non-null value may fill a null server goal without a clock
--   * protein_target_g must be an integer in 0..500
--   * kcal_target must be an integer in 0..10000
--   * public.users.weight_kg becomes numeric(5,1); existing values cast in place
--   * weight_kg, when present, is numeric in 20..400 with at most 1 decimal
--     (60.4 is valid; more than one decimal or anything outside 20..400 errors)
--   * targets_updated_at more than 5 minutes ahead of now() errors before any write
--   * food_days limits and rejected.food_days are unchanged

do $drop_claim$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'claim_legacy_history'
      and n.nspname in ('public', 'private')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
    execute format('drop function %s', fn);
  end loop;
end
$drop_claim$;

revoke all on table private.legacy_claims from public, anon, authenticated, service_role;
delete from private.legacy_claims;

drop trigger if exists legacy_claims_normalize_trg on private.legacy_claims;
drop function if exists private.legacy_claims_normalize();

alter table public.users
  add column if not exists targets_updated_at timestamptz;

comment on column public.users.targets_updated_at is
  'Clock for an explicit protein_target_g / kcal_target write or clear. A null phone value cannot overwrite a goal unless its targets_updated_at is strictly newer.';

-- Goals already stored (including ones set in SQL) win against an older phone.
update public.users
set targets_updated_at = now()
where targets_updated_at is null
  and (protein_target_g is not null or kcal_target is not null);

-- The column is integer today. Whole kilograms cast exactly (60 -> 60.0).
-- A value that is already numeric rounds to one decimal, which fits numeric(5,1).
alter table public.users
  alter column weight_kg type numeric(5,1)
  using round(weight_kg::numeric, 1)::numeric(5,1);

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
  user_el jsonb;
  protein_text text;
  kcal_text text;
  weight_text text;
  protein_num numeric;
  kcal_num numeric;
  weight_num numeric;
  targets_at timestamptz;
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

  -- protein_target_g is an integer 0..500 g, kcal_target is an integer 0..10000.
  -- weight_kg, when present, is numeric 20..400 kg with at most one decimal.
  -- A null or absent target must not erase a server goal. Nulling a goal
  -- requires targets_updated_at strictly newer than the row clock.
  -- A clock more than 5 minutes ahead of now() is rejected before any write.
  for user_el in
    select value
    from jsonb_array_elements(coalesce(payload->'users', '[]'::jsonb))
  loop
    if coalesce(user_el->>'id', '') is distinct from v_uid then
      continue;
    end if;

    weight_text := user_el->>'weight_kg';
    if weight_text is not null and btrim(weight_text) <> '' then
      begin
        weight_num := weight_text::numeric;
      exception
        when others then
          raise exception 'weight_kg must have at most 1 decimal' using errcode = '22023';
      end;
      if weight_num <> round(weight_num, 1) then
        raise exception 'weight_kg must have at most 1 decimal' using errcode = '22023';
      end if;
      if weight_num < 20 or weight_num > 400 then
        raise exception 'weight_kg out of range' using errcode = '22023';
      end if;
    end if;

    protein_text := user_el->>'protein_target_g';
    if protein_text is not null and btrim(protein_text) <> '' then
      begin
        protein_num := protein_text::numeric;
      exception
        when others then
          raise exception 'protein_target_g must be an integer' using errcode = '22023';
      end;
      if protein_num <> trunc(protein_num) then
        raise exception 'protein_target_g must be an integer' using errcode = '22023';
      end if;
      if protein_num < 0 or protein_num > 500 then
        raise exception 'protein_target_g out of range' using errcode = '22023';
      end if;
    end if;

    kcal_text := user_el->>'kcal_target';
    if kcal_text is not null and btrim(kcal_text) <> '' then
      begin
        kcal_num := kcal_text::numeric;
      exception
        when others then
          raise exception 'kcal_target must be an integer' using errcode = '22023';
      end;
      if kcal_num <> trunc(kcal_num) then
        raise exception 'kcal_target must be an integer' using errcode = '22023';
      end if;
      if kcal_num < 0 or kcal_num > 10000 then
        raise exception 'kcal_target out of range' using errcode = '22023';
      end if;
    end if;

    if user_el ? 'targets_updated_at'
       and jsonb_typeof(user_el->'targets_updated_at') is distinct from 'null' then
      if nullif(btrim(user_el->>'targets_updated_at'), '') is null then
        raise exception 'targets_updated_at must be a timestamp' using errcode = '22023';
      end if;
      begin
        targets_at := (user_el->>'targets_updated_at')::timestamptz;
      exception
        when others then
          raise exception 'targets_updated_at must be a timestamp' using errcode = '22023';
      end;
      if targets_at > now() + interval '5 minutes' then
        raise exception 'targets_updated_at is more than 5 minutes in the future'
          using errcode = '22023';
      end if;
    end if;
  end loop;

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
      when (user_row ? 'targets_updated_at')
       and src.targets_updated_at is not null
       and (dest.targets_updated_at is null or src.targets_updated_at > dest.targets_updated_at)
       and (user_row ? 'protein_target_g')
      then src.protein_target_g
      when dest.protein_target_g is not null then dest.protein_target_g
      when src.protein_target_g is not null
       and (user_row ? 'protein_target_g')
       and not (
         (user_row ? 'targets_updated_at')
         and src.targets_updated_at is not null
         and dest.targets_updated_at is not null
         and src.targets_updated_at <= dest.targets_updated_at
       )
      then src.protein_target_g
      else dest.protein_target_g
    end,
    kcal_target = case
      when (user_row ? 'targets_updated_at')
       and src.targets_updated_at is not null
       and (dest.targets_updated_at is null or src.targets_updated_at > dest.targets_updated_at)
       and (user_row ? 'kcal_target')
      then src.kcal_target
      when dest.kcal_target is not null then dest.kcal_target
      when src.kcal_target is not null
       and (user_row ? 'kcal_target')
       and not (
         (user_row ? 'targets_updated_at')
         and src.targets_updated_at is not null
         and dest.targets_updated_at is not null
         and src.targets_updated_at <= dest.targets_updated_at
       )
      then src.kcal_target
      else dest.kcal_target
    end,
    targets_updated_at = case
      when (user_row ? 'targets_updated_at')
       and src.targets_updated_at is not null
       and (dest.targets_updated_at is null or src.targets_updated_at > dest.targets_updated_at)
       and ((user_row ? 'protein_target_g') or (user_row ? 'kcal_target'))
      then src.targets_updated_at
      when dest.targets_updated_at is null
       and (
         (src.protein_target_g is not null and (user_row ? 'protein_target_g') and dest.protein_target_g is null)
         or (src.kcal_target is not null and (user_row ? 'kcal_target') and dest.kcal_target is null)
       )
      then now()
      else dest.targets_updated_at
    end
  from jsonb_array_elements(coalesce(payload->'users', '[]'::jsonb)) as payload_user(user_row)
  cross join lateral jsonb_to_record(user_row) as src(
    id text,
    display_name text,
    avatar_hue integer,
    unit_system text,
    height_cm numeric,
    weight_kg numeric,
    nutrition_goal text,
    protein_target_g integer,
    kcal_target integer,
    targets_updated_at timestamptz
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
