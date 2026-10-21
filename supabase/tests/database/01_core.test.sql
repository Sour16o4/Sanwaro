-- Core rules: tenancy, slot engine, the no-double-booking constraint, holds,
-- payments, cancellation, status rules, permissions. Numbers match TESTING.md §3.
-- Days used: +1 constraint tests, +2 slot engine, +3 blocked customer, +5 payments.
begin;
\ir fixture.psql
select no_plan();

-- 01 -------------------------------------------------------------------------
select is((select count(*) from pg_tables where schemaname = 'public' and not rowsecurity),
          0::bigint, '01 RLS is on for every public table');

-- 02-03 onboarding -------------------------------------------------------------
select pg_temp.login(:'owner_b');
set local role authenticated;
select isnt(create_business('New Place', 'new-place'), null, '02 signed-in owner can create a salon');
reset role;
set local role anon;
select throws_ok($$ select create_business('Anon Place', 'anon-place') $$, '42501', null,
                 '03 anon cannot create a salon');
reset role;

-- 05 ---------------------------------------------------------------------------
select throws_ok($$ insert into working_hours (business_id, staff_id, weekday, start_time, end_time)
                    select business_id, id, 1, '12:00', '15:00' from staff where name = 'Ravi' $$,
                 '23P01', null, '05 overlapping working windows are rejected');

-- 07-09 slot engine (day +2) -----------------------------------------------------
-- 40-min haircut, 15-min steps: 10:00..12:15 (10 slots) + 14:00..18:15 (18 slots)
select is((select count(*) from get_free_slots(:'biz_a', pg_temp.svc('Haircut'),
             (now() at time zone 'Asia/Kolkata')::date + 2, pg_temp.sid('Ravi'))),
          28::bigint, '07 slot count for one stylist and one day');
select is((select min(start_at) from get_free_slots(:'biz_a', pg_temp.svc('Haircut'),
             (now() at time zone 'Asia/Kolkata')::date + 2, pg_temp.sid('Ravi'))),
          pg_temp.at(2, '10:00'), '08 first slot is 10:00 IST');
select is((select to_char(min(start_at) at time zone 'UTC', 'HH24:MI') from get_free_slots(:'biz_a',
             pg_temp.svc('Haircut'), (now() at time zone 'Asia/Kolkata')::date + 2, pg_temp.sid('Ravi'))),
          '04:30', '08 10:00 IST is stored as 04:30 UTC');
select is((select count(*) from get_free_slots(:'biz_a', pg_temp.svc('Haircut'),
             (now() at time zone 'Asia/Kolkata')::date + 2, pg_temp.sid('Ravi'))
           where end_at > pg_temp.at(2, '13:00') and start_at < pg_temp.at(2, '14:00')),
          0::bigint, '09 no slot touches the lunch break');
select is((select max(end_at) from get_free_slots(:'biz_a', pg_temp.svc('Haircut'),
             (now() at time zone 'Asia/Kolkata')::date + 2, pg_temp.sid('Ravi'))),
          pg_temp.at(2, '18:55'), '09 last slot (18:15-18:55) ends before closing');

delete from working_hours
where staff_id = pg_temp.sid('Ravi')
  and weekday = extract(dow from (now() at time zone 'Asia/Kolkata')::date + 4);
select is((select count(*) from get_free_slots(:'biz_a', pg_temp.svc('Haircut'),
             (now() at time zone 'Asia/Kolkata')::date + 4, pg_temp.sid('Ravi'))),
          0::bigint, '09 a day off (no working hours) has no slots');

insert into time_off (business_id, staff_id, period)
values (:'biz_a', pg_temp.sid('Ravi'), tstzrange(pg_temp.at(2, '10:00'), pg_temp.at(2, '11:00')));
select is((select count(*) from get_free_slots(:'biz_a', pg_temp.svc('Haircut'),
             (now() at time zone 'Asia/Kolkata')::date + 2, pg_temp.sid('Ravi'))),
          24::bigint, '09 time off removes the slots it overlaps');

select pg_temp.hold('Ravi', pg_temp.at(2, '15:00'), '9000000050') as slot_hold \gset
select is((select count(*) from get_free_slots(:'biz_a', pg_temp.svc('Haircut'),
             (now() at time zone 'Asia/Kolkata')::date + 2, pg_temp.sid('Ravi'))),
          19::bigint, '09 an active hold hides the slots it overlaps');
update bookings set hold_expires_at = now() - interval '1 second' where id = :'slot_hold';
select is((select count(*) from get_free_slots(:'biz_a', pg_temp.svc('Haircut'),
             (now() at time zone 'Asia/Kolkata')::date + 2, pg_temp.sid('Ravi'))),
          24::bigint, '09 an expired hold no longer blocks (lazy expiry)');

