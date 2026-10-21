-- Signature features (smart deposit, walk-in queue), design-review fixes,
-- demo viewer and the permission guard. Numbers match TESTING.md §3.
begin;
\ir fixture.psql
select no_plan();

-- Haircut: price ₹300, deposit ₹100. Past visits are inserted directly (the
-- status guard only checks updates).
insert into customers (business_id, name, phone, no_show_count, trusted) values
  (:'biz_a', 'Asha (regular)', '9000000021', 0, false),
  (:'biz_a', 'One no-show',    '9000000022', 1, false),
  (:'biz_a', 'Two no-shows',   '9000000023', 2, false),
  (:'biz_a', 'Trusted',        '9000000025', 0, true);
insert into bookings (business_id, staff_id, service_id, customer_id, slot, status)
select :'biz_a', pg_temp.sid('Ravi'), pg_temp.svc('Haircut'), c.id,
       tstzrange(pg_temp.at(-d, '10:00'), pg_temp.at(-d, '10:40')), 'completed'
from customers c cross join generate_series(1, 3) d
where c.phone = '9000000021';

-- 44-46, 53-54 smart deposit ------------------------------------------------------
select pg_temp.hold('Ravi', pg_temp.at(1, '10:00'), '9000000021', null, 'Haircut', 'Impostor') as bk_reg \gset
select is((select deposit_paise from bookings where id = :'bk_reg'), 5000, '44 regular (3 visits) pays half');
select is((select status from bookings where id = :'bk_reg'), 'held', '44 history alone never gives ₹0');
select is((select name from customers where phone = '9000000021'), 'Asha (regular)',
          '54 typing someone''s phone does not rename them');
select is((select booked_name from bookings where id = :'bk_reg'), 'Impostor',
          '54 the booking keeps the name typed for it');

select pg_temp.hold('Ravi', pg_temp.at(1, '11:00'), '9000000024') as bk_new \gset
select is((select deposit_paise from bookings where id = :'bk_new'), 10000, '45 new customer pays the normal deposit');
select pg_temp.hold('Ravi', pg_temp.at(1, '12:00'), '9000000022') as bk_ns1 \gset
select is((select deposit_paise from bookings where id = :'bk_ns1'), 20000, '45 one no-show pays double');
select pg_temp.hold('Ravi', pg_temp.at(1, '14:00'), '9000000023') as bk_ns2 \gset
select is((select deposit_paise from bookings where id = :'bk_ns2'), 30000, '45 two no-shows pay full price');

update bookings set status = 'cancelled' where id = :'bk_ns2';   -- free this customer's one hold
update businesses set smart_deposit = false where id = :'biz_a';
select pg_temp.hold('Bina', pg_temp.at(1, '14:00'), '9000000023') as bk_off \gset
update businesses set smart_deposit = true where id = :'biz_a';
select is((select deposit_paise from bookings where id = :'bk_off'), 10000,
          '46 smart deposit switched off: everyone pays the normal deposit');

select pg_temp.hold('Ravi', pg_temp.at(1, '15:00'), '9000000025') as bk_trust \gset
select is((select deposit_paise || ' ' || status from bookings where id = :'bk_trust'), '0 confirmed',
          '53 owner-trusted customer: ₹0, confirmed instantly');
update customers set no_show_count = 1 where phone = '9000000025';
select is(deposit_for((select id from customers where phone = '9000000025'), pg_temp.svc('Haircut')), 20000,
          '53 trust is lost after a no-show');

select pg_temp.login(:'staff_u');
set local role authenticated;
update customers set trusted = true where phone = '9000000024';
reset role;
select is((select trusted from customers where phone = '9000000024'), false, '53 staff cannot grant trust');
select pg_temp.login(:'owner_a');
set local role authenticated;
update customers set trusted = true where phone = '9000000024';
reset role;
select is((select trusted from customers where phone = '9000000024'), true, '53 the owner can grant trust');

-- 55-56 hold switching and start_payment (day +2) ------------------------------------
\set key1 '11111111-1111-1111-1111-111111111111'
\set key2 '22222222-2222-2222-2222-222222222222'
select pg_temp.hold('Ravi', pg_temp.at(2, '10:00'), '9000000026', :'key1') as hold_a \gset
select pg_temp.hold('Ravi', pg_temp.at(2, '11:00'), '9000000026', :'key1') as hold_b \gset
select is((select status from bookings where id = :'hold_a'), 'cancelled', '55 same browser: old hold released');
select is((select status from bookings where id = :'hold_b'), 'held',      '55 same browser: new hold taken');
select throws_ok(format($$ select pg_temp.hold('Ravi', pg_temp.at(2, '12:00'), '9000000026', %L) $$, :'key2'),
                 'P0001', 'ACTIVE_HOLD_EXISTS', '55 another browser with the same phone cannot release it');

