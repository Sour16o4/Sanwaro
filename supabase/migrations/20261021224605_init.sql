-- ============================================================================
-- Sanwaro — reference database schema (verified on PostgreSQL 16)
-- Target: Supabase (Postgres 15+). Run as the first migration.
--
-- Key ideas:
--   * Every row belongs to a business (tenant). RLS keeps tenants apart.
--   * bookings.slot is a tstzrange [start, start + duration + buffer).
--   * An exclusion constraint makes double booking impossible in the database.
--   * Public actions (slots, holds, payments, cancellations) go through
--     SECURITY DEFINER functions that ONLY the server (service_role) can call.
--   * Money is stored in paise (integers). Never floats.
-- ============================================================================

-- Supabase keeps extensions in their own 'extensions' schema (keeps the API surface clean)
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

create table public.businesses (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(name) between 2 and 80),
  slug                text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  address             text,
  timezone            text not null default 'Asia/Kolkata',
  buffer_min          int  not null default 0  check (buffer_min between 0 and 60),
  hold_minutes        int  not null default 7  check (hold_minutes between 3 and 15),
  cancel_window_hours int  not null default 24 check (cancel_window_hours between 0 and 168),
  max_days_ahead      int  not null default 30 check (max_days_ahead between 1 and 90),
  slot_step_min       int  not null default 15 check (slot_step_min in (5, 10, 15, 20, 30, 60)),
  smart_deposit       boolean not null default true,   -- trust-based deposits (see deposit_for)
  customer_note       text check (length(customer_note) <= 300),  -- e.g. parking / directions, added to confirmations
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now()
);

create table public.staff (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null check (length(name) between 1 and 80),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (id, business_id)              -- lets other tables use composite FKs
);

create table public.memberships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  role        text not null check (role in ('owner', 'staff', 'viewer')),  -- viewer = read-only (public demo login)
  staff_id    uuid,
  created_at  timestamptz not null default now(),
  primary key (user_id, business_id),
  foreign key (staff_id, business_id) references public.staff(id, business_id) on delete cascade,
  check (role <> 'staff' or staff_id is not null)
);

create table public.services (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  duration_min  int  not null check (duration_min between 5 and 480),
  price_paise   int  not null check (price_paise >= 0),
  deposit_paise int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (deposit_paise >= 0 and deposit_paise <= price_paise),
  unique (id, business_id)
);

create table public.staff_services (
  business_id uuid not null,
  staff_id    uuid not null,
  service_id  uuid not null,
  primary key (staff_id, service_id),
  foreign key (staff_id, business_id)   references public.staff(id, business_id)    on delete cascade,
  foreign key (service_id, business_id) references public.services(id, business_id) on delete cascade
);

-- One row per working window. Breaks = gaps between rows on the same day
-- (e.g. 10:00-13:00 and 14:00-19:00 means lunch 13:00-14:00).
-- weekday: 0 = Sunday ... 6 = Saturday (same as extract(dow)).
create table public.working_hours (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  staff_id    uuid not null,
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  check (end_time > start_time),
  foreign key (staff_id, business_id) references public.staff(id, business_id) on delete cascade,
  -- windows for the same staff on the same weekday may not overlap
  exclude using gist (
    staff_id with =,
    weekday  with =,
    tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time, '[)') with &&
  )
);

create table public.time_off (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  staff_id    uuid not null,
  period      tstzrange not null check (not isempty(period)),
  reason      text,
  foreign key (staff_id, business_id) references public.staff(id, business_id) on delete cascade
);

create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  phone         text not null check (phone ~ '^[6-9][0-9]{9}$'),   -- Indian mobile, 10 digits
  no_show_count int  not null default 0,
  notes         text,
  blocked       boolean not null default false,
  trusted       boolean not null default false,   -- set by the OWNER only; phone numbers are not verified
  created_at    timestamptz not null default now(),
  unique (business_id, phone),
  unique (id, business_id)
);

