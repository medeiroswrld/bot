-- ============================================================================
-- 001_enable_rls.sql
-- Row Level Security (RLS) completo para CRM AutomaticGen
-- Idempotente: pode ser executado múltiplas vezes sem erro.
-- ============================================================================

-- ============================================================================
-- SEÇÃO 0: CRIAÇÃO DA TABELA LEADS (CASO NÃO EXISTA)
-- ============================================================================

create table if not exists public.leads (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  name         text        not null,
  phone        text,
  email        text,
  status       text        not null default 'novo',
  notes        text,
  car_id       uuid        references public.cars(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz default now()
);

comment on table public.leads is 'Leads de clientes interessados em veículos.';

-- ============================================================================
-- SEÇÃO 1: ATIVAR RLS EM TODAS AS TABELAS
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.cars              enable row level security;
alter table public.car_images        enable row level security;
alter table public.leads             enable row level security;
alter table public.appointments      enable row level security;
alter table public.company_settings  enable row level security;


-- ============================================================================
-- SEÇÃO 2: POLICIES — profiles (PK = id = auth.uid())
-- ============================================================================

-- SELECT: usuário só vê o próprio perfil
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

-- INSERT: usuário só cria perfil com seu próprio id
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid());

-- UPDATE: usuário só edita o próprio perfil
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ============================================================================
-- SEÇÃO 3: POLICIES — cars (user_id = auth.uid())
-- ============================================================================

drop policy if exists "cars_select_own" on public.cars;
create policy "cars_select_own"
  on public.cars for select
  using (user_id = auth.uid());

drop policy if exists "cars_insert_own" on public.cars;
create policy "cars_insert_own"
  on public.cars for insert
  with check (user_id = auth.uid());

drop policy if exists "cars_update_own" on public.cars;
create policy "cars_update_own"
  on public.cars for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "cars_delete_own" on public.cars;
create policy "cars_delete_own"
  on public.cars for delete
  using (user_id = auth.uid());

-- ============================================================================
-- SEÇÃO 4: POLICIES — car_images (via join com cars.user_id)
-- car_images NÃO tem user_id; a segurança depende de car_id → cars.user_id
-- ============================================================================

drop policy if exists "car_images_select_own" on public.car_images;
create policy "car_images_select_own"
  on public.car_images for select
  using (
    exists (
      select 1 from public.cars
      where cars.id = car_images.car_id
        and cars.user_id = auth.uid()
    )
  );

drop policy if exists "car_images_insert_own" on public.car_images;
create policy "car_images_insert_own"
  on public.car_images for insert
  with check (
    exists (
      select 1 from public.cars
      where cars.id = car_images.car_id
        and cars.user_id = auth.uid()
    )
  );

drop policy if exists "car_images_update_own" on public.car_images;
create policy "car_images_update_own"
  on public.car_images for update
  using (
    exists (
      select 1 from public.cars
      where cars.id = car_images.car_id
        and cars.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.cars
      where cars.id = car_images.car_id
        and cars.user_id = auth.uid()
    )
  );

drop policy if exists "car_images_delete_own" on public.car_images;
create policy "car_images_delete_own"
  on public.car_images for delete
  using (
    exists (
      select 1 from public.cars
      where cars.id = car_images.car_id
        and cars.user_id = auth.uid()
    )
  );

-- ============================================================================
-- SEÇÃO 5: POLICIES — leads (user_id = auth.uid())
-- ============================================================================

drop policy if exists "leads_select_own" on public.leads;
create policy "leads_select_own"
  on public.leads for select
  using (user_id = auth.uid());

drop policy if exists "leads_insert_own" on public.leads;
create policy "leads_insert_own"
  on public.leads for insert
  with check (user_id = auth.uid());

drop policy if exists "leads_update_own" on public.leads;
create policy "leads_update_own"
  on public.leads for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "leads_delete_own" on public.leads;
create policy "leads_delete_own"
  on public.leads for delete
  using (user_id = auth.uid());

-- ============================================================================
-- SEÇÃO 6: POLICIES — appointments (user_id = auth.uid())
-- ============================================================================

drop policy if exists "appointments_select_own" on public.appointments;
create policy "appointments_select_own"
  on public.appointments for select
  using (user_id = auth.uid());

drop policy if exists "appointments_insert_own" on public.appointments;
create policy "appointments_insert_own"
  on public.appointments for insert
  with check (user_id = auth.uid());

drop policy if exists "appointments_update_own" on public.appointments;
create policy "appointments_update_own"
  on public.appointments for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "appointments_delete_own" on public.appointments;
create policy "appointments_delete_own"
  on public.appointments for delete
  using (user_id = auth.uid());

-- ============================================================================
-- SEÇÃO 7: POLICIES — company_settings (user_id = auth.uid())
-- ============================================================================

drop policy if exists "company_settings_select_own" on public.company_settings;
create policy "company_settings_select_own"
  on public.company_settings for select
  using (user_id = auth.uid());

drop policy if exists "company_settings_insert_own" on public.company_settings;
create policy "company_settings_insert_own"
  on public.company_settings for insert
  with check (user_id = auth.uid());

drop policy if exists "company_settings_update_own" on public.company_settings;
create policy "company_settings_update_own"
  on public.company_settings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "company_settings_delete_own" on public.company_settings;
create policy "company_settings_delete_own"
  on public.company_settings for delete
  using (user_id = auth.uid());

-- ============================================================================
-- SEÇÃO 8: POLICIES — service_role (Edge Functions / webhooks server-side)
-- A service_role bypassa RLS por padrão no Supabase, mas caso esse
-- comportamento tenha sido desativado ou para documentar a intenção,
-- criamos policies explícitas para leads e appointments.
-- ============================================================================

drop policy if exists "leads_service_role_all" on public.leads;
create policy "leads_service_role_all"
  on public.leads for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "appointments_service_role_all" on public.appointments;
create policy "appointments_service_role_all"
  on public.appointments for all
  to service_role
  using (true)
  with check (true);

-- ============================================================================
-- SEÇÃO 9: CONSTRAINT — status do carro
-- Usa DO $$ para ser idempotente (não falha se o constraint já existir)
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cars_status_check'
      and conrelid = 'public.cars'::regclass
  ) then
    alter table public.cars
      add constraint cars_status_check
      check (status in ('available', 'reserved', 'sold'));
  end if;
end $$;

-- ============================================================================
-- SEÇÃO 10: TRIGGER — criação automática de perfil ao cadastrar usuário
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Recria o trigger de forma idempotente
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ============================================================================
-- SEÇÃO 11: QUERIES DE VERIFICAÇÃO
-- ============================================================================

-- 11a. Tabelas com RLS DESLIGADO (deve retornar ZERO linhas)
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'cars', 'car_images', 'leads', 'appointments', 'company_settings')
  and rowsecurity = false;

-- 11b. Todas as policies criadas neste schema
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'cars', 'car_images', 'leads', 'appointments', 'company_settings')
order by tablename, policyname;
