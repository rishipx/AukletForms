-- Webhook-id claims (idempotency table) and its access rules.
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- Trusted role (postgres) can claim a webhook id once; a replay hits the primary key.
select lives_ok(
    $$insert into public.billing_events (id, type) values ('msg_test_1', 'subscription.active')$$,
    'first delivery of a webhook id is claimed');

select throws_ok(
    $$insert into public.billing_events (id, type) values ('msg_test_1', 'subscription.active')$$,
    '23505', null, 'a replayed webhook id is rejected as a duplicate');

select lives_ok(
    $$delete from public.billing_events where id = 'msg_test_1'$$,
    'a claim can be released so the provider can retry');

-- Neither browser-facing role can touch the table.
set local role authenticated;
select throws_ok($$select * from public.billing_events$$, '42501', null,
    'authenticated users cannot read billing_events');

reset role;
set local role anon;
select throws_ok(
    $$insert into public.billing_events (id, type) values ('msg_evil', 'x')$$,
    '42501', null, 'anon cannot write billing_events');
reset role;

-- Column guard: a signed-in user cannot edit billing columns on their own profile.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'guard@example.com');

select is((select plan_tier from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
    'free', 'new profile starts on the free plan');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select throws_ok(
    $$update public.profiles set billing_subscription_id = 'sub_fake' where id = '00000000-0000-0000-0000-0000000000b1'$$,
    '42501', null, 'users cannot set their own subscription id');

select throws_ok(
    $$update public.profiles set billing_updated_at = now() where id = '00000000-0000-0000-0000-0000000000b1'$$,
    '42501', null, 'users cannot move the billing event watermark');

select * from finish();
rollback;
