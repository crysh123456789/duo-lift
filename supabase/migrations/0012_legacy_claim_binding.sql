-- Bind each legacy claim to an email ops sets, and optionally a one-time code.
-- 0007 through 0011 are not edited.
--
-- private.legacy_claims.allowed_email is lowercase. Null fails closed: nobody
-- can claim that row until ops sets it. The address is not seeded here.
--
-- The claim compares lower(auth.jwt()->>'email') to lower(allowed_email).
-- Email confirmation is auth.users.email_confirmed_at, read inside this
-- SECURITY DEFINER function. It is never taken from the JWT.
--
-- Two gates, one email binding. Security picks which gate is active per row:
--   * Pre-created account: leave claim_code_hash null. The account must
--     already have email_confirmed_at set.
--   * One-time code (Confirm email is OFF, so email_confirmed_at stays null):
--     set claim_code_hash to extensions.crypt(code, extensions.gen_salt('bf')).
--     The caller passes p_code. The hash is required when it is set, even if
--     the email is also confirmed. A wrong code is counted and locks the row.
-- How ops sets the email and the hash is in the README. Do not commit either.

create schema if not exists extensions;

-- Hosted Supabase installs pgcrypto in extensions. Local 0001 may have put it
-- in public. Do not move the extension: gen_random_uuid defaults pin the
-- function by OID. Expose extensions.crypt / extensions.gen_salt either way
-- so this function can call them with search_path = ''.
do $crypt$
declare
  ext_schema text;
begin
  select n.nspname into ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if ext_schema is null then
    execute 'create extension pgcrypto with schema extensions';
  elsif ext_schema = 'public' then
    execute $fn$
      create or replace function extensions.crypt(password text, salt text)
      returns text
      language sql
      immutable
      strict
      set search_path = ''
      as $body$ select public.crypt(password, salt); $body$
    $fn$;
    execute $fn$
      create or replace function extensions.gen_salt(type text)
      returns text
      language sql
      volatile
      strict
      set search_path = ''
      as $body$ select public.gen_salt(type); $body$
    $fn$;
  elsif ext_schema is distinct from 'extensions' then
    raise exception 'pgcrypto is installed in an unexpected schema: %', ext_schema;
  end if;
end
$crypt$;

alter table private.legacy_claims
  add column allowed_email text,
  add column claim_code_hash text,
  add column claim_code_attempts integer not null default 0,
  add column claim_code_total_failures integer not null default 0,
  add column claim_code_locked_until timestamptz;

alter table private.legacy_claims
  add constraint legacy_claims_allowed_email_lower_chk
    check (
      allowed_email is null
      or (
        allowed_email = lower(allowed_email)
        and length(allowed_email) between 3 and 320
      )
    );

alter table private.legacy_claims
  add constraint legacy_claims_code_attempts_chk
    check (claim_code_attempts >= 0 and claim_code_total_failures >= 0);

comment on column private.legacy_claims.allowed_email is
  'Lowercase mailbox allowed to claim this key. Null fails closed. Set by ops, not by the app.';

comment on column private.legacy_claims.claim_code_hash is
  'Bcrypt hash from extensions.crypt only. Null means the pre-created confirmed account gate. Never store the code.';

create or replace function private.legacy_claims_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.allowed_email is not null then
    new.allowed_email := lower(btrim(new.allowed_email));
    if new.allowed_email = '' then
      new.allowed_email := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists legacy_claims_normalize_trg on private.legacy_claims;
create trigger legacy_claims_normalize_trg
  before insert or update of allowed_email on private.legacy_claims
  for each row
  execute function private.legacy_claims_normalize();

revoke all on function private.legacy_claims_normalize() from public, anon, authenticated;

-- Same merge as 0010, plus the email and optional code gates.
drop function if exists public.claim_legacy_history(text);
drop function if exists private.claim_legacy_history(text);