select throws_ok(format('select start_payment(%L, %L)', :'hold_b', :'key2'),
                 'P0001', 'HOLD_NOT_FOUND', '56 start_payment checks the browser key');
select start_payment(:'hold_b', :'key1') as exp1 \gset
select is(:'exp1'::timestamptz, now() + interval '10 minutes', '56 hold extended to 10 min');
select is(start_payment(:'hold_b', :'key1'), :'exp1'::timestamptz, '56 extended only once');
select throws_ok(format($$ select pg_temp.hold('Ravi', pg_temp.at(2, '12:00'), '9000000026', %L) $$, :'key1'),
                 'P0001', 'ACTIVE_HOLD_EXISTS', '56 a hold being paid for is not released by switching');

select pg_temp.hold('Bina', pg_temp.at(2, '10:00'), '9000000027', :'key2') as hold_late \gset
update bookings set hold_expires_at = now() + interval '2 minutes' where id = :'hold_late';
select throws_ok(format('select start_payment(%L, %L)', :'hold_late', :'key2'),
                 'P0001', 'HOLD_TOO_LATE', '56 less than 3 min left: refuse before paying');
update bookings set hold_expires_at = now() - interval '1 second' where id = :'hold_late';
select throws_ok(format('select start_payment(%L, %L)', :'hold_late', :'key2'),
                 'P0001', 'HOLD_EXPIRED', '56 expired hold cannot start a payment');

-- 57-58 auto-complete and stale walk-ins ------------------------------------------------
insert into customers (business_id, name, phone) values (:'biz_a', 'Forgotten', '9000000028');
insert into bookings (business_id, staff_id, service_id, customer_id, slot, status, source, started_at)
select :'biz_a', pg_temp.sid(v.staff), pg_temp.svc('Haircut'), c.id,
       tstzrange(now() - v.ago, now() - v.ago + interval '40 min'), 'confirmed', v.source, v.started
from customers c,
     (values ('Ravi', interval '5 hours', 'online', null::timestamptz),
             ('Bina', interval '5 hours', 'walkin', null),
             ('Bina', interval '2 hours', 'walkin', now() - interval '2 hours')) v(staff, ago, source, started)
where c.phone = '9000000028';

select is(auto_complete_bookings(), 1, '57 one forgotten visit auto-completed');
select is((select status from bookings where source = 'online' and slot && tstzrange(now() - interval '6 hours', now())),
          'completed', '57 visit that ended 3+ h ago is completed');
update bookings set status = 'no_show'
where source = 'online' and slot && tstzrange(now() - interval '6 hours', now());
select is((select no_show_count from customers where phone = '9000000028'), 1,
          '57 owner can correct completed -> no-show');

select is(release_stale_walkins(), 1, '58 walk-in who never started is released');
select is((select count(*) from bookings where source = 'walkin' and status = 'confirmed'), 1::bigint,
          '58 a started walk-in is kept');

-- 47-51, 59 walk-in queue ------------------------------------------------------------------
-- A third salon whose clock reads about noon right now, so these tests pass at any hour.
insert into businesses (id, name, slug, timezone) values
  ('00000000-0000-0000-0000-00000000cccc', 'Queue Salon', 'queue-salon',
   (select case when o > 0 then 'Etc/GMT-' || o when o < 0 then 'Etc/GMT+' || -o else 'Etc/GMT' end
    from (select 12 - extract(hour from now() at time zone 'UTC')::int as o) x));
\set biz_c '00000000-0000-0000-0000-00000000cccc'
insert into staff (business_id, name) values (:'biz_c', 'Kiran'), (:'biz_c', 'Meena');
insert into services (business_id, name, duration_min, price_paise) values (:'biz_c', 'Quick cut', 30, 15000);
insert into staff_services (business_id, staff_id, service_id)
select :'biz_c', id, pg_temp.svc('Quick cut') from staff where business_id = :'biz_c';
insert into working_hours (business_id, staff_id, weekday, start_time, end_time)
select :'biz_c', s.id, d, '08:00', '20:00' from staff s cross join generate_series(0, 6) d
where s.business_id = :'biz_c';
insert into customers (business_id, name, phone) values (:'biz_c', 'Online', '9100000000');

-- the queue's earliest start: the next 5-minute mark
select to_timestamp(ceil(extract(epoch from clock_timestamp()) / 300) * 300) as vf,
       pg_temp.svc('Quick cut') as quick, pg_temp.sid('Meena') as meena,
       (select id from customers where phone = '9100000000') as online_c \gset

