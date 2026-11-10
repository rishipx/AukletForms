-- =====================================================================
-- Auklet Forms: daily email budget and data retention
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Daily email budget
--
-- Per-form and global daily caps keep one spammy form from using up the shared
-- email-provider allowance.
-- ---------------------------------------------------------------------

CREATE TABLE public.email_counters (
    day   DATE NOT NULL,
    scope TEXT NOT NULL,                 -- 'global' or a form id
    sent  INT  NOT NULL DEFAULT 0 CHECK (sent >= 0),
    PRIMARY KEY (day, scope)
);

ALTER TABLE public.email_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_counters TO service_role;

COMMENT ON TABLE public.email_counters IS
    'Emails sent per UTC day, globally and per form. Rows older than a week are deleted by purge_old_data().';

-- Atomically reserve one email. Returns 'ok', 'form_cap' or 'global_cap'.
-- Both counter rows are locked in a fixed order so concurrent calls cannot deadlock
-- or both slip past a cap.
CREATE OR REPLACE FUNCTION public.consume_email_slot(p_form_id UUID, p_form_cap INT, p_global_cap INT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_day    DATE := (NOW() AT TIME ZONE 'utc')::DATE;
    v_scope  TEXT := p_form_id::TEXT;
    v_global INT  := 0;
    v_form   INT  := 0;
    r        RECORD;
BEGIN
    IF p_form_cap < 0 OR p_global_cap < 0 THEN
        RAISE EXCEPTION 'caps must not be negative' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.email_counters (day, scope)
    VALUES (v_day, 'global'), (v_day, v_scope)
    ON CONFLICT DO NOTHING;

    FOR r IN
        SELECT scope, sent FROM public.email_counters
        WHERE day = v_day AND scope IN ('global', v_scope)
        ORDER BY scope
        FOR UPDATE
    LOOP
        IF r.scope = 'global' THEN v_global := r.sent; ELSE v_form := r.sent; END IF;
    END LOOP;

    IF v_global >= p_global_cap THEN RETURN 'global_cap'; END IF;
    IF v_form   >= p_form_cap   THEN RETURN 'form_cap';   END IF;

    UPDATE public.email_counters SET sent = sent + 1
    WHERE day = v_day AND scope IN ('global', v_scope);
    RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.consume_email_slot(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_email_slot(UUID, INT, INT) TO service_role;

-- ---------------------------------------------------------------------
-- 2. Retention
--
-- Free keeps 30 days of submissions, Pro 90, Agency 365. Also trims bookkeeping
-- tables. Called daily by the Worker's cron trigger (no pg_cron dependency); the
-- same call counts as database activity, so a free Supabase project is not paused.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purge_old_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    n_submissions INT;
    n_events      INT;
    n_counters    INT;
BEGIN
    DELETE FROM public.submissions sub
    USING public.forms f
    JOIN public.profiles p ON p.id = f.user_id
    WHERE sub.form_id = f.id
      AND sub.created_at < NOW() - CASE p.plan_tier
            WHEN 'free' THEN INTERVAL '30 days'
            WHEN 'pro'  THEN INTERVAL '90 days'
            ELSE             INTERVAL '365 days'
          END;
    GET DIAGNOSTICS n_submissions = ROW_COUNT;

    DELETE FROM public.billing_events WHERE processed_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS n_events = ROW_COUNT;

    DELETE FROM public.email_counters WHERE day < (NOW() AT TIME ZONE 'utc')::DATE - 7;
    GET DIAGNOSTICS n_counters = ROW_COUNT;

    RETURN jsonb_build_object('submissions', n_submissions, 'billing_events', n_events, 'email_counters', n_counters);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_data() TO service_role;
