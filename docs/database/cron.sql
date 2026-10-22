-- ============================================================================
-- Sanwaro — scheduled jobs (Supabase ONLY; run after schema.sql)
-- Needs the pg_cron and pg_net extensions (enable in Dashboard → Database → Extensions).
-- All pg_cron schedules are in UTC.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Store the app URL and a random secret the API route will check.
--    Generate the secret yourself (e.g. `openssl rand -hex 32`) and put the
--    SAME value in Vercel as NOTIFY_SECRET.
insert into private.app_config (key, value) values
  ('app_url',       'https://YOUR-APP.vercel.app'),
  ('notify_secret', 'REPLACE_WITH_RANDOM_SECRET')
on conflict (key) do update set value = excluded.value;

-- 2. Every minute: expire unpaid holds.
select cron.schedule('expire-holds', '* * * * *',
  $$ select public.expire_stale_holds(); $$);

-- 3. Every 5 minutes: ask the app to send due WhatsApp messages.
select cron.schedule('send-notifications', '*/5 * * * *', $$
  select net.http_post(
    url     := (select value from private.app_config where key = 'app_url') || '/api/notifications/send',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-notify-secret', (select value from private.app_config where key = 'notify_secret')),
    body    := '{}'::jsonb
  );
$$);

-- 3b. Hourly: mark forgotten visits completed (owners can still correct to no-show).
select cron.schedule('auto-complete', '7 * * * *',
  $$ select public.auto_complete_bookings(); $$);

-- 3c. Every 5 minutes: release walk-ins who left without telling anyone.
select cron.schedule('release-walkins', '*/5 * * * *',
  $$ select public.release_stale_walkins(); $$);

-- 3d. Daily 04:23 UTC: retry failed refunds and pay back in-time cancellations.
select cron.schedule('refund-sweep', '23 4 * * *', $$
  select net.http_post(
    url     := (select value from private.app_config where key = 'app_url') || '/api/payments/sweep',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-notify-secret', (select value from private.app_config where key = 'notify_secret')),
    body    := '{}'::jsonb
  );
$$);

-- 4. Daily 03:17 UTC: clean the rate-limiter table (keeps the free 500 MB database small).
select cron.schedule('cleanup-rate-events', '17 3 * * *',
  $$ select public.cleanup_rate_events(); $$);

-- 5. Daily 20:43 UTC (≈ 02:13 IST): reset the public demo salon.
--    Write public.reset_demo_salon() in Phase 9 (deletes demo bookings/customers, re-seeds).
-- select cron.schedule('reset-demo', '43 20 * * *', $$ select public.reset_demo_salon(); $$);

-- Useful checks:
--   select * from cron.job;                                   -- list jobs
--   select * from cron.job_run_details order by start_time desc limit 20;  -- did they run?
--   select * from net._http_response order by created desc limit 20;      -- pg_net responses
--   select cron.unschedule('send-notifications');             -- stop a job