create function private.claim_legacy_history(p_key text, p_code text default null)
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
  v_jwt_email text;
  v_confirmed timestamptz;
  v_code_ok boolean;
  v_attempts integer;
  v_total integer;
  v_locked timestamptz;
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

  -- Fail closed before any rewrite. Ops must set allowed_email. A null
  -- column is not an open claim, including when a code hash is also unset.
  if v_claim.allowed_email is null or btrim(v_claim.allowed_email) = '' then
    raise exception 'claim_not_configured' using errcode = '42501';
  end if;

  v_jwt_email := nullif(lower(btrim(auth.jwt() ->> 'email')), '');
  if v_jwt_email is null or v_jwt_email is distinct from lower(v_claim.allowed_email) then
    raise exception 'claim_email_mismatch' using errcode = '42501';
  end if;

  -- Confirmation lives on auth.users. Do not read email_confirmed_at from the JWT.
  select u.email_confirmed_at
  into v_confirmed
  from auth.users u
  where u.id = v_uid;

  -- Code gate when ops stored a hash and this account has not already claimed.
  -- A replay by the same uid does not ask for the code again.
  if v_claim.claim_code_hash is not null and v_claim.claimed_by is distinct from v_uid then
    if v_claim.claim_code_total_failures >= 20
       or (v_claim.claim_code_locked_until is not null and v_claim.claim_code_locked_until > now()) then
      return jsonb_build_object('ok', false, 'error', 'claim_locked');
    end if;

    v_code_ok := false;
    if p_code is not null and octet_length(p_code) between 1 and 72 then
      begin
        v_code_ok := extensions.crypt(p_code, v_claim.claim_code_hash) = v_claim.claim_code_hash;
      exception
        when others then
          v_code_ok := false;
      end;
    end if;

    if v_code_ok is not true then
      update private.legacy_claims
      set
        claim_code_attempts = case
          when claim_code_locked_until is not null and claim_code_locked_until <= now() then 1
          else claim_code_attempts + 1
        end,
        claim_code_total_failures = claim_code_total_failures + 1,
        claim_code_locked_until = case
          when claim_code_total_failures + 1 >= 20 then 'infinity'::timestamptz
          when (
            case
              when claim_code_locked_until is not null and claim_code_locked_until <= now() then 1
              else claim_code_attempts + 1
            end
          ) >= 5 then now() + interval '15 minutes'
          else null
        end
      where legacy_key = p_key
      returning claim_code_attempts, claim_code_total_failures, claim_code_locked_until
      into v_attempts, v_total, v_locked;

      if v_total >= 20 or v_locked is not null then
        return jsonb_build_object('ok', false, 'error', 'claim_locked');
      end if;
      return jsonb_build_object('ok', false, 'error', 'invalid_claim_code');
    end if;
  elsif v_claim.claimed_by is distinct from v_uid then
    -- Pre-created account. Confirm email must already be on for this user.
    if v_confirmed is null then
      raise exception 'email_not_confirmed' using errcode = '42501';
    end if;
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
      set
        claimed_by = v_uid,
        claimed_at = now(),
        claim_code_attempts = 0,
        claim_code_locked_until = null
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

comment on function private.claim_legacy_history(text, text) is
  'Binds a legacy key to the JWT email and either a confirmed auth.users row or a one-time code. Fails closed when allowed_email is null.';

revoke all on function private.claim_legacy_history(text, text) from public, anon;
grant execute on function private.claim_legacy_history(text, text) to authenticated;

create function public.claim_legacy_history(p_key text, p_code text default null)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.claim_legacy_history(p_key, p_code);
$$;

revoke all on function public.claim_legacy_history(text, text) from public, anon;
grant execute on function public.claim_legacy_history(text, text) to authenticated;

-- History rows only when the update changes the row. DELETE has no NEW,
-- so the delete trigger stays unconditional.
drop trigger if exists food_days_history_trg on public.food_days;
create trigger food_days_history_trg
  before update on public.food_days
  for each row
  when (old.* is distinct from new.*)
  execute function public.food_days_history_capture();

drop trigger if exists food_days_history_delete_trg on public.food_days;
create trigger food_days_history_delete_trg
  before delete on public.food_days
  for each row
  execute function public.food_days_history_capture();


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
