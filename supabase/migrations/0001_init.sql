-- Duo Lift schema, RLS and catalog. Run in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null,
  avatar_hue integer not null default 78,
  unit_system text not null default 'kg',
  created_at timestamptz not null default now()
);

create table public.duos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table public.duo_members (
  duo_id uuid not null references public.duos (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (duo_id, user_id)
);

create unique index duo_members_user_uidx on public.duo_members (user_id);

create table public.exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  muscle_group text not null,
  equipment text not null,
  is_unilateral boolean not null default false,
  created_by_user_id uuid references public.users (id),
  duo_id uuid references public.duos (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  duo_id uuid not null references public.duos (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'in_progress',
  notes text,
  perceived_exertion smallint,
  title text
);

create index workouts_duo_started_idx on public.workouts (duo_id, started_at desc);
create index workouts_user_status_idx on public.workouts (user_id, status);

create table public.workout_blocks (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  position integer not null,
  kind text not null,
  name text,
  target_rounds integer not null default 1,
  rest_between_rounds_sec integer,
  rest_sec integer
);

create index workout_blocks_workout_idx on public.workout_blocks (workout_id, position);

create table public.block_stations (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.workout_blocks (id) on delete cascade,
  exercise_id uuid not null references public.exercise_catalog (id),
  position integer not null,
  notes text
);

create index block_stations_block_idx on public.block_stations (block_id, position);

create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.block_stations (id) on delete cascade,
  round_index integer not null,
  set_index integer not null,
  reps integer,
  reps_right integer,
  weight_kg numeric,
  duration_sec integer,
  rpe numeric,
  is_warmup boolean not null default false,
  completed boolean not null default false,
  logged_at timestamptz not null default now(),
  unique (station_id, round_index, set_index)
);

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  from_user_id uuid not null references public.users (id) on delete cascade,
  kind text not null,
  body text,
  created_at timestamptz not null default now()
);

-- Auth profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, avatar_hue)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, 'athlete'), '@', 1)),
    abs(hashtext(new.id::text)) % 360
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.current_duo_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select duo_id from public.duo_members where user_id = auth.uid() limit 1;
$$;

create or replace function public.create_duo(p_name text)
returns public.duos
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.duos;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.duo_members where user_id = auth.uid()) then
    raise exception 'Ya estás en un duo';
  end if;
  insert into public.duos (name, invite_code)
  values (
    coalesce(nullif(trim(p_name), ''), 'Duo Lift'),
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  )
  returning * into d;
  insert into public.duo_members (duo_id, user_id, role)
  values (d.id, auth.uid(), 'owner');
  return d;
end;
$$;

create or replace function public.join_duo(p_code text)
returns public.duos
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.duos;
  n int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.duo_members where user_id = auth.uid()) then
    raise exception 'Ya estás en un duo';
  end if;
  select * into d from public.duos where invite_code = upper(trim(p_code));
  if d.id is null then
    raise exception 'Código inválido';
  end if;
  select count(*) into n from public.duo_members where duo_id = d.id;
  if n >= 2 then
    raise exception 'Este duo ya está completo';
  end if;
  insert into public.duo_members (duo_id, user_id, role)
  values (d.id, auth.uid(), 'member');
  return d;
end;
$$;

alter table public.users enable row level security;
alter table public.duos enable row level security;
alter table public.duo_members enable row level security;
alter table public.exercise_catalog enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_blocks enable row level security;
alter table public.block_stations enable row level security;
alter table public.set_logs enable row level security;
alter table public.reactions enable row level security;

create policy users_select on public.users
  for select to authenticated
  using (id = auth.uid() or id in (
    select user_id from public.duo_members where duo_id = public.current_duo_id()
  ));

create policy users_update on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy users_insert on public.users
  for insert to authenticated
  with check (id = auth.uid());

create policy duos_select on public.duos
  for select to authenticated
  using (id = public.current_duo_id());

create policy duo_members_select on public.duo_members
  for select to authenticated
  using (duo_id = public.current_duo_id() or user_id = auth.uid());

create policy exercises_select on public.exercise_catalog
  for select to authenticated
  using (duo_id is null or duo_id = public.current_duo_id());