-- 11-17 the constraint and holds (day +1) ----------------------------------------
select pg_temp.hold('Ravi', pg_temp.at(1, '10:00'), '9000000001') as bk_ravi \gset
select is((select status from bookings where id = :'bk_ravi'), 'held', '11 first customer gets a hold');
select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(1, '10:00'), '9000000002') $$,
                 'P0001', 'SLOT_TAKEN', '11 same slot for a second customer is refused');
select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(1, '10:30'), '9000000002') $$,
                 'P0001', 'SLOT_TAKEN', '12 overlapping slot is refused');

update businesses set buffer_min = 10 where id = :'biz_a';
select lives_ok($$ select pg_temp.hold('Ravi', pg_temp.at(1, '11:00'), '9000000003') $$,
                '12 booking with a 10-min buffer');
select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(1, '11:45'), '9000000004') $$,
                 'P0001', 'SLOT_TAKEN', '12 the buffer after a booking is protected too');
update businesses set buffer_min = 0 where id = :'biz_a';

select lives_ok($$ select pg_temp.hold('Ravi', pg_temp.at(1, '14:00'), '9000000005') $$, '13 14:00-14:40');
select lives_ok($$ select pg_temp.hold('Ravi', pg_temp.at(1, '14:40'), '9000000006') $$,
                '13 back-to-back 14:40 is allowed');
select lives_ok($$ select pg_temp.hold('Bina', pg_temp.at(1, '10:00'), '9000000007') $$,
                '14 another stylist at the same time is allowed');

select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(1, '16:00'), '9000000001') $$,
                 'P0001', 'ACTIVE_HOLD_EXISTS', '16 one active hold per customer');

select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(1, '13:00'), '9000000015') $$,
                 'P0001', 'OUTSIDE_SCHEDULE', '17 lunch break is refused');
select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(1, '18:40'), '9000000015') $$,
                 'P0001', 'OUTSIDE_SCHEDULE', '17 running past closing is refused');
select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(2, '10:00'), '9000000015') $$,
                 'P0001', 'OUTSIDE_SCHEDULE', '17 time off is refused');
select throws_ok($$ select pg_temp.hold('Ravi', now() - interval '1 hour', '9000000015') $$,
                 'P0001', 'SLOT_IN_PAST', '17 past time is refused');
select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(40, '10:00'), '9000000015') $$,
                 'P0001', 'TOO_FAR_AHEAD', '17 more than 30 days ahead is refused');

-- 20 -----------------------------------------------------------------------------
select pg_temp.hold('Ravi', pg_temp.at(1, '16:00'), '9000000008', null, 'Pay at salon') as bk_free \gset
select is((select status from bookings where id = :'bk_free'), 'confirmed',
          '20 a no-deposit service is confirmed instantly');

-- 21-23 payments (day +5) -------------------------------------------------------------
select pg_temp.hold('Ravi', pg_temp.at(5, '10:00'), '9000000009') as bk_pay \gset
insert into payments (business_id, booking_id, razorpay_order_id, amount_paise)
values (:'biz_a', :'bk_pay', 'order_1', 10000);
select is(confirm_payment('order_1', 'pay_x', 5000), 'AMOUNT_MISMATCH', '23 wrong amount is rejected');
select is((select status from bookings where id = :'bk_pay'), 'held', '23 booking stays held');
select is(confirm_payment('order_1', 'pay_1', 10000), 'CONFIRMED', '21 payment confirms the booking');
select is((select status from bookings where id = :'bk_pay'), 'confirmed', '21 booking is confirmed');
select is((select count(*) from notifications where booking_id = :'bk_pay'), 3::bigint,
          '21 confirmation + 24h + 2h messages scheduled');
select is(confirm_payment('order_1', 'pay_1', 10000), 'ALREADY_PROCESSED', '22 duplicate webhook is ignored');
select is(confirm_payment('order_nope', 'pay_9', 10000), 'UNKNOWN_ORDER', '22 unknown order is ignored');

-- 24-26 expiry and late payments ------------------------------------------------------
select pg_temp.hold('Bina', pg_temp.at(5, '10:00'), '9000000010') as bk_late \gset
update bookings set hold_expires_at = now() - interval '1 second' where id = :'bk_late';
select ok(expire_stale_holds() >= 1, '24 expiry job runs');
select is((select status from bookings where id = :'bk_late'), 'expired', '24 unpaid hold expires');
insert into payments (business_id, booking_id, razorpay_order_id, amount_paise)
values (:'biz_a', :'bk_late', 'order_2', 10000);
select is(confirm_payment('order_2', 'pay_2', 10000), 'CONFIRMED', '25 late payment, slot still free: revived');

