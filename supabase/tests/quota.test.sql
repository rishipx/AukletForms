-- Quota cycle rollover in consume_submission_quota().
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000c3', 'c@example.com');

-- Expired cycle at the limit: the call rolls the cycle over and consumes slot #1.
update public.profiles
   set monthly_submission_limit = 250,
       current_cycle_usage = 250,
       cycle_resets_at = now() - interval '1 day'
 where id = '00000000-0000-0000-0000-0000000000c3';

select is(public.consume_submission_quota('00000000-0000-0000-0000-0000000000c3'), true,
    'expired cycle rolls over and accepts the submission');
select is(
    (select current_cycle_usage from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'),
    1, 'usage restarts at 1 after rollover');
select ok(
    (select cycle_resets_at > now() + interval '27 days'
       from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'),
    'cycle_resets_at is advanced roughly one month');

-- Live cycle at the limit: rejected, counter untouched.
update public.profiles
   set monthly_submission_limit = 5,
       current_cycle_usage = 5,
       cycle_resets_at = now() + interval '10 days'
 where id = '00000000-0000-0000-0000-0000000000c3';

select is(public.consume_submission_quota('00000000-0000-0000-0000-0000000000c3'), false,
    'live cycle at the limit is rejected');
select is(
    (select current_cycle_usage from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'),
    5, 'rejected submissions do not increment usage');

-- A zero limit never accepts submissions, even when the cycle has expired.
update public.profiles
   set monthly_submission_limit = 0,
       current_cycle_usage = 0,
       cycle_resets_at = now() - interval '1 day'
 where id = '00000000-0000-0000-0000-0000000000c3';

select is(public.consume_submission_quota('00000000-0000-0000-0000-0000000000c3'), false,
    'a zero limit rejects even after the cycle expires');

-- Unknown users are rejected rather than raising.
select is(public.consume_submission_quota('00000000-0000-0000-0000-0000000000ff'), false,
    'unknown user id returns false');

select * from finish();
rollback;
