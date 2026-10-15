-- Iwan Pages + Supabase integration migration. Review on a test project before applying.
create extension if not exists pgcrypto;

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists permissions jsonb;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
create unique index if not exists profiles_username_lower_unique on public.profiles (lower(username)) where username is not null;

alter table public.doctors add column if not exists display_name text;
alter table public.doctors add column if not exists fee_egyptian numeric(10,2) not null default 0;
alter table public.doctors add column if not exists fee_foreign numeric(10,2) not null default 0;
alter table public.doctors add column if not exists certificates text;
alter table public.doctors add column if not exists weekly_schedule jsonb not null default '{}'::jsonb;
alter table public.doctors add column if not exists is_active boolean not null default true;
update public.doctors d set display_name = coalesce(d.display_name, p.full_name, 'طبيب') from public.profiles p where p.id = d.user_id and d.display_name is null;
update public.doctors set display_name = 'طبيب' where display_name is null;

alter table public.appointments add column if not exists service_code text not null default 'جلسة';
alter table public.appointments add column if not exists appointment_at timestamptz;
alter table public.appointments add column if not exists amount numeric(10,2) not null default 0;
alter table public.appointments add column if not exists session_type text not null default 'in_person';
alter table public.appointments add column if not exists payment_status text not null default 'unpaid';
update public.appointments set appointment_at = coalesce(appointment_at, now()) where appointment_at is null;
create index if not exists appointments_appointment_at_idx on public.appointments (appointment_at desc);
create unique index if not exists appointments_doctor_slot_active_unique on public.appointments(doctor_id, appointment_at)
  where status in ('pending','confirmed','pending_payment','confirmed_test');

create table if not exists public.pharmacy_items (
  id uuid primary key default gen_random_uuid(), item_name text not null,
  stock_quantity numeric(12,2) not null default 0 check (stock_quantity >= 0),
  reorder_level numeric(12,2) not null default 0 check (reorder_level >= 0),
  unit text not null default 'وحدة', created_at timestamptz not null default now()
);
create table if not exists public.doctor_availability (
  id uuid primary key default gen_random_uuid(), doctor_id uuid not null references public.doctors(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), starts_at time not null, ends_at time not null,
  slot_minutes smallint not null default 60 check (slot_minutes between 10 and 240), is_active boolean not null default true,
  check (ends_at > starts_at), unique(doctor_id, weekday, starts_at)
);
create table if not exists public.medical_documents (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.profiles(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id), file_name text not null, storage_path text not null,
  mime_type text, created_at timestamptz not null default now()
);
create table if not exists public.video_sessions (
  id uuid primary key default gen_random_uuid(), appointment_id uuid not null references public.appointments(id) on delete cascade,
  created_by uuid not null references public.profiles(id), meeting_url text not null, created_at timestamptz not null default now()
);

-- Secure profile creation: users cannot self-assign admin/accounting/pharmacy roles.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare requested_role text; requested_username text;
begin
  requested_role := coalesce(new.raw_user_meta_data->>'requested_role','patient');
  if requested_role not in ('patient','doctor','staff') then requested_role := 'patient'; end if;
  requested_username := nullif(trim(new.raw_user_meta_data->>'username'),'');
  if requested_username is null then requested_username := split_part(new.email,'@',1); end if;
  insert into public.profiles (id, full_name, username, email, role, account_status, phone)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)), requested_username, new.email, requested_role, 'pending', nullif(new.raw_user_meta_data->>'phone',''))
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.iwan_is_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin' and p.account_status='active');
$$;
revoke all on function public.iwan_is_admin() from public;
grant execute on function public.iwan_is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.doctors enable row level security;
alter table public.appointments enable row level security;
alter table public.pharmacy_items enable row level security;
alter table public.doctor_availability enable row level security;
alter table public.medical_documents enable row level security;
alter table public.video_sessions enable row level security;

-- Policies are deliberately role-scoped; existing policies should be reviewed for permissive overlaps.
drop policy if exists iwan_profiles_read_self_or_admin on public.profiles;
create policy iwan_profiles_read_self_or_admin on public.profiles for select to authenticated using (id=auth.uid() or public.iwan_is_admin());
drop policy if exists iwan_profiles_admin_update on public.profiles;
create policy iwan_profiles_admin_update on public.profiles for update to authenticated using (public.iwan_is_admin()) with check (public.iwan_is_admin());

drop policy if exists iwan_doctors_read on public.doctors;
create policy iwan_doctors_read on public.doctors for select to authenticated using (is_available=true or is_active=true or user_id=auth.uid() or public.iwan_is_admin());
drop policy if exists iwan_doctors_admin_insert on public.doctors;
create policy iwan_doctors_admin_insert on public.doctors for insert to authenticated with check (public.iwan_is_admin());
drop policy if exists iwan_doctors_admin_update on public.doctors;
create policy iwan_doctors_admin_update on public.doctors for update to authenticated using (public.iwan_is_admin()) with check (public.iwan_is_admin());

