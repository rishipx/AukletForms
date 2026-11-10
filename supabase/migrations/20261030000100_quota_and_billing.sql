-- =====================================================================
-- Auklet Forms: submission quota and billing webhook idempotency
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Atomic quota consumption (called by the ingestion Worker, service_role only)
--
-- A read-then-write from the Worker would let concurrent submissions
-- overshoot the limit, so the check and the increment are one statement.
-- An expired cycle rolls over inside the same statement: free accounts never
-- receive a billing event, and paid accounts are reset by billing, whichever
-- happens first wins and the other is a harmless no-op.
--
-- Returns TRUE if a slot was consumed, FALSE if the quota is exhausted
-- (or the user does not exist).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.consume_submission_quota(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rows INT;
BEGIN
    UPDATE public.profiles
       SET current_cycle_usage = CASE
               WHEN cycle_resets_at <= NOW() THEN 1
               ELSE current_cycle_usage + 1
           END,
           cycle_resets_at = CASE
               WHEN cycle_resets_at <= NOW() THEN NOW() + INTERVAL '1 month'
               ELSE cycle_resets_at
           END
     WHERE id = p_user_id
       AND monthly_submission_limit > 0
       AND (cycle_resets_at <= NOW() OR current_cycle_usage < monthly_submission_limit);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_submission_quota(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_submission_quota(UUID) TO service_role;


-- ---------------------------------------------------------------------
-- 2. Billing webhook idempotency
--
-- The billing provider delivers webhooks at least once. The handler claims
-- each webhook id here before processing it, so a duplicate delivery is
-- acknowledged without being applied twice. If processing fails, the claim is
-- released so the provider's retry can run the handler again.
--
-- Access: service_role only. There are deliberately no RLS policies, so
-- `anon` and `authenticated` can never read or write this table.
-- ---------------------------------------------------------------------

CREATE TABLE public.billing_events (
    id TEXT PRIMARY KEY,                 -- the webhook-id header of the delivery
    type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_events_processed_at ON public.billing_events (processed_at);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.billing_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_events TO service_role;

COMMENT ON TABLE public.billing_events IS
    'Processed billing webhook ids (idempotency). Rows older than ~30 days can be deleted: retries stop after about a day.';
