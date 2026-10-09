-- Migration: MR-7C.3C External Identifier Erasure Enforcement
-- Description: Updates execute_customer_erasure RPC to erase source_customer_id and
--              source_transaction_id to NULL on customer_completion_events during
--              controlled customer erasure, while retaining source_event_id for deduplication.
-- Owner Decision: RESOLVED. source_customer_id = NULL, source_transaction_id = NULL,
--                 source_event_id = RETAINED. No hashing or pseudonymization.

CREATE OR REPLACE FUNCTION public.execute_customer_erasure(
    p_org_id UUID,
    p_customer_id UUID,
    p_actor_id UUID,
    p_actor_type TEXT DEFAULT 'user'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_role TEXT;
    v_existing_erased_at TIMESTAMPTZ;
    v_completions_count INTEGER := 0;
    v_review_errors_scrubbed_count INTEGER := 0;
    v_message_errors_scrubbed_count INTEGER := 0;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- 1. Input validation
    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'DENIED: Missing required parameters or actor';
    END IF;

    -- 2. Authority verification inside transaction (final authority, immune to TOCTOU)
    SELECT role
    INTO v_actor_role
    FROM public.organization_users
    WHERE organization_id = p_org_id
      AND user_id = p_actor_id;

    IF NOT FOUND OR v_actor_role IS DISTINCT FROM 'OWNER' THEN
        RAISE EXCEPTION 'DENIED: Actor must have active OWNER role in organization';
    END IF;

    -- 3. Lock customer row for update and verify organization ownership
    PERFORM 1
    FROM public.customers
    WHERE id = p_customer_id
      AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
    END IF;

    -- 4. Idempotency check: if customer is already recorded as erased, return existing facts safely
    SELECT erased_at
    INTO v_existing_erased_at
    FROM public.customer_erasure_records
    WHERE organization_id = p_org_id
      AND customer_id = p_customer_id;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'erased', true,
            'already_erased', true,
            'customer_id', p_customer_id,
            'organization_id', p_org_id,
            'erased_at', v_existing_erased_at,
            'completion_events_redacted_count', 0,
            'review_request_errors_scrubbed_count', 0,
            'message_event_errors_scrubbed_count', 0
        );
    END IF;

    -- 5. Mandatory legacy eligibility gate:
    -- Fails closed if any review request lacks immutable recipient evidence in provider-ambiguous states
    IF EXISTS (
        SELECT 1 FROM public.review_requests rr
        WHERE rr.organization_id = p_org_id
          AND rr.customer_id = p_customer_id
          AND NOT EXISTS (
              SELECT 1 FROM public.review_request_recipient_evidence rre
              WHERE rre.organization_id = p_org_id
                AND rre.review_request_id = rr.id
                AND rre.suppression_contact_hash IS NOT NULL
          )
          AND (
              rr.status IN ('SENDING', 'FAILED', 'SENT', 'DELIVERED', 'CLICKED')
              OR rr.sent_at IS NOT NULL
              OR EXISTS (
                  SELECT 1 FROM public.message_events me
                  WHERE me.organization_id = p_org_id
                    AND me.review_request_id = rr.id
              )
          )
    ) THEN
        RAISE EXCEPTION 'BLOCKED_BY_UNRESOLVED_LEGACY_REQUESTS';
    END IF;

    -- 6. Record durable erasure evidence
    INSERT INTO public.customer_erasure_records (
        organization_id,
        customer_id,
        erased_at,
        actor_type,
        actor_id
    ) VALUES (
        p_org_id,
        p_customer_id,
        v_now,
        COALESCE(p_actor_type, 'user'),
        p_actor_id
    );

    -- 7. Anonymize direct customer PII on customers row
    UPDATE public.customers
    SET first_name = '[Deleted Customer]',
        last_name = NULL,
        email = NULL,
        phone = NULL,
        updated_at = v_now
    WHERE id = p_customer_id
      AND organization_id = p_org_id;

    -- 8. Redact direct contact PII and erase external identifiers on customer_completion_events
    -- MR-7C.3C Owner Decision: source_customer_id = NULL, source_transaction_id = NULL,
    -- source_event_id is retained as the deduplication/idempotency key.
    UPDATE public.customer_completion_events
    SET contact = '{}'::jsonb,
        source_customer_id = NULL,
        source_transaction_id = NULL
    WHERE customer_id = p_customer_id
      AND organization_id = p_org_id;

    GET DIAGNOSTICS v_completions_count = ROW_COUNT;

    -- 9. Scrub customer-associated historical error text that could contain PII
    UPDATE public.review_requests
    SET error_message = NULL,
        updated_at = v_now
    WHERE customer_id = p_customer_id
      AND organization_id = p_org_id
      AND error_message IS NOT NULL;

    GET DIAGNOSTICS v_review_errors_scrubbed_count = ROW_COUNT;

    UPDATE public.message_events
    SET sanitized_error = NULL
    WHERE organization_id = p_org_id
      AND sanitized_error IS NOT NULL
      AND review_request_id IN (
          SELECT id FROM public.review_requests
          WHERE customer_id = p_customer_id
            AND organization_id = p_org_id
      );

    GET DIAGNOSTICS v_message_errors_scrubbed_count = ROW_COUNT;

    -- 10. Write mandatory minimized audit event (strictly zero PII, zero hashes, zero error text)
    INSERT INTO public.audit_events (
        organization_id,
        actor_type,
        actor_id,
        event_type,
        entity_type,
        entity_id,
        metadata
    ) VALUES (
        p_org_id,
        COALESCE(p_actor_type, 'user'),
        p_actor_id,
        'privacy.customer_erasure',
        'customer',
        p_customer_id,
        jsonb_build_object(
            'schema_version', '1.0',
            'decision', 'ERASED',
            'fields_anonymized', jsonb_build_array('first_name'),
            'fields_erased', jsonb_build_array('last_name', 'email', 'phone', 'contact', 'error_message', 'sanitized_error', 'source_customer_id', 'source_transaction_id'),
            'completion_events_redacted_count', v_completions_count,
            'review_request_errors_scrubbed_count', v_review_errors_scrubbed_count,
            'message_event_errors_scrubbed_count', v_message_errors_scrubbed_count
        )
    );

    -- 11. Return non-PII operational summary
    RETURN jsonb_build_object(
        'erased', true,
        'already_erased', false,
        'customer_id', p_customer_id,
        'organization_id', p_org_id,
        'erased_at', v_now,
        'completion_events_redacted_count', v_completions_count,
        'review_request_errors_scrubbed_count', v_review_errors_scrubbed_count,
        'message_event_errors_scrubbed_count', v_message_errors_scrubbed_count
    );
END;
$$;

-- Explicitly revoke execute from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.execute_customer_erasure(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
-- Grant execute strictly to service_role
GRANT EXECUTE ON FUNCTION public.execute_customer_erasure(UUID, UUID, UUID, TEXT) TO service_role;