drop policy if exists iwan_appointments_read on public.appointments;
create policy iwan_appointments_read on public.appointments for select to authenticated using (patient_id=auth.uid() or public.iwan_is_admin() or exists(select 1 from public.doctors d where d.id=doctor_id and d.user_id=auth.uid()) or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='accounting' and p.account_status='active'));
drop policy if exists iwan_appointments_patient_insert on public.appointments;
create policy iwan_appointments_patient_insert on public.appointments for insert to authenticated with check (patient_id=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='patient' and p.account_status='active'));
drop policy if exists iwan_appointments_admin_update on public.appointments;
create policy iwan_appointments_admin_update on public.appointments for update to authenticated using (public.iwan_is_admin() or exists(select 1 from public.doctors d where d.id=doctor_id and d.user_id=auth.uid())) with check (public.iwan_is_admin() or exists(select 1 from public.doctors d where d.id=doctor_id and d.user_id=auth.uid()));

drop policy if exists iwan_pharmacy_admin_read on public.pharmacy_items;
create policy iwan_pharmacy_admin_read on public.pharmacy_items for select to authenticated using (public.iwan_is_admin() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='pharmacy' and p.account_status='active'));
drop policy if exists iwan_pharmacy_admin_insert on public.pharmacy_items;
create policy iwan_pharmacy_admin_insert on public.pharmacy_items for insert to authenticated with check (public.iwan_is_admin());
drop policy if exists iwan_pharmacy_admin_update on public.pharmacy_items;
create policy iwan_pharmacy_admin_update on public.pharmacy_items for update to authenticated using (public.iwan_is_admin()) with check (public.iwan_is_admin());

drop policy if exists iwan_availability_read on public.doctor_availability;
create policy iwan_availability_read on public.doctor_availability for select to authenticated using (is_active=true or public.iwan_is_admin() or exists(select 1 from public.doctors d where d.id=doctor_id and d.user_id=auth.uid()));
drop policy if exists iwan_availability_manage on public.doctor_availability;
create policy iwan_availability_manage on public.doctor_availability for all to authenticated using (public.iwan_is_admin() or exists(select 1 from public.doctors d where d.id=doctor_id and d.user_id=auth.uid())) with check (public.iwan_is_admin() or exists(select 1 from public.doctors d where d.id=doctor_id and d.user_id=auth.uid()));

drop policy if exists iwan_documents_read on public.medical_documents;
create policy iwan_documents_read on public.medical_documents for select to authenticated using (patient_id=auth.uid() or uploaded_by=auth.uid() or public.iwan_is_admin() or exists(select 1 from public.doctors d where d.user_id=auth.uid()));
drop policy if exists iwan_documents_insert on public.medical_documents;
create policy iwan_documents_insert on public.medical_documents for insert to authenticated with check (uploaded_by=auth.uid() and (patient_id=auth.uid() or public.iwan_is_admin() or exists(select 1 from public.doctors d where d.user_id=auth.uid())));

drop policy if exists iwan_video_sessions_read on public.video_sessions;
create policy iwan_video_sessions_read on public.video_sessions for select to authenticated using (created_by=auth.uid() or public.iwan_is_admin() or exists(select 1 from public.appointments a where a.id=appointment_id and (a.patient_id=auth.uid() or exists(select 1 from public.doctors d where d.id=a.doctor_id and d.user_id=auth.uid()))));
drop policy if exists iwan_video_sessions_insert on public.video_sessions;
create policy iwan_video_sessions_insert on public.video_sessions for insert to authenticated with check (created_by=auth.uid() and (public.iwan_is_admin() or exists(select 1 from public.doctors d where d.user_id=auth.uid())));

-- Do not expose service-role credentials to the browser. No secret key belongs in this project.

alter table public.profiles add column if not exists age integer;
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists nationality text;
alter table public.profiles add column if not exists fingerprint text;
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists specialty text;
alter table public.profiles add column if not exists certificates text;
alter table public.profiles add column if not exists fee_egyptian numeric(10,2) not null default 0;
alter table public.profiles add column if not exists fee_foreign numeric(10,2) not null default 0;
alter table public.profiles add column if not exists weekly_schedule jsonb not null default '{}'::jsonb;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare requested_role text; requested_username text; schedule_value jsonb;
begin
  requested_role := coalesce(new.raw_user_meta_data->>'requested_role','patient');
  if requested_role not in ('patient','doctor','staff') then requested_role := 'patient'; end if;
  requested_username := nullif(trim(new.raw_user_meta_data->>'username'),'');
  if requested_username is null then requested_username := split_part(new.email,'@',1); end if;
  begin schedule_value := coalesce((new.raw_user_meta_data->>'weekly_schedule')::jsonb, '{}'::jsonb); exception when others then schedule_value := '{}'::jsonb; end;
  insert into public.profiles (id, full_name, username, email, role, account_status, phone, age, birth_date, nationality, fingerprint, department, specialty, certificates, fee_egyptian, fee_foreign, weekly_schedule)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)), requested_username, new.email, requested_role, 'pending', nullif(new.raw_user_meta_data->>'phone',''), nullif(new.raw_user_meta_data->>'age','')::integer, nullif(new.raw_user_meta_data->>'birth_date','')::date, nullif(new.raw_user_meta_data->>'nationality',''), nullif(new.raw_user_meta_data->>'fingerprint',''), nullif(new.raw_user_meta_data->>'department',''), nullif(new.raw_user_meta_data->>'specialty',''), nullif(new.raw_user_meta_data->>'certificates',''), coalesce(nullif(new.raw_user_meta_data->>'fee_egyptian','')::numeric,0), coalesce(nullif(new.raw_user_meta_data->>'fee_foreign','')::numeric,0), schedule_value)
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end; $$;

update public.profiles p set email = u.email from auth.users u where p.id = u.id and p.email is null;