create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null,
  staff_id        uuid not null,
  service_id      uuid not null,
  customer_id     uuid not null,
  slot            tstzrange not null,          -- [start, start + duration + buffer)
  status          text not null check (status in
                    ('held', 'confirmed', 'completed', 'no_show', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  deposit_paise   int  not null default 0 check (deposit_paise >= 0),
  source          text not null default 'online' check (source in ('online', 'manual', 'walkin')),
  booked_name     text check (length(booked_name) <= 80),  -- name typed for THIS booking (never overwrites the customer record)
  hold_key        uuid,                 -- random id from the customer's browser; lets them replace their own hold
  payment_started_at timestamptz,       -- set once when checkout opens (hold extended once)
  started_at      timestamptz,          -- owner/staff tapped "start" (used for walk-ins)
  manage_token    uuid not null default gen_random_uuid() unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (staff_id, business_id)    references public.staff(id, business_id),
  foreign key (service_id, business_id)  references public.services(id, business_id),
  foreign key (customer_id, business_id) references public.customers(id, business_id),
  check (not isempty(slot) and lower_inc(slot) and not upper_inc(slot)),
  check (status <> 'held' or hold_expires_at is not null),
  -- THE core rule: one staff member can never have two active bookings that overlap
  constraint no_double_booking exclude using gist (
    staff_id with =,
    slot     with &&
  ) where (status in ('held', 'confirmed'))
);

create index bookings_business_start_idx on public.bookings (business_id, lower(slot));
create index bookings_held_idx           on public.bookings (hold_expires_at) where status = 'held';
-- a customer can hold only one slot at a time (race-safe)
create unique index one_active_hold_per_customer on public.bookings (customer_id) where status = 'held';

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  booking_id          uuid not null references public.bookings(id) on delete cascade,
  razorpay_order_id   text not null unique,
  razorpay_payment_id text unique,               -- unique = a payment is processed once
  amount_paise        int  not null check (amount_paise > 0),
  status              text not null default 'created'
                        check (status in ('created', 'captured', 'refund_pending', 'refunded', 'failed')),
  refund_id           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  kind        text not null check (kind in ('confirmation', 'reminder_24h', 'reminder_2h')),
  send_at     timestamptz not null,
  status      text not null default 'pending'
                check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts    int  not null default 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (booking_id, kind)                       -- never schedule the same reminder twice
);
create index notifications_due_idx on public.notifications (send_at) where status = 'pending';

-- Used by the rate limiter (keys like 'hold:ip:1.2.3.4' or 'hold:phone:98xxxxxxxx')
create table public.rate_events (
  id         bigint generated always as identity primary key,
  key        text not null,
  created_at timestamptz not null default now()
);
create index rate_events_key_time_idx on public.rate_events (key, created_at);

-- Server-only settings (e.g. the cron secret). Lives outside the API-exposed schema.
create schema if not exists private;
create table private.app_config (
  key   text primary key,
  value text not null
);
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS HELPERS (safe for logged-in users: they only reveal your own membership)
-- ---------------------------------------------------------------------------

create function public.is_member(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                 where m.business_id = bid and m.user_id = auth.uid())
$$;

create function public.is_owner(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                 where m.business_id = bid and m.user_id = auth.uid() and m.role = 'owner')
$$;

create function public.is_viewer(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m
                 where m.business_id = bid and m.user_id = auth.uid() and m.role = 'viewer')
$$;

create function public.my_staff_id(bid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.staff_id from public.memberships m
  where m.business_id = bid and m.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

alter table public.businesses     enable row level security;
alter table public.staff          enable row level security;
alter table public.memberships    enable row level security;
alter table public.services       enable row level security;
alter table public.staff_services enable row level security;
alter table public.working_hours  enable row level security;
alter table public.time_off       enable row level security;
alter table public.customers      enable row level security;
alter table public.bookings       enable row level security;
alter table public.payments       enable row level security;
alter table public.notifications  enable row level security;
alter table public.rate_events    enable row level security;   -- no policies = nobody via API

-- Defence in depth: the browser's anon key never needs direct table access.
revoke all on all tables in schema public from anon;

-- businesses
create policy biz_select on public.businesses for select to authenticated
  using (public.is_member(id));
create policy biz_update on public.businesses for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));

-- memberships
create policy mem_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_owner(business_id));

-- setup tables: members read, owners write
create policy staff_read  on public.staff for select to authenticated using (public.is_member(business_id));
create policy staff_write on public.staff for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));

create policy svc_read  on public.services for select to authenticated using (public.is_member(business_id));
create policy svc_write on public.services for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));

create policy ss_read  on public.staff_services for select to authenticated using (public.is_member(business_id));
create policy ss_write on public.staff_services for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));

create policy wh_read  on public.working_hours for select to authenticated using (public.is_member(business_id));
create policy wh_write on public.working_hours for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));

create policy to_read  on public.time_off for select to authenticated using (public.is_member(business_id));
create policy to_write on public.time_off for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));

create policy cust_read  on public.customers for select to authenticated using (public.is_member(business_id));
create policy cust_write on public.customers for all to authenticated
  using (public.is_owner(business_id)) with check (public.is_owner(business_id));