select pg_temp.hold('Bina', pg_temp.at(5, '11:00'), '9000000011') as bk_lost \gset
insert into payments (business_id, booking_id, razorpay_order_id, amount_paise)
values (:'biz_a', :'bk_lost', 'order_3', 10000);
update bookings set hold_expires_at = now() - interval '1 second' where id = :'bk_lost';
select pg_temp.hold('Bina', pg_temp.at(5, '11:00'), '9000000012') as bk_winner \gset
select is(confirm_payment('order_3', 'pay_3', 10000), 'REFUND_NEEDED', '26 late payment, slot taken: refund');
select is((select status from payments where razorpay_order_id = 'order_3'), 'refund_pending',
          '26 payment marked refund_pending');
select is((select status from bookings where id = :'bk_winner'), 'held', '26 the other customer keeps the slot');
select mark_refunded('pay_3', 'rfnd_1');
select is((select status from payments where razorpay_order_id = 'order_3'), 'refunded', '26 refund recorded');

-- 27-28 cancellation -------------------------------------------------------------------
select is((select outcome || ' ' || refund_paise from cancel_booking(
             (select manage_token from bookings where id = :'bk_pay'))),
          'CANCELLED_REFUND 10000', '27 cancel outside the window refunds the deposit');
select is((select status from payments where razorpay_order_id = 'order_1'), 'refund_pending',
          '27 payment queued for refund');
select is((select outcome from cancel_booking((select manage_token from bookings where id = :'bk_pay'))),
          'NOT_CANCELLABLE', '28 double cancel does nothing');
select is((select outcome from cancel_booking(gen_random_uuid())), 'NOT_FOUND', '28 unknown token');
update businesses set cancel_window_hours = 168 where id = :'biz_a';
select is((select outcome from cancel_booking((select manage_token from bookings where id = :'bk_late'))),
          'CANCELLED_NO_REFUND', '27 cancel inside the window keeps the deposit');
update businesses set cancel_window_hours = 24 where id = :'biz_a';
select is((select outcome from cancel_booking((select manage_token from bookings where id = :'bk_free'))),
          'CANCELLED', '27 cancel with nothing paid');

-- 29-31 status rules -------------------------------------------------------------------
select throws_like(format('update bookings set status = %L where id = %L', 'confirmed', :'bk_pay'),
                   '%INVALID_STATUS_TRANSITION%', '29 a cancelled booking cannot be revived');
select pg_temp.hold('Bina', pg_temp.at(1, '16:00'), '9000000013', null, 'Pay at salon') as bk_future \gset
select throws_ok(format('update bookings set status = %L where id = %L', 'completed', :'bk_future'),
                 'P0001', 'APPOINTMENT_NOT_STARTED', '29 a future visit cannot be completed');

insert into customers (business_id, name, phone) values (:'biz_a', 'Past Guest', '9000000014');
insert into bookings (business_id, staff_id, service_id, customer_id, slot, status)
select :'biz_a', pg_temp.sid('Ravi'), pg_temp.svc('Haircut'), c.id,
       tstzrange(pg_temp.at(-1, '10:00'), pg_temp.at(-1, '10:40')), 'confirmed'
from customers c where phone = '9000000014'
returning id as bk_past \gset
update bookings set status = 'no_show' where id = :'bk_past';
select is((select no_show_count from customers where phone = '9000000014'), 1, '30 no-show adds to the counter');
update customers set blocked = true where phone = '9000000014';
select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(3, '10:00'), '9000000014') $$,
                 'P0001', 'CUSTOMER_BLOCKED', '31 a blocked customer cannot book');

-- 06, 32 tenancy ---------------------------------------------------------------------------
select id as cust_a from customers where phone = '9000000001' \gset
select pg_temp.login(:'owner_b');
set local role authenticated;
select is((select count(*) from bookings  where business_id = :'biz_a'), 0::bigint, '06 salon B sees no bookings of A');
select is((select count(*) from customers where business_id = :'biz_a'), 0::bigint, '06 salon B sees no customers of A');
select is((select count(*) from staff     where business_id = :'biz_a'), 0::bigint, '06 salon B sees no staff of A');
update staff set name = 'Hacked' where business_id = :'biz_a';
update bookings set status = 'cancelled' where business_id = :'biz_a';
reset role;
select is((select count(*) from staff where name = 'Hacked'), 0::bigint, '32 salon B cannot change A');
select ok((select count(*) from bookings where business_id = :'biz_a' and status <> 'cancelled') > 0,
          '32 salon B cannot cancel A''s bookings');

-- 33-35 RLS details -------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select count(*) from bookings $$,  '42501', null, '33 anon cannot read bookings');
select throws_ok($$ select count(*) from customers $$, '42501', null, '33 anon cannot read customers');
reset role;

select pg_temp.sid('Ravi') as ravi, pg_temp.sid('Bina') as bina, pg_temp.svc('Haircut') as haircut,
       pg_temp.at(1, '10:00') as t1000 \gset