create policy exercises_insert on public.exercise_catalog
  for insert to authenticated
  with check (created_by_user_id = auth.uid() and duo_id = public.current_duo_id());

create policy workouts_select on public.workouts
  for select to authenticated
  using (duo_id = public.current_duo_id());

create policy workouts_insert on public.workouts
  for insert to authenticated
  with check (user_id = auth.uid() and duo_id = public.current_duo_id());

create policy workouts_update on public.workouts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and duo_id = public.current_duo_id());

create policy workouts_delete on public.workouts
  for delete to authenticated
  using (user_id = auth.uid());

create policy blocks_select on public.workout_blocks
  for select to authenticated
  using (exists (
    select 1 from public.workouts w
    where w.id = workout_id and w.duo_id = public.current_duo_id()
  ));

create policy blocks_write on public.workout_blocks
  for all to authenticated
  using (exists (
    select 1 from public.workouts w
    where w.id = workout_id and w.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.workouts w
    where w.id = workout_id and w.user_id = auth.uid()
  ));

create policy stations_select on public.block_stations
  for select to authenticated
  using (exists (
    select 1 from public.workout_blocks b
    join public.workouts w on w.id = b.workout_id
    where b.id = block_id and w.duo_id = public.current_duo_id()
  ));

create policy stations_write on public.block_stations
  for all to authenticated
  using (exists (
    select 1 from public.workout_blocks b
    join public.workouts w on w.id = b.workout_id
    where b.id = block_id and w.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.workout_blocks b
    join public.workouts w on w.id = b.workout_id
    where b.id = block_id and w.user_id = auth.uid()
  ));

create policy sets_select on public.set_logs
  for select to authenticated
  using (exists (
    select 1 from public.block_stations s
    join public.workout_blocks b on b.id = s.block_id
    join public.workouts w on w.id = b.workout_id
    where s.id = station_id and w.duo_id = public.current_duo_id()
  ));

create policy sets_write on public.set_logs
  for all to authenticated
  using (exists (
    select 1 from public.block_stations s
    join public.workout_blocks b on b.id = s.block_id
    join public.workouts w on w.id = b.workout_id
    where s.id = station_id and w.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.block_stations s
    join public.workout_blocks b on b.id = s.block_id
    join public.workouts w on w.id = b.workout_id
    where s.id = station_id and w.user_id = auth.uid()
  ));

create policy reactions_select on public.reactions
  for select to authenticated
  using (exists (
    select 1 from public.workouts w
    where w.id = workout_id and w.duo_id = public.current_duo_id()
  ));

create policy reactions_insert on public.reactions
  for insert to authenticated
  with check (
    from_user_id = auth.uid()
    and exists (
      select 1 from public.workouts w
      where w.id = workout_id and w.duo_id = public.current_duo_id()
    )
  );

grant execute on function public.current_duo_id() to authenticated;
grant execute on function public.create_duo(text) to authenticated;
grant execute on function public.join_duo(text) to authenticated;

alter publication supabase_realtime add table public.workouts;
alter publication supabase_realtime add table public.reactions;

insert into public.exercise_catalog (name, muscle_group, equipment, is_unilateral) values
  ('Abductores', 'legs', 'machine', false),
  ('Zancadas', 'legs', 'dumbbell', true),
  ('Cuclillas Hatch', 'legs', 'barbell', false),
  ('Prensa', 'legs', 'machine', false),
  ('Peso muerto rumano', 'legs', 'barbell', false),
  ('Hip thrust', 'legs', 'barbell', false),
  ('Curl femoral', 'legs', 'machine', false),
  ('Press banca', 'chest', 'barbell', false),
  ('Press inclinada', 'chest', 'dumbbell', false),
  ('Press militar', 'shoulders', 'barbell', false),
  ('Elevaciones laterales', 'shoulders', 'dumbbell', false),
  ('Remo con barra', 'back', 'barbell', false),
  ('Jalón al pecho', 'back', 'cable', false),
  ('Dominadas', 'back', 'bodyweight', false),
  ('Curl bíceps', 'arms', 'dumbbell', false),
  ('Fondos', 'chest', 'bodyweight', false),
  ('Plancha', 'core', 'bodyweight', false);