-- bookings: owner sees all of their salon; staff see only their own
create policy bk_select on public.bookings for select to authenticated
  using (public.is_owner(business_id) or public.is_viewer(business_id)
         or staff_id = public.my_staff_id(business_id));
create policy bk_update on public.bookings for update to authenticated
  using (public.is_owner(business_id) or staff_id = public.my_staff_id(business_id))
  with check (public.is_owner(business_id) or staff_id = public.my_staff_id(business_id));
-- owner can add walk-ins / phone bookings (still protected by no_double_booking)
create policy bk_insert_manual on public.bookings for insert to authenticated
  with check (public.is_owner(business_id) and status = 'confirmed' and source = 'manual');

-- money and messages: owners read only; writes happen through server functions
create policy pay_select on public.payments for select to authenticated
  using (public.is_owner(business_id) or public.is_viewer(business_id));
create policy ntf_select on public.notifications for select to authenticated
  using (public.is_owner(business_id) or public.is_viewer(business_id));
-- Note: viewers get NO write policies anywhere, so the demo login cannot change anything.

-- ---------------------------------------------------------------------------
-- 4. TRIGGERS
-- ---------------------------------------------------------------------------

-- Guards booking changes: immutable fields, legal status moves, side effects.
create function public.bookings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id <> old.business_id or new.customer_id <> old.customer_id
     or new.manage_token <> old.manage_token then
    raise exception 'IMMUTABLE_FIELD' using errcode = 'P0001';
  end if;

  if new.status <> old.status then
    if not (
         (old.status = 'held'      and new.status in ('confirmed', 'expired', 'cancelled'))
      or (old.status = 'expired'   and new.status = 'confirmed')          -- late payment, slot still free
      or (old.status = 'confirmed' and new.status in ('completed', 'no_show', 'cancelled'))
      or (old.status = 'completed' and new.status = 'no_show')   -- owner corrects an auto-completed booking
    ) then
      raise exception 'INVALID_STATUS_TRANSITION % -> %', old.status, new.status using errcode = 'P0001';
    end if;

    if new.status in ('completed', 'no_show') and lower(new.slot) > now() then
      raise exception 'APPOINTMENT_NOT_STARTED' using errcode = 'P0001';
    end if;

    if new.status = 'no_show' then
      update public.customers set no_show_count = no_show_count + 1 where id = new.customer_id;
    end if;

    if new.status in ('cancelled', 'expired', 'no_show', 'completed') then
      update public.notifications set status = 'skipped'
      where booking_id = new.id and status = 'pending';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger bookings_guard before update on public.bookings
  for each row execute function public.bookings_guard();

-- ---------------------------------------------------------------------------
-- 5. FUNCTIONS
-- ---------------------------------------------------------------------------

