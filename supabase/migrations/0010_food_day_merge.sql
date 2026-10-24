-- Recover a food day instead of dropping it.
-- 0007, 0008, and 0009 are not edited.
-- Same user and date: merge meals per slot (newer item wins, empty slots do not erase).
-- A duplicate id is soft-deleted only after that merge. Hard delete is not used.
-- food_days_history keeps the previous row on update and delete.

create table if not exists public.food_days_history (
  history_id bigint generated always as identity primary key,
  food_day_id text not null,
  user_id text not null,
  duo_id text not null,
  date text not null,
  meals jsonb not null,
  comment text not null default '',
  raw_input text,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  operation text not null,
  recorded_at timestamptz not null default now(),
  constraint food_days_history_operation_chk check (operation in ('UPDATE', 'DELETE'))
);

create index if not exists food_days_history_user_date_idx
  on public.food_days_history (user_id, date, recorded_at);

create index if not exists food_days_history_food_day_idx
  on public.food_days_history (food_day_id, recorded_at);

alter table public.food_days_history enable row level security;

drop policy if exists food_days_history_select_own on public.food_days_history;
create policy food_days_history_select_own on public.food_days_history
  for select to authenticated
  using (user_id = (select auth.uid())::text);

revoke all on table public.food_days_history from public, anon, authenticated;
grant select on table public.food_days_history to authenticated;

