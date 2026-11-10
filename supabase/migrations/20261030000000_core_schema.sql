-- =====================================================================
-- Auklet Forms: core schema (profiles, forms, submissions) and access control
--
-- Trust model
--   * Dashboard users  -> role `authenticated`  (RLS-restricted, least privilege)
--   * Server-side code -> role `service_role`   (bypasses RLS; never exposed to browsers)
--   * Public visitors  -> role `anon`           (no table access at all)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Shared helpers
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 2. Profiles (one row per auth user)
-- ---------------------------------------------------------------------

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    plan_tier TEXT NOT NULL DEFAULT 'free'
        CHECK (plan_tier IN ('free', 'pro', 'agency')),
    billing_customer_id TEXT,
    billing_subscription_id TEXT,
    monthly_submission_limit INT NOT NULL DEFAULT 250
        CHECK (monthly_submission_limit >= 0),
    current_cycle_usage INT NOT NULL DEFAULT 0
        CHECK (current_cycle_usage >= 0),
    cycle_resets_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 month'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    billing_updated_at TIMESTAMPTZ
);

COMMENT ON COLUMN public.profiles.billing_updated_at IS
    'Provider timestamp of the newest billing webhook applied to this profile. Older events are ignored.';

-- Billing webhooks find a profile by provider customer id.
CREATE UNIQUE INDEX idx_profiles_billing_customer_id
    ON public.profiles (billing_customer_id)
    WHERE billing_customer_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 3. Forms
-- ---------------------------------------------------------------------

CREATE TABLE public.forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    target_email TEXT NOT NULL
        CHECK (target_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    allowed_domains TEXT[] NOT NULL DEFAULT '{}'
        CHECK (cardinality(allowed_domains) <= 50), -- e.g. {'example.com','localhost:3000'}
    redirect_url TEXT
        CHECK (redirect_url IS NULL OR redirect_url ~* '^https?://'),
    slack_webhook_url TEXT
        CHECK (slack_webhook_url IS NULL OR slack_webhook_url ~* '^https://'),
    discord_webhook_url TEXT
        CHECK (discord_webhook_url IS NULL OR discord_webhook_url ~* '^https://'),
    enable_turnstile BOOLEAN NOT NULL DEFAULT FALSE,
    turnstile_secret_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT forms_turnstile_requires_secret
        CHECK (NOT enable_turnstile OR turnstile_secret_key IS NOT NULL)
);

CREATE INDEX idx_forms_user_id ON public.forms (user_id);


-- ---------------------------------------------------------------------
-- 4. Submissions (written only by the ingestion Worker via service_role)
-- ---------------------------------------------------------------------

CREATE TABLE public.submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id UUID NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    submitter_ip TEXT,
    user_agent TEXT,
    is_spam BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notify_status TEXT
        CHECK (notify_status IS NULL OR notify_status IN ('pending', 'sent', 'failed', 'skipped_cap', 'skipped_spam')),
    -- Backstop only: the Worker rejects anything above 64 KiB before it gets here.
    CONSTRAINT submissions_payload_size CHECK (octet_length(payload::text) <= 131072)
);

COMMENT ON COLUMN public.submissions.notify_status IS
    'Email outcome: pending (being sent), sent, failed, skipped_cap (daily email budget used up), skipped_spam (flagged as spam).';

-- Per-form submissions log (filter by form, newest first) and the retention sweep.
CREATE INDEX idx_submissions_form_created ON public.submissions (form_id, created_at DESC);
CREATE INDEX idx_submissions_created_at ON public.submissions (created_at DESC);


-- ---------------------------------------------------------------------
-- 5. updated_at triggers
-- ---------------------------------------------------------------------

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_forms_updated_at
    BEFORE UPDATE ON public.forms
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------
-- 6. auth.users -> profiles sync
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, COALESCE(NEW.email, ''))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_user_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.profiles
       SET email = COALESCE(NEW.email, '')
     WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_changed
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.handle_user_email_change();

-- Create profiles for users that already exist when this migration runs.
INSERT INTO public.profiles (id, email)
SELECT u.id, COALESCE(u.email, '')
  FROM auth.users u
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------
-- 7. Privilege-escalation guard on profiles
--
-- The "update own profile" policy alone would let a user run
--   UPDATE profiles SET plan_tier = 'agency', monthly_submission_limit = 999999
-- from the browser. Identity, billing and quota columns may only be changed
-- by trusted roles (service_role, postgres, SECURITY DEFINER functions).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_system_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user IN ('anon', 'authenticated') AND (
           NEW.id                       IS DISTINCT FROM OLD.id
        OR NEW.email                    IS DISTINCT FROM OLD.email
        OR NEW.plan_tier                IS DISTINCT FROM OLD.plan_tier
        OR NEW.billing_customer_id      IS DISTINCT FROM OLD.billing_customer_id
        OR NEW.billing_subscription_id  IS DISTINCT FROM OLD.billing_subscription_id
        OR NEW.billing_updated_at       IS DISTINCT FROM OLD.billing_updated_at
        OR NEW.monthly_submission_limit IS DISTINCT FROM OLD.monthly_submission_limit
        OR NEW.current_cycle_usage      IS DISTINCT FROM OLD.current_cycle_usage
        OR NEW.cycle_resets_at          IS DISTINCT FROM OLD.cycle_resets_at
        OR NEW.created_at               IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'Identity, billing and quota columns are managed by the system'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_protect_system_columns
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_profile_system_columns();


-- ---------------------------------------------------------------------
-- 8. Row Level Security
-- ---------------------------------------------------------------------

ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- profiles: read and update own row (system columns are guarded by the trigger above).
-- No INSERT/DELETE policies: rows are created by the auth trigger and removed by cascade.
CREATE POLICY "Users view own profile" ON public.profiles
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = id);

CREATE POLICY "Users update own profile" ON public.profiles
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = id)
    WITH CHECK ((SELECT auth.uid()) = id);

-- forms: full CRUD on own forms. WITH CHECK prevents re-assigning a form to another user.
CREATE POLICY "Users view own forms" ON public.forms
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users create own forms" ON public.forms
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users update own forms" ON public.forms
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users delete own forms" ON public.forms
    FOR DELETE TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- submissions: owners may read and delete. Inserts happen only via service_role.
CREATE POLICY "Users view submissions for own forms" ON public.submissions
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.forms
         WHERE forms.id = submissions.form_id
           AND forms.user_id = (SELECT auth.uid())
    ));

CREATE POLICY "Users delete submissions for own forms" ON public.submissions
    FOR DELETE TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.forms
         WHERE forms.id = submissions.form_id
           AND forms.user_id = (SELECT auth.uid())
    ));


-- ---------------------------------------------------------------------
-- 9. Table privileges (defence in depth beneath RLS)
-- ---------------------------------------------------------------------

REVOKE ALL ON public.profiles, public.forms, public.submissions FROM anon, authenticated;

GRANT SELECT, UPDATE                 ON public.profiles    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.forms       TO authenticated;
GRANT SELECT, DELETE                 ON public.submissions TO authenticated;

GRANT ALL ON public.profiles, public.forms, public.submissions TO service_role;


-- ---------------------------------------------------------------------
-- 10. Realtime: powers the live submissions table and detail drawer.
-- Realtime evaluates the SELECT policy above, so users only receive
-- events for their own forms' submissions.
-- ---------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
             WHERE pubname = 'supabase_realtime'
               AND schemaname = 'public'
               AND tablename = 'submissions'
       ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions;
    END IF;
END;
$$;