-- Owner onboarding: creates the business and makes the caller its owner.
create function public.create_business(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001'; end if;
  if (select count(*) from public.memberships where user_id = v_uid and role = 'owner') >= 3 then
    raise exception 'BUSINESS_LIMIT_REACHED' using errcode = 'P0001';   -- free-tier abuse guard
  end if;
  insert into public.businesses (name, slug) values (p_name, lower(p_slug)) returning id into v_id;
  insert into public.memberships (user_id, business_id, role) values (v_uid, v_id, 'owner');
  return v_id;
end $$;

-- Is [p_start, p_end) inside one working window and clear of time off?
create function public.slot_in_schedule(p_staff uuid, p_start timestamptz, p_end timestamptz, p_tz text)
returns boolean language sql stable set search_path = public as $$
  select exists (
           select 1 from public.working_hours wh
           where wh.staff_id = p_staff
             and wh.weekday = extract(dow from (p_start at time zone p_tz))::int
             and ((p_start at time zone p_tz)::date + wh.start_time) <= (p_start at time zone p_tz)
             and ((p_start at time zone p_tz)::date + wh.end_time)   >= (p_end   at time zone p_tz)
         )
     and not exists (
           select 1 from public.time_off t
           where t.staff_id = p_staff and t.period && tstzrange(p_start, p_end, '[)')
         )
$$;

-- Free slots for one service on one date (optionally for one staff member).
create function public.get_free_slots(p_business uuid, p_service uuid, p_date date, p_staff uuid default null)
returns table (staff_id uuid, staff_name text, start_at timestamptz, end_at timestamptz)
language sql stable security definer set search_path = public as $$
  with b as (select * from public.businesses where id = p_business),
  sv as (select * from public.services where id = p_service and business_id = p_business and active),
  st as (
    select s.id, s.name
    from public.staff s
    join public.staff_services ss on ss.staff_id = s.id and ss.service_id = p_service
    where s.business_id = p_business and s.active and (p_staff is null or s.id = p_staff)
  ),
  win as (
    select st.id as sid, st.name as sname,
           ((p_date + wh.start_time) at time zone b.timezone) as w_start,
           ((p_date + wh.end_time)   at time zone b.timezone) as w_end
    from st
    join public.working_hours wh on wh.staff_id = st.id
    cross join b
    where wh.weekday = extract(dow from p_date)::int
  ),
  cand as (
    select w.sid, w.sname, gs as s_at,
           gs + make_interval(mins => sv.duration_min)                as e_at,
           gs + make_interval(mins => sv.duration_min + b.buffer_min) as block_end
    from win w
    cross join sv
    cross join b
    cross join lateral generate_series(
      w.w_start,
      w.w_end - make_interval(mins => sv.duration_min),
      make_interval(mins => b.slot_step_min)
    ) as gs
  )
  select c.sid, c.sname, c.s_at, c.e_at
  from cand c cross join b
  where c.s_at > now()
    and c.s_at < now() + make_interval(days => b.max_days_ahead)
    and not exists (select 1 from public.time_off t
                    where t.staff_id = c.sid and t.period && tstzrange(c.s_at, c.e_at, '[)'))
    and not exists (select 1 from public.bookings bk
                    where bk.staff_id = c.sid
                      and bk.slot && tstzrange(c.s_at, c.block_end, '[)')
                      and (bk.status = 'confirmed'
                           or (bk.status = 'held' and bk.hold_expires_at > now())))
  order by c.s_at, c.sname
$$;

-- Schedules confirmation + reminders for a confirmed booking (idempotent).
create function public.schedule_notifications(p_booking uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (business_id, booking_id, kind, send_at)
  select bk.business_id, bk.id, k.kind, k.send_at
  from public.bookings bk
  cross join lateral (values
    ('confirmation', now()),
    ('reminder_24h', lower(bk.slot) - interval '24 hours'),
    ('reminder_2h',  lower(bk.slot) - interval '2 hours')
  ) as k(kind, send_at)
  where bk.id = p_booking
    and k.send_at >= now() - interval '1 minute'      -- skip reminders whose time already passed
  on conflict (booking_id, kind) do nothing
$$;

-- Trust-based deposit ("smart deposit"). Explainable rules, shown to the customer.
-- Phone numbers are NOT verified (OTP costs money), so history alone never
-- unlocks a free booking: anyone could type a regular's number. Only the
-- OWNER can grant ₹0 by marking a customer trusted.
--   service has no deposit                  -> 0
--   owner-marked trusted, 0 no-shows        -> 0
--   2+ no-shows                             -> full price upfront
--   1 no-show                               -> double deposit (capped at price)
--   3+ completed visits, 0 no-shows         -> half deposit (rounded up to whole rupees)
--   otherwise                               -> the service's normal deposit
create function public.deposit_for(p_customer uuid, p_service uuid) returns int
language sql stable security definer set search_path = public as $$
  select case
           when sv.deposit_paise = 0                    then 0
           when c.trusted and c.no_show_count = 0       then 0
           when c.no_show_count >= 2                    then sv.price_paise
           when c.no_show_count = 1                     then least(sv.price_paise, sv.deposit_paise * 2)
           when (select count(*) from public.bookings bk
                 where bk.customer_id = c.id and bk.status = 'completed') >= 3
                                                        then (ceil(sv.deposit_paise / 2.0 / 100) * 100)::int
           else sv.deposit_paise
         end
  from public.services sv, public.customers c
  where sv.id = p_service and c.id = p_customer
$$;

-- Customer picks a slot. Returns a hold (or a confirmed booking if no deposit).
-- p_hold_key: a random UUID the browser keeps for this visit. If the same
-- browser picks another slot, its previous unpaid hold is released instead of
-- locking the customer out for the rest of the hold time.
create function public.create_hold(
  p_business uuid, p_staff uuid, p_service uuid, p_start timestamptz,
  p_customer_name text, p_phone text, p_hold_key uuid default null)
returns table (booking_id uuid, manage_token uuid, status text,
               hold_expires_at timestamptz, deposit_paise int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  b      public.businesses%rowtype;
  sv     public.services%rowtype;
  v_cust public.customers%rowtype;
  v_end  timestamptz;
  v_blk  timestamptz;
  v_stat text;
  v_exp  timestamptz;
  v_dep  int;
  v_id   uuid;
  v_tok  uuid;
begin
  select * into b from public.businesses where id = p_business;
  if not found then raise exception 'BUSINESS_NOT_FOUND' using errcode = 'P0001'; end if;

  select * into sv from public.services where id = p_service and business_id = p_business and active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0001'; end if;

  if not exists (select 1 from public.staff s
                 join public.staff_services ss on ss.staff_id = s.id
                 where s.id = p_staff and s.business_id = p_business and s.active
                   and ss.service_id = p_service) then
    raise exception 'STAFF_CANNOT_DO_SERVICE' using errcode = 'P0001';
  end if;

  v_end := p_start + make_interval(mins => sv.duration_min);
  v_blk := v_end   + make_interval(mins => b.buffer_min);

  if p_start <= now() then raise exception 'SLOT_IN_PAST' using errcode = 'P0001'; end if;
  if p_start >= now() + make_interval(days => b.max_days_ahead) then
    raise exception 'TOO_FAR_AHEAD' using errcode = 'P0001';
  end if;
  if not public.slot_in_schedule(p_staff, p_start, v_end, b.timezone) then
    raise exception 'OUTSIDE_SCHEDULE' using errcode = 'P0001';
  end if;

  -- existing customers keep their saved name (phones aren't verified, so a
  -- stranger typing someone's number must not rename them)
  insert into public.customers (business_id, name, phone)
  values (p_business, p_customer_name, p_phone)
  on conflict (business_id, phone) do update set phone = excluded.phone
  returning * into v_cust;

  if v_cust.blocked then raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0001'; end if;

  -- lazy expiry: free stale holds for this staff member and this customer
  update public.bookings set status = 'expired'
  where status = 'held' and hold_expires_at <= now()
    and (staff_id = p_staff or customer_id = v_cust.id);

  -- same browser changed its mind: release its own unpaid hold
  if p_hold_key is not null then
    update public.bookings set status = 'cancelled'
    where customer_id = v_cust.id and status = 'held'
      and hold_key = p_hold_key and payment_started_at is null;
  end if;

  v_dep := case when b.smart_deposit then public.deposit_for(v_cust.id, sv.id)
                else sv.deposit_paise end;

  if v_dep = 0 then
    v_stat := 'confirmed'; v_exp := null;            -- "pay at salon" or owner-trusted customer
  else
    v_stat := 'held'; v_exp := now() + make_interval(mins => b.hold_minutes);
  end if;

  begin
    insert into public.bookings
      (business_id, staff_id, service_id, customer_id, slot, status, hold_expires_at,
       deposit_paise, booked_name, hold_key)
    values
      (p_business, p_staff, p_service, v_cust.id, tstzrange(p_start, v_blk, '[)'),
       v_stat, v_exp, v_dep, p_customer_name, p_hold_key)
    returning id, bookings.manage_token into v_id, v_tok;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001';
    when unique_violation then
      raise exception 'ACTIVE_HOLD_EXISTS' using errcode = 'P0001';
  end;

  if v_stat = 'confirmed' then perform public.schedule_notifications(v_id); end if;

  return query select v_id, v_tok, v_stat, v_exp, v_dep;
end $$;

-- Walk-in queue: puts a walk-in customer into the EARLIEST real gap today
-- (now, after any booking ends, or when a working window opens), across
-- every staff member who can do the service. Appointments and walk-ins share
-- one calendar, so the exclusion constraint protects both. If another
-- request grabs the same gap first, it simply tries the next gap.
create function public.join_walkin_queue(
  p_business uuid, p_service uuid, p_customer_name text, p_phone text, p_staff uuid default null)
returns table (booking_id uuid, staff_id uuid, staff_name text, start_at timestamptz,
               wait_minutes int, manage_token uuid)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  b       public.businesses%rowtype;
  sv      public.services%rowtype;
  v_cust  public.customers%rowtype;
  v_from  timestamptz;
  v_today date;
  r       record;
  v_id    uuid;
  v_tok   uuid;
  tries   int := 0;
begin
  select * into b from public.businesses where id = p_business;
  if not found then raise exception 'BUSINESS_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into sv from public.services where id = p_service and business_id = p_business and active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0001'; end if;

  insert into public.customers (business_id, name, phone)
  values (p_business, p_customer_name, p_phone)
  on conflict (business_id, phone) do update set phone = excluded.phone
  returning * into v_cust;
  if v_cust.blocked then raise exception 'CUSTOMER_BLOCKED' using errcode = 'P0001'; end if;

  -- walk-ins at one salon are placed one at a time (they are low volume),
  -- so two walk-ins never race for the same gap
  perform pg_advisory_xact_lock(hashtext('walkin:' || p_business::text));

  -- one place in the queue per phone number
  if exists (select 1 from public.bookings bk
             where bk.customer_id = v_cust.id and bk.source = 'walkin'
               and bk.status = 'confirmed' and bk.started_at is null
               and upper(bk.slot) > now()) then
    raise exception 'WALKIN_ALREADY_QUEUED' using errcode = 'P0001';
  end if;

  -- earliest start: next 5-minute mark from now
  v_from  := to_timestamp(ceil(extract(epoch from clock_timestamp()) / 300) * 300);
  v_today := (v_from at time zone b.timezone)::date;

  loop
    tries := tries + 1;

    select x.sid, x.sname, x.s_at into r
    from (
      select st.id as sid, st.name as sname, cand.s_at
      from public.staff st
      join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service
      cross join lateral (
        select v_from as s_at
        union
        select upper(bk.slot) from public.bookings bk
         where bk.staff_id = st.id and bk.status in ('held', 'confirmed')
           and upper(bk.slot) > v_from
        union
        select ((v_today + wh.start_time) at time zone b.timezone)
          from public.working_hours wh
         where wh.staff_id = st.id and wh.weekday = extract(dow from v_today)::int
      ) cand
      where st.business_id = p_business and st.active
        and (p_staff is null or st.id = p_staff)
        and cand.s_at >= v_from
        and (cand.s_at at time zone b.timezone)::date = v_today
        and public.slot_in_schedule(st.id, cand.s_at,
              cand.s_at + make_interval(mins => sv.duration_min), b.timezone)
        and not exists (
              select 1 from public.bookings bk
               where bk.staff_id = st.id
                 and bk.slot && tstzrange(cand.s_at,
                       cand.s_at + make_interval(mins => sv.duration_min + b.buffer_min), '[)')
                 and (bk.status = 'confirmed'
                      or (bk.status = 'held' and bk.hold_expires_at > now())))
    ) x
    order by x.s_at, x.sname
    limit 1;

    if not found then raise exception 'NO_GAP_TODAY' using errcode = 'P0001'; end if;

    begin
      update public.bookings set status = 'expired'
       where staff_id = r.sid and status = 'held' and hold_expires_at <= now();

      insert into public.bookings
        (business_id, staff_id, service_id, customer_id, slot, status, source, deposit_paise, booked_name)
      values
        (p_business, r.sid, p_service, v_cust.id,
         tstzrange(r.s_at, r.s_at + make_interval(mins => sv.duration_min + b.buffer_min), '[)'),
         'confirmed', 'walkin', 0, p_customer_name)
      returning id, bookings.manage_token into v_id, v_tok;
      exit;
    exception when exclusion_violation then
      if tries >= 8 then raise exception 'QUEUE_BUSY' using errcode = 'P0001'; end if;
      -- someone took this gap a moment ago: loop and find the next one
    end;
  end loop;

  perform public.schedule_notifications(v_id);

  return query select v_id, r.sid, r.sname, r.s_at,
    greatest(0, ceil(extract(epoch from (r.s_at - now())) / 60))::int, v_tok;
end $$;

-- Called right before Razorpay Checkout opens. Refuses if the hold is about to
-- run out (paying with seconds left leads to a refund instead of a booking),
-- otherwise extends the hold ONCE to give the customer time to pay.
-- Returns the new expiry. Errors: HOLD_NOT_FOUND, HOLD_EXPIRED, HOLD_TOO_LATE
create function public.start_payment(p_booking uuid, p_hold_key uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare bk public.bookings%rowtype; v_exp timestamptz;
begin
  select * into bk from public.bookings where id = p_booking for update;
  if not found or bk.status <> 'held' or bk.hold_key is distinct from p_hold_key then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0001';
  end if;
  if bk.hold_expires_at <= now() then
    raise exception 'HOLD_EXPIRED' using errcode = 'P0001';
  end if;
  if bk.payment_started_at is not null then
    return bk.hold_expires_at;                       -- retry: no second extension
  end if;
  if bk.hold_expires_at - now() < interval '3 minutes' then
    raise exception 'HOLD_TOO_LATE' using errcode = 'P0001';
  end if;
  update public.bookings
     set payment_started_at = now(),
         hold_expires_at = greatest(hold_expires_at, now() + interval '10 minutes')
   where id = bk.id
  returning hold_expires_at into v_exp;
  return v_exp;
end $$;

-- pg_cron, hourly: owners forget to mark visits. Confirmed bookings that ended
-- 3+ hours ago become 'completed' (walk-ins only if they were started).
-- The owner can still change completed -> no_show afterwards.
create function public.auto_complete_bookings() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.bookings set status = 'completed'
  where status = 'confirmed'
    and upper(slot) < now() - interval '3 hours'
    and (source <> 'walkin' or started_at is not null);
  get diagnostics n = row_count;
  return n;
end $$;

-- pg_cron, every 5 minutes: safety net for walk-ins who left without telling
-- anyone. Not started 30+ minutes after their slot -> cancelled (slot freed).
-- The dashboard flags them earlier (10 min) so staff can tap "left" sooner.
create function public.release_stale_walkins() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.bookings set status = 'cancelled'
  where source = 'walkin' and status = 'confirmed' and started_at is null
    and lower(slot) < now() - interval '30 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- Called by the Razorpay webhook handler AFTER the signature is verified.
-- Returns: CONFIRMED | ALREADY_PROCESSED | REFUND_NEEDED | UNKNOWN_ORDER | AMOUNT_MISMATCH
create function public.confirm_payment(p_order_id text, p_payment_id text, p_amount_paise int)
returns text language plpgsql security definer set search_path = public as $$
declare p public.payments%rowtype; bk public.bookings%rowtype;
begin
  select * into p from public.payments where razorpay_order_id = p_order_id for update;
  if not found then return 'UNKNOWN_ORDER'; end if;
  if p.razorpay_payment_id is not null then return 'ALREADY_PROCESSED'; end if;
  if p.amount_paise <> p_amount_paise then return 'AMOUNT_MISMATCH'; end if;

  update public.payments
     set razorpay_payment_id = p_payment_id, status = 'captured', updated_at = now()
   where id = p.id;

  select * into bk from public.bookings where id = p.booking_id for update;

  if bk.status in ('held', 'expired') and lower(bk.slot) > now() then
    begin
      update public.bookings set status = 'confirmed', hold_expires_at = null where id = bk.id;
      perform public.schedule_notifications(bk.id);
      return 'CONFIRMED';
    exception when exclusion_violation then
      null;   -- someone else took the slot after this hold expired; fall through to refund
    end;
  end if;

  if bk.status = 'held' then
    update public.bookings set status = 'expired' where id = bk.id;
  end if;
  update public.payments set status = 'refund_pending', updated_at = now() where id = p.id;
  return 'REFUND_NEEDED';
end $$;

-- After the server calls Razorpay's refund API successfully.
create function public.mark_refunded(p_payment_id text, p_refund_id text) returns void
language sql security definer set search_path = public as $$
  update public.payments set status = 'refunded', refund_id = p_refund_id, updated_at = now()
  where razorpay_payment_id = p_payment_id and status = 'refund_pending'
$$;

-- Customer cancels through their private manage link.
-- Returns: CANCELLED | CANCELLED_REFUND | CANCELLED_NO_REFUND | NOT_CANCELLABLE | NOT_FOUND
create function public.cancel_booking(p_token uuid)
returns table (outcome text, refund_paise int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare bk public.bookings%rowtype; b public.businesses%rowtype; p public.payments%rowtype;
begin
  select * into bk from public.bookings where manage_token = p_token for update;
  if not found then return query select 'NOT_FOUND', 0; return; end if;
  if bk.status not in ('held', 'confirmed') or lower(bk.slot) <= now() then
    return query select 'NOT_CANCELLABLE', 0; return;
  end if;

  select * into b from public.businesses where id = bk.business_id;
  update public.bookings set status = 'cancelled' where id = bk.id;

  select * into p from public.payments where booking_id = bk.id and status = 'captured' for update;
  if not found then return query select 'CANCELLED', 0; return; end if;

  if lower(bk.slot) - now() >= make_interval(hours => b.cancel_window_hours) then
    update public.payments set status = 'refund_pending', updated_at = now() where id = p.id;
    return query select 'CANCELLED_REFUND', p.amount_paise;
  else
    return query select 'CANCELLED_NO_REFUND', 0;
  end if;
end $$;

-- pg_cron, every minute: mark unpaid holds as expired.
create function public.expire_stale_holds() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.bookings set status = 'expired'
  where status = 'held' and hold_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Notification worker: claims due messages without two workers taking the same one.
create function public.claim_due_notifications(p_limit int default 20)
returns table (notification_id uuid, kind text, phone text, customer_name text,
               start_at timestamptz, business_name text, timezone text, manage_token uuid)
language sql security definer set search_path = public as $$
  with due as (
    select n.id
    from public.notifications n
    join public.bookings bk on bk.id = n.booking_id
    where n.status = 'pending' and n.send_at <= now() and bk.status = 'confirmed'
    order by n.send_at
    limit p_limit
    for update of n skip locked
  ),
  upd as (
    update public.notifications n
       set status = 'sending', attempts = n.attempts + 1
      from due where n.id = due.id
    returning n.id, n.kind, n.booking_id
  )
  select upd.id, upd.kind, c.phone, c.name, lower(bk.slot), b.name, b.timezone, bk.manage_token
  from upd
  join public.bookings   bk on bk.id = upd.booking_id
  join public.customers  c  on c.id  = bk.customer_id
  join public.businesses b  on b.id  = bk.business_id
$$;

-- Worker reports the result; failures retry up to 3 attempts.
create function public.finish_notification(p_id uuid, p_ok boolean, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.notifications
     set status     = case when p_ok then 'sent'
                           when attempts >= 3 then 'failed'
                           else 'pending' end,
         sent_at    = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(p_error, 500) end
   where id = p_id and status = 'sending'
$$;

-- Rate limiter: true = allowed, false = blocked. Race-safe per key.
create function public.check_rate(p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_key));
  select count(*) into n from public.rate_events
  where key = p_key and created_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then return false; end if;
  insert into public.rate_events (key) values (p_key);
  return true;
end $$;

-- pg_cron, daily: keep the free-tier database small.
create function public.cleanup_rate_events() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.rate_events where created_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 6. FUNCTION PERMISSIONS
-- Supabase lets anon/authenticated call every public function through the API
-- unless you revoke it. Server-only functions must be locked to service_role.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.get_free_slots(uuid, uuid, date, uuid),
  public.create_hold(uuid, uuid, uuid, timestamptz, text, text, uuid),
  public.join_walkin_queue(uuid, uuid, text, text, uuid),
  public.deposit_for(uuid, uuid),
  public.start_payment(uuid, uuid),
  public.confirm_payment(text, text, int),
  public.mark_refunded(text, text),
  public.cancel_booking(uuid),
  public.expire_stale_holds(),
  public.auto_complete_bookings(),
  public.release_stale_walkins(),
  public.claim_due_notifications(int),
  public.finish_notification(uuid, boolean, text),
  public.check_rate(text, int, int),
  public.cleanup_rate_events(),
  public.schedule_notifications(uuid),
  public.slot_in_schedule(uuid, timestamptz, timestamptz, text),
  public.bookings_guard()
from public, anon, authenticated;

grant execute on function
  public.get_free_slots(uuid, uuid, date, uuid),
  public.create_hold(uuid, uuid, uuid, timestamptz, text, text, uuid),
  public.join_walkin_queue(uuid, uuid, text, text, uuid),
  public.deposit_for(uuid, uuid),
  public.start_payment(uuid, uuid),
  public.confirm_payment(text, text, int),
  public.mark_refunded(text, text),
  public.cancel_booking(uuid),
  public.expire_stale_holds(),
  public.auto_complete_bookings(),
  public.release_stale_walkins(),
  public.claim_due_notifications(int),
  public.finish_notification(uuid, boolean, text),
  public.check_rate(text, int, int),
  public.cleanup_rate_events()
to service_role;

revoke execute on function public.create_business(text, text) from public, anon;
grant  execute on function public.create_business(text, text) to authenticated;

revoke execute on function public.is_member(uuid), public.is_owner(uuid), public.is_viewer(uuid), public.my_staff_id(uuid) from public, anon;
grant  execute on function public.is_member(uuid), public.is_owner(uuid), public.is_viewer(uuid), public.my_staff_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. SAFE DEFAULTS FOR EVERYTHING ADDED LATER
-- Tables: new tables created by future migrations are NOT readable by the
-- anon key (every new table still needs RLS enabled + policies).
-- Functions: Postgres lets EVERYONE (via PUBLIC) execute new functions, and a
-- schema-level default cannot change that (a global one would also lock
-- extension functions such as pgTAP). So every migration that adds a function
-- MUST revoke it from public, anon, authenticated, and the guard test
-- "no function is callable from the browser unless allow-listed" fails if you forget.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