select pg_temp.login(:'owner_a');
set local role authenticated;
select ok((select count(*) from payments) > 0, '33 owner can read their payments');
select throws_ok($$ insert into payments (business_id, booking_id, razorpay_order_id, amount_paise)
                    select business_id, id, 'order_fake', 100 from bookings limit 1 $$,
                 '42501', null, '33 payments are not writable from the browser');
select throws_ok(format($$ insert into bookings (business_id, staff_id, service_id, customer_id, slot, status, source)
                           values (%L, %L, %L, %L, tstzrange(%L::timestamptz, %L::timestamptz + interval '30 min'),
                                   'confirmed', 'manual') $$,
                        :'biz_a', :'ravi', :'haircut', :'cust_a', :'t1000', :'t1000'),
                 '23P01', null, '35 owner phone booking over an existing booking is refused');
select throws_ok(format($$ insert into bookings (business_id, staff_id, service_id, customer_id, slot, status, hold_expires_at, source)
                           values (%L, %L, %L, %L, tstzrange(now() + interval '3 days', now() + interval '3 days 30 min'),
                                   'held', now(), 'online') $$,
                        :'biz_a', :'ravi', :'haircut', :'cust_a'),
                 '42501', null, '35 owner can only insert confirmed manual bookings');
reset role;

select pg_temp.login(:'staff_u');
set local role authenticated;
select is((select count(*) from bookings where staff_id <> :'bina'), 0::bigint, '34 staff see only their own bookings');
select ok((select count(*) from bookings where staff_id = :'bina') > 0, '34 staff see their own bookings');
update bookings set started_at = now() where staff_id = :'ravi';
reset role;
select is((select count(*) from bookings where staff_id = :'ravi' and started_at is not null), 0::bigint,
          '34 staff cannot change another stylist''s bookings');

-- 36 server-only functions ---------------------------------------------------------------------
select is((select count(*) from unnest(array[
             'public.get_free_slots(uuid,uuid,date,uuid)',
             'public.create_hold(uuid,uuid,uuid,timestamptz,text,text,uuid)',
             'public.confirm_payment(text,text,int)',
             'public.mark_refunded(text,text)',
             'public.cancel_booking(uuid)',
             'public.claim_due_notifications(int)',
             'public.check_rate(text,int,int)']) f
           cross join unnest(array['anon', 'authenticated']) r
           where has_function_privilege(r, f, 'execute')),
          0::bigint, '36 server-only functions are not callable from the browser');
set local role authenticated;
select throws_ok($$ select confirm_payment('order_1', 'pay_evil', 10000) $$, '42501', null,
                 '36 browser RPC to confirm_payment is refused');
reset role;

-- 37-39 integrity -------------------------------------------------------------------------------
select throws_ok(format($$ insert into bookings (business_id, staff_id, service_id, customer_id, slot, status)
                           values (%L, %L, %L, %L, tstzrange(now() + interval '6 days', now() + interval '6 days 40 min'), 'confirmed') $$,
                        :'biz_a', pg_temp.sid('Bob'), :'haircut', :'cust_a'),
                 '23503', null, '37 salon B''s stylist cannot be attached to a salon A booking');
select throws_ok($$ select pg_temp.hold('Ravi', pg_temp.at(3, '11:00'), '12345') $$,
                 '23514', null, '38 invalid phone is refused');
select throws_ok(format($$ insert into services (business_id, name, duration_min, price_paise, deposit_paise)
                           values (%L, 'Bad', 30, 30000, 50000) $$, :'biz_a'),
                 '23514', null, '38 deposit above price is refused');

select pg_temp.login(:'owner_b');
set local role authenticated;
select lives_ok($$ select create_business('Third Place', 'third-place') $$, '39 third salon is allowed');
select throws_ok($$ select create_business('Fourth Place', 'fourth-place') $$,
                 'P0001', 'BUSINESS_LIMIT_REACHED', '39 a fourth salon is refused');
reset role;

-- 41-42 workers ------------------------------------------------------------------------------------
select notification_id as n1 from claim_due_notifications(100) limit 1 \gset
select finish_notification(:'n1', false, 'boom');
select is((select status from notifications where id = :'n1'), 'pending', '41 failed send is retried');
select count(*) from claim_due_notifications(100);
select finish_notification(:'n1', false, 'boom');
select count(*) from claim_due_notifications(100);
select finish_notification(:'n1', false, 'boom');
select is((select status || ' ' || attempts from notifications where id = :'n1'), 'failed 3',
          '41 marked failed after 3 attempts');

select is(array[check_rate('t:k', 2, 60), check_rate('t:k', 2, 60), check_rate('t:k', 2, 60)],
          array[true, true, false], '42 rate limiter blocks the 3rd call over a limit of 2');

select * from finish();
rollback;