create or replace function public.food_days_history_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $history$
begin
  insert into public.food_days_history (
    food_day_id,
    user_id,
    duo_id,
    date,
    meals,
    comment,
    raw_input,
    updated_at,
    deleted_at,
    operation
  ) values (
    old.id,
    old.user_id,
    old.duo_id,
    old.date,
    old.meals,
    old.comment,
    old.raw_input,
    old.updated_at,
    old.deleted_at,
    tg_op
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$history$;

drop trigger if exists food_days_history_trg on public.food_days;
create trigger food_days_history_trg
  before update or delete on public.food_days
  for each row
  execute function public.food_days_history_capture();

revoke all on function public.food_days_history_capture() from public, anon, authenticated;

create or replace function public.normalize_meal_slot(slot jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  items jsonb := '[]'::jsonb;
begin
  if slot is null or slot = 'null'::jsonb then
    return jsonb_build_object('time', null, 'items', '[]'::jsonb, 'note', '');
  end if;
  if jsonb_typeof(slot) = 'string' then
    return jsonb_build_object('time', null, 'items', '[]'::jsonb, 'note', coalesce(slot #>> '{}', ''));
  end if;
  if jsonb_typeof(slot) <> 'object' then
    return jsonb_build_object('time', null, 'items', '[]'::jsonb, 'note', '');
  end if;
  if jsonb_typeof(slot->'items') = 'array' then
    items := slot->'items';
  end if;
  return jsonb_build_object(
    'time', case
      when jsonb_typeof(slot->'time') = 'string' and btrim(slot->>'time') <> '' then to_jsonb(btrim(slot->>'time'))
      else 'null'::jsonb
    end,
    'items', items,
    'note', coalesce(slot->>'note', '')
  );
end;
$fn$;

create or replace function public.meal_slot_empty(slot jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $fn$
declare
  obj jsonb := public.normalize_meal_slot(slot);
  item jsonb;
begin
  if btrim(coalesce(obj->>'note', '')) <> '' then
    return false;
  end if;
  if obj->'time' <> 'null'::jsonb and btrim(coalesce(obj->>'time', '')) <> '' then
    return false;
  end if;
  for item in select value from jsonb_array_elements(coalesce(obj->'items', '[]'::jsonb))
  loop
    if jsonb_typeof(item) = 'object' and (
      btrim(coalesce(item->>'name', '')) <> ''
      or jsonb_typeof(item->'grams') = 'number'
      or jsonb_typeof(item->'proteinG') = 'number'
      or jsonb_typeof(item->'carbsG') = 'number'
      or jsonb_typeof(item->'fatG') = 'number'
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$fn$;

create or replace function public.merge_meal_items(older jsonb, newer jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  result jsonb := '[]'::jsonb;
  item jsonb;
  seen text[] := array[]::text[];
  item_id text;
  replacement jsonb;
begin
  for item in select value from jsonb_array_elements(coalesce(older, '[]'::jsonb))
  loop
    item_id := coalesce(item->>'id', '');
    replacement := item;
    if item_id <> '' then
      if item_id = any(seen) then
        continue;
      end if;
      select found.value into replacement
      from jsonb_array_elements(coalesce(newer, '[]'::jsonb)) as found(value)
      where found.value->>'id' = item_id
      limit 1;
      if replacement is null then
        replacement := item;
      end if;
      seen := array_append(seen, item_id);
    end if;
    result := result || jsonb_build_array(replacement);
  end loop;
  for item in select value from jsonb_array_elements(coalesce(newer, '[]'::jsonb))
  loop
    item_id := coalesce(item->>'id', '');
    if item_id <> '' and item_id = any(seen) then
      continue;
    end if;
    if item_id <> '' then
      seen := array_append(seen, item_id);
    end if;
    result := result || jsonb_build_array(item);
  end loop;
  return result;
end;
$fn$;

create or replace function public.merge_meal_slot(older jsonb, newer jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  old_slot jsonb := public.normalize_meal_slot(older);
  new_slot jsonb := public.normalize_meal_slot(newer);
begin
  if public.meal_slot_empty(new_slot) then
    return old_slot;
  end if;
  if public.meal_slot_empty(old_slot) then
    return new_slot;
  end if;
  return jsonb_build_object(
    'time', case
      when new_slot->'time' <> 'null'::jsonb then new_slot->'time'
      else old_slot->'time'
    end,
    'note', case
      when btrim(coalesce(new_slot->>'note', '')) <> '' then new_slot->>'note'
      else coalesce(old_slot->>'note', '')
    end,
    'items', public.merge_meal_items(old_slot->'items', new_slot->'items')
  );
end;
$fn$;

create or replace function public.merge_food_meals(older jsonb, newer jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $fn$
declare
  slots text[] := array['desayuno', 'mediaManana', 'almuerzo', 'mediaTarde', 'cena'];
  slot text;
  base_older jsonb := case when jsonb_typeof(older) = 'object' then older else '{}'::jsonb end;
  base_newer jsonb := case when jsonb_typeof(newer) = 'object' then newer else '{}'::jsonb end;
  result jsonb := '{}'::jsonb;
begin
  foreach slot in array slots loop
    result := result || jsonb_build_object(slot, public.merge_meal_slot(base_older->slot, base_newer->slot));
  end loop;
  return result;
end;
$fn$;

-- Live rows for that person and date, plus this payload, oldest first.
-- The payload replaces the stored copy of the same id so a real clear on that id sticks.
create or replace function public.resolve_food_day(
  p_user_id text,
  p_date text,
  p_id text,
  p_meals jsonb,
  p_comment text,
  p_raw_input text,
  p_updated_at timestamptz
)
returns table (
  meals jsonb,
  comment text,
  raw_input text,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  acc_meals jsonb := '{}'::jsonb;
  acc_comment text := '';
  acc_raw text;
  acc_at timestamptz := '-infinity';
  rec record;
begin
  for rec in
    select versions.meals, versions.comment, versions.raw_input, versions.updated_at
    from (
      select
        fd.meals,
        fd.comment,
        fd.raw_input,
        fd.updated_at,
        fd.id
      from public.food_days fd
      where fd.user_id = p_user_id
        and fd.date = p_date
        and fd.deleted_at is null
        and fd.id is distinct from p_id
      union all
      select
        coalesce(p_meals, '{}'::jsonb),
        coalesce(p_comment, ''),
        p_raw_input,
        coalesce(p_updated_at, now()),
        p_id
    ) as versions
    order by versions.updated_at asc, versions.id asc
  loop
    acc_meals := public.merge_food_meals(acc_meals, rec.meals);
    if btrim(coalesce(rec.comment, '')) <> '' then
      acc_comment := rec.comment;
    end if;
    if rec.raw_input is not null then
      acc_raw := rec.raw_input;
    end if;
    if rec.updated_at > acc_at then
      acc_at := rec.updated_at;
    end if;
  end loop;
  return query select acc_meals, acc_comment, acc_raw, acc_at;
end;
$fn$;

revoke all on function public.normalize_meal_slot(jsonb) from public, anon;
revoke all on function public.meal_slot_empty(jsonb) from public, anon;
revoke all on function public.merge_meal_items(jsonb, jsonb) from public, anon;
revoke all on function public.merge_meal_slot(jsonb, jsonb) from public, anon;
revoke all on function public.merge_food_meals(jsonb, jsonb) from public, anon;
revoke all on function public.resolve_food_day(text, text, text, jsonb, text, text, timestamptz) from public, anon;
grant execute on function public.normalize_meal_slot(jsonb) to authenticated;
grant execute on function public.meal_slot_empty(jsonb) to authenticated;
grant execute on function public.merge_meal_items(jsonb, jsonb) to authenticated;
grant execute on function public.merge_meal_slot(jsonb, jsonb) to authenticated;
grant execute on function public.merge_food_meals(jsonb, jsonb) to authenticated;
grant execute on function public.resolve_food_day(text, text, text, jsonb, text, text, timestamptz) to authenticated;

-- Claim merges same-date meals before Kviedes (or Cristian) takes the legacy rows.
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
  pair record;
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

    -- Same date on the legacy person and the account: fold meals, then hide the loser.
    -- Tie keeps the account row, matching the old updated_at comparison.
    for pair in
      select
        legacy.id as legacy_id,
        dest.id as dest_id,
        legacy.updated_at as legacy_at,
        dest.updated_at as dest_at,
        legacy.meals as legacy_meals,
        dest.meals as dest_meals,
        legacy.comment as legacy_comment,
        dest.comment as dest_comment,
        legacy.raw_input as legacy_raw,
        dest.raw_input as dest_raw
      from public.food_days legacy
      join public.food_days dest
        on dest.user_id = v_to
       and dest.date = legacy.date
       and dest.deleted_at is null
      where legacy.user_id = v_from
        and legacy.deleted_at is null
    loop
      if pair.legacy_at > pair.dest_at then
        update public.food_days
        set
          meals = public.merge_food_meals(pair.dest_meals, pair.legacy_meals),
          comment = case
            when btrim(coalesce(pair.legacy_comment, '')) <> '' then pair.legacy_comment
            else coalesce(pair.dest_comment, '')
          end,
          raw_input = coalesce(pair.legacy_raw, pair.dest_raw),
          updated_at = pair.legacy_at
        where id = pair.legacy_id;
        update public.food_days
        set deleted_at = now()
        where id = pair.dest_id
          and deleted_at is null;
      else
        update public.food_days
        set
          meals = public.merge_food_meals(pair.legacy_meals, pair.dest_meals),
          comment = case
            when btrim(coalesce(pair.dest_comment, '')) <> '' then pair.dest_comment
            else coalesce(pair.legacy_comment, '')
          end,
          raw_input = coalesce(pair.dest_raw, pair.legacy_raw),
          updated_at = greatest(pair.dest_at, pair.legacy_at)
        where id = pair.dest_id;
        update public.food_days
        set deleted_at = now()
        where id = pair.legacy_id
          and deleted_at is null;
      end if;
    end loop;

    update public.food_days
    set user_id = v_to
    where user_id = v_from
      and deleted_at is null;

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

  create temporary table if not exists food_day_resolved (
    id text primary key,
    date text not null,
    meals jsonb not null,
    comment text not null,
    raw_input text,
    updated_at timestamptz not null
  ) on commit drop;
  truncate food_day_resolved;

  insert into food_day_resolved (id, date, meals, comment, raw_input, updated_at)
  select
    f.id,
    f.date,
    r.meals,
    coalesce(r.comment, ''),
    r.raw_input,
    coalesce(r.updated_at, now())
  from jsonb_to_recordset(coalesce(payload->'food_days', '[]'::jsonb)) as f(
    id text,
    user_id text,
    date text,
    meals jsonb,
    comment text,
    raw_input text,
    updated_at timestamptz
  )
  cross join lateral public.resolve_food_day(
    v_uid,
    f.date,
    f.id,
    f.meals,
    f.comment,
    f.raw_input,
    f.updated_at
  ) as r
  where f.id ~ '^[A-Za-z0-9_-]{1,80}$'
    and f.user_id = v_uid
    and f.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

  update public.food_days existing
  set deleted_at = now()
  from food_day_resolved incoming
  where existing.user_id = v_uid
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
    f.meals,
    f.comment,
    f.raw_input,
    f.updated_at
  from food_day_resolved f
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
