-- Row Level Security, the profile column guard and basic quota use.
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-0000000000a1', 'a@example.com'),
    ('00000000-0000-0000-0000-0000000000b2', 'b@example.com');

select is(
    (select count(*)::int from public.profiles
      where id in ('00000000-0000-0000-0000-0000000000a1',
                   '00000000-0000-0000-0000-0000000000b2')),
    2,
    'signup trigger creates a profile for each new auth user'
);

insert into public.forms (id, user_id, name, target_email) values
    ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000a1', 'Form A', 'a@example.com'),
    ('00000000-0000-0000-0000-00000000f0b2', '00000000-0000-0000-0000-0000000000b2', 'Form B', 'b@example.com');

insert into public.submissions (id, form_id, payload) values
    ('00000000-0000-0000-0000-0000000050a1', '00000000-0000-0000-0000-00000000f0a1', '{"msg":"hi a"}'),
    ('00000000-0000-0000-0000-0000000050b2', '00000000-0000-0000-0000-00000000f0b2', '{"msg":"hi b"}');

-- ---------------------------------------------------------------- acting as user A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from public.profiles), 1,
    'A sees only their own profile');

select throws_ok(
    $$update public.profiles set plan_tier = 'agency' where id = '00000000-0000-0000-0000-0000000000a1'$$,
    '42501', null, 'A cannot self-upgrade plan_tier');

select throws_ok(
    $$update public.profiles set current_cycle_usage = 0, monthly_submission_limit = 999999
       where id = '00000000-0000-0000-0000-0000000000a1'$$,
    '42501', null, 'A cannot edit quota columns');

select is((select count(*)::int from public.forms), 1,
    'A sees only their own forms');

select lives_ok(
    $$insert into public.forms (user_id, name, target_email)
      values ('00000000-0000-0000-0000-0000000000a1', 'Another A form', 'a@example.com')$$,
    'A can create a form they own');

select throws_ok(
    $$insert into public.forms (user_id, name, target_email)
      values ('00000000-0000-0000-0000-0000000000b2', 'Planted form', 'a@example.com')$$,
    '42501', null, 'A cannot create a form owned by B');

select is((select count(*)::int from public.submissions), 1,
    'A sees only submissions for their own forms');

select throws_ok(
    $$insert into public.submissions (form_id, payload)
      values ('00000000-0000-0000-0000-00000000f0a1', '{}')$$,
    '42501', null, 'authenticated users cannot insert submissions');

select lives_ok(
    $$delete from public.submissions where form_id = '00000000-0000-0000-0000-00000000f0b2'$$,
    'A deleting B''s submissions is a silent no-op');

select lives_ok(
    $$update public.forms set name = 'pwned' where id = '00000000-0000-0000-0000-00000000f0b2'$$,
    'A updating B''s form is a silent no-op');

-- ---------------------------------------------------------------- back to postgres: verify no cross-tenant writes landed
reset role;

select is(
    (select count(*)::int from public.submissions where form_id = '00000000-0000-0000-0000-00000000f0b2'),
    1, 'B''s submission survived A''s delete attempt');

select is(
    (select name from public.forms where id = '00000000-0000-0000-0000-00000000f0b2'),
    'Form B', 'B''s form name survived A''s update attempt');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select * from public.forms$$, '42501', null,
    'anon has no access to forms');

-- ---------------------------------------------------------------- authenticated cannot call the quota RPC
reset role;
set local role authenticated;
select throws_ok(
    $$select public.consume_submission_quota('00000000-0000-0000-0000-0000000000a1')$$,
    '42501', null, 'authenticated users cannot execute consume_submission_quota');

-- ---------------------------------------------------------------- quota function (trusted caller)
reset role;
update public.profiles
   set monthly_submission_limit = 1, current_cycle_usage = 0
 where id = '00000000-0000-0000-0000-0000000000a1';

select is(public.consume_submission_quota('00000000-0000-0000-0000-0000000000a1'), true,
    'first submission consumes the last available slot');
select is(public.consume_submission_quota('00000000-0000-0000-0000-0000000000a1'), false,
    'second submission is rejected once the limit is reached');
select is(
    (select current_cycle_usage from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
    1, 'usage counter stops at the limit');

select * from finish();
rollback;