select * from join_walkin_queue(:'biz_c', :'quick', 'W one', '9100000032') \gset w1_
select is(:'w1_staff_name' || ' ' || (:'w1_start_at'::timestamptz = :'vf'::timestamptz), 'Kiran true',
          '48 first walk-in starts at the next 5-min mark');
select ok(:w1_wait_minutes between 0 and 5, '48 wait shown in minutes');
select * from join_walkin_queue(:'biz_c', :'quick', 'W two', '9100000033') \gset w2_
select is(:'w2_staff_name' || ' ' || (:'w2_start_at'::timestamptz = :'vf'::timestamptz), 'Meena true',
          '48 second walk-in goes to the other free stylist');
select * from join_walkin_queue(:'biz_c', :'quick', 'W three', '9100000034') \gset w3_
select is(:'w3_start_at'::timestamptz, :'vf'::timestamptz + interval '30 min',
          '49 third walk-in queues back-to-back');

-- Meena: walk-in until vf+30, appointment at vf+50 (20-min gap is too short for 30 min)
insert into bookings (business_id, staff_id, service_id, customer_id, slot, status)
values (:'biz_c', :'meena', :'quick', :'online_c',
        tstzrange(:'vf'::timestamptz + interval '50 min', :'vf'::timestamptz + interval '80 min'), 'confirmed');
select * from join_walkin_queue(:'biz_c', :'quick', 'W four', '9100000035', :'meena') \gset w4_
select is(:'w4_start_at'::timestamptz, :'vf'::timestamptz + interval '80 min',
          '47 walk-in skips a gap that is too short and goes after the appointment');

-- an online customer is holding Meena's next gap right now
insert into bookings (business_id, staff_id, service_id, customer_id, slot, status, hold_expires_at)
values (:'biz_c', :'meena', :'quick', :'online_c',
        tstzrange(:'vf'::timestamptz + interval '110 min', :'vf'::timestamptz + interval '140 min'),
        'held', now() + interval '7 min');
select * from join_walkin_queue(:'biz_c', :'quick', 'W five', '9100000036', :'meena') \gset w5_
select is(:'w5_start_at'::timestamptz, :'vf'::timestamptz + interval '140 min',
          '51 walk-in respects an online hold');

select throws_ok(format($$ select * from join_walkin_queue(%L, %L, 'W one again', '9100000032') $$, :'biz_c', :'quick'),
                 'P0001', 'WALKIN_ALREADY_QUEUED', '59 one place in the queue per phone');
select is((select count(*) from bookings a join bookings b
             on a.staff_id = b.staff_id and a.id < b.id and a.slot && b.slot
           where a.business_id = :'biz_c' and a.status in ('held', 'confirmed') and b.status in ('held', 'confirmed')),
          0::bigint, '47 no overlapping bookings in the queue salon');

-- 60 demo viewer ---------------------------------------------------------------------------------
select pg_temp.login(:'viewer_u');
set local role authenticated;
select ok((select count(*) from bookings) > 0, '60 viewer can read bookings');
select ok((select count(*) from payments) >= 0 and (select count(*) from customers) > 0, '60 viewer can read customers');
update bookings set status = 'cancelled';
update businesses set name = 'Vandalised';
update customers set blocked = true;
delete from staff;
select throws_ok(format($$ insert into staff (business_id, name) values (%L, 'Spam') $$, :'biz_a'),
                 '42501', null, '60 viewer cannot insert');
reset role;
select is((select count(*) from businesses where name = 'Vandalised'), 0::bigint, '60 viewer cannot rename the salon');
select is((select count(*) from customers where blocked), 0::bigint, '60 viewer cannot block customers');
select is((select count(*) from staff where business_id = :'biz_a'), 2::bigint, '60 viewer cannot delete staff');
select ok((select count(*) from bookings where business_id = :'biz_a' and status = 'held') > 0,
          '60 viewer cannot cancel bookings');

-- 61-62 guard -------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
          0::bigint, '61 GUARD: anon can call no function in public');
select set_eq($$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') $$,
              array['create_business', 'is_member', 'is_owner', 'is_viewer', 'my_staff_id'],
              '61 GUARD: signed-in users can call only the allow-listed functions');
create table public.zz_future_table (id int);
select ok(not has_table_privilege('anon', 'public.zz_future_table', 'select'),
          '61 GUARD: tables added later are locked for anon');
select is((select count(*) from unnest(array[
             'public.join_walkin_queue(uuid,uuid,text,text,uuid)', 'public.deposit_for(uuid,uuid)',
             'public.start_payment(uuid,uuid)', 'public.auto_complete_bookings()',
             'public.release_stale_walkins()']) f
           cross join unnest(array['anon', 'authenticated']) r
           where has_function_privilege(r, f, 'execute')),
          0::bigint, '52/62 walk-in, deposit and review-fix functions are server-only');

select * from finish();
rollback;
