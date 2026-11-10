-- Notification status, payload cap, daily email budget and the retention purge.
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-0000000000c1', 'free@example.com'),
    ('00000000-0000-0000-0000-0000000000c2', 'pro@example.com');
update public.profiles set plan_tier = 'pro', monthly_submission_limit = 3000
 where id = '00000000-0000-0000-0000-0000000000c2';

insert into public.forms (id, user_id, name, target_email) values
    ('00000000-0000-0000-0000-00000000f0c1', '00000000-0000-0000-0000-0000000000c1', 'Free form', 'free@example.com'),
    ('00000000-0000-0000-0000-00000000f0c2', '00000000-0000-0000-0000-0000000000c2', 'Pro form',  'pro@example.com');

-- ------------------------------------------------------------ notify_status and payload cap
select lives_ok(
    $$insert into public.submissions (form_id, payload, notify_status) values ('00000000-0000-0000-0000-00000000f0c1', '{"a":1}', 'skipped_cap')$$,
    'a valid notify_status is accepted');
select throws_ok(
    $$insert into public.submissions (form_id, payload, notify_status) values ('00000000-0000-0000-0000-00000000f0c1', '{"a":1}', 'bogus')$$,
    '23514', null, 'an unknown notify_status is rejected');
select throws_ok(
    $$insert into public.submissions (form_id, payload) values ('00000000-0000-0000-0000-00000000f0c1', jsonb_build_object('x', repeat('a', 140000)))$$,
    '23514', null, 'a payload over 128 KiB is rejected');

-- ------------------------------------------------------------ email budget
select is(public.consume_email_slot('00000000-0000-0000-0000-00000000f0c1', 2, 5), 'ok', 'first email is allowed');
select is(public.consume_email_slot('00000000-0000-0000-0000-00000000f0c1', 2, 5), 'ok', 'second email is allowed');
select is(public.consume_email_slot('00000000-0000-0000-0000-00000000f0c1', 2, 5), 'form_cap', 'third email hits the per-form cap');
select is((select sent from public.email_counters where scope = 'global' and day = (now() at time zone 'utc')::date), 2,
    'a denied email does not consume the global budget');
select is(public.consume_email_slot('00000000-0000-0000-0000-00000000f0c2', 2, 5), 'ok', 'another form still has its own budget');
select is((select sent from public.email_counters where scope = '00000000-0000-0000-0000-00000000f0c2'), 1, 'per-form counters are independent');

-- three emails have been sent globally so far (two from form c1, one from form c2)
select is(public.consume_email_slot('00000000-0000-0000-0000-00000000f0c2', 10, 4), 'ok', 'global budget: the 4th email is allowed under a cap of 4');
select is(public.consume_email_slot('00000000-0000-0000-0000-00000000f0c2', 10, 4), 'global_cap', 'global budget: the 5th email is denied');
select throws_ok($$select public.consume_email_slot('00000000-0000-0000-0000-00000000f0c2', -1, 3)$$, '22023', null, 'negative caps are rejected');

-- ------------------------------------------------------------ retention
insert into public.submissions (form_id, payload, created_at) values
    ('00000000-0000-0000-0000-00000000f0c1', '{"k":"free-old"}',    now() - interval '31 days'),
    ('00000000-0000-0000-0000-00000000f0c1', '{"k":"free-recent"}', now() - interval '29 days'),
    ('00000000-0000-0000-0000-00000000f0c2', '{"k":"pro-60d"}',     now() - interval '60 days'),
    ('00000000-0000-0000-0000-00000000f0c2', '{"k":"pro-100d"}',    now() - interval '100 days');
insert into public.billing_events (id, type, processed_at) values ('msg_old', 'subscription.active', now() - interval '40 days');
update public.email_counters set day = day - 10 where scope = 'global';

select is((public.purge_old_data() ->> 'submissions')::int, 2, 'purge removes free >30d and pro >90d submissions');
select is((select count(*)::int from public.submissions where payload ->> 'k' in ('free-recent', 'pro-60d')), 2, 'purge keeps rows inside their plan retention');
select is((select count(*)::int from public.billing_events where id = 'msg_old'), 0, 'purge removes old webhook claims');
select is((select count(*)::int from public.email_counters where scope = 'global' and day < (now() at time zone 'utc')::date - 7), 0, 'purge removes old email counters');

-- ------------------------------------------------------------ privileges
set local role authenticated;
select throws_ok($$select public.purge_old_data()$$, '42501', null, 'signed-in users cannot run the purge');
select throws_ok($$select public.consume_email_slot('00000000-0000-0000-0000-00000000f0c1', 1, 1)$$, '42501', null, 'signed-in users cannot spend email budget');

select * from finish();
rollback;
