-- Migration: MR-7C.5C2 Controlled Restore-Delta Replay Engine (Maintenance Only)
-- Description: Adds narrow, dedicated maintenance RPCs for reapplying post-backup
--              privacy states (erasure tombstones and suppressions) to an isolated
--              restored database during disaster recovery reconciliation (Case A).
-- Security Invariants:
-- 1. SECURITY DEFINER with fixed search_path = public, pg_temp.
-- 2. Execution REVOKED from PUBLIC, anon, and authenticated.
-- 3. Execution GRANTED strictly to service_role (trusted maintenance role).
-- 4. Fixed bounded parameters, strict input validation, tenant isolation.
-- 5. Atomic per-record units; fully idempotent on repeated replay.
-- 6. Zero arbitrary SQL capability.

-- 1. Atomic maintenance RPC for customer erasure replay
CREATE OR REPLACE FUNCTION public.replay_customer_erasure_maintenance(
    p_org_id UUID,
    p_customer_id UUID,
    p_erased_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_erased_at TIMESTAMPTZ;
    v_already_erased BOOLEAN := false;
    v_completions_count INTEGER := 0;
    v_review_errors_scrubbed_count INTEGER := 0;
    v_message_errors_scrubbed_count INTEGER := 0;
BEGIN
    -- 1. Input validation
    IF p_org_id IS NULL OR p_customer_id IS NULL OR p_erased_at IS NULL THEN
        RAISE EXCEPTION 'DENIED: Missing required parameters';
    END IF;

    -- 2. Verify organization and customer existence, lock customer row for update
    PERFORM 1
    FROM public.customers
    WHERE id = p_customer_id
      AND organization_id = p_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
    END IF;

    -- 3. Check existing erasure certificate
    SELECT erased_at
    INTO v_existing_erased_at
    FROM public.customer_erasure_records
    WHERE organization_id = p_org_id
      AND customer_id = p_customer_id;

    IF FOUND THEN
        IF v_existing_erased_at IS DISTINCT FROM p_erased_at THEN
            RAISE EXCEPTION 'ERASURE_CERTIFICATE_MISMATCH';
        END IF;
        v_already_erased := true;
    END IF;

    -- 4. Record durable erasure evidence preserving truthful restore chronology
    -- Unique constraint (organization_id, customer_id) prevents duplication
    INSERT INTO public.customer_erasure_records (
        organization_id,
        customer_id,
        erased_at,
        actor_type,
        actor_id
    ) VALUES (
        p_org_id,
        p_customer_id,
        p_erased_at,
        'maintenance',
        NULL
    )
    ON CONFLICT (organization_id, customer_id) DO NOTHING;

    -- 5. Anonymize direct customer PII on customers row to frozen tombstone invariant
    UPDATE public.customers
    SET first_name = '[Deleted Customer]',
        last_name = NULL,
        email = NULL,
        phone = NULL
    WHERE id = p_customer_id
      AND organization_id = p_org_id;

    -- 6. Redact direct contact PII and erase external identifiers on customer_completion_events
    -- Invariant: source_customer_id = NULL, source_transaction_id = NULL,
    -- source_event_id is retained permanently as deduplication key.
    UPDATE public.customer_completion_events
    SET contact = '{}'::jsonb,
        source_customer_id = NULL,
        source_transaction_id = NULL
    WHERE customer_id = p_customer_id
      AND organization_id = p_org_id;

    GET DIAGNOSTICS v_completions_count = ROW_COUNT;

    -- 7. Scrub customer-associated historical error text on review_requests
    UPDATE public.review_requests
    SET error_message = NULL
    WHERE customer_id = p_customer_id
      AND organization_id = p_org_id
      AND error_message IS NOT NULL;

    GET DIAGNOSTICS v_review_errors_scrubbed_count = ROW_COUNT;

    -- 8. Scrub customer-associated historical error text on message_events
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

    -- 9. Record minimized maintenance audit event only on initial replay
    -- Repeated replays must not create misleading repeated audit evidence
    IF NOT v_already_erased THEN
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
            'maintenance',
            NULL,
            'privacy.restore_replay_erasure',
            'customer',
            p_customer_id,
            jsonb_build_object(
                'schema_version', '1.0',
                'decision', 'REPLAYED',
                'erased_at', p_erased_at,
                'completion_events_redacted_count', v_completions_count,
                'review_request_errors_scrubbed_count', v_review_errors_scrubbed_count,
                'message_event_errors_scrubbed_count', v_message_errors_scrubbed_count
            )
        );
    END IF;

    -- 10. Return minimized non-PII operational summary
    RETURN jsonb_build_object(
        'replayed', true,
        'already_erased', v_already_erased,
        'customer_id', p_customer_id,
        'organization_id', p_org_id,
        'erased_at', COALESCE(v_existing_erased_at, p_erased_at),
        'completion_events_redacted_count', v_completions_count,
        'review_request_errors_scrubbed_count', v_review_errors_scrubbed_count,
        'message_event_errors_scrubbed_count', v_message_errors_scrubbed_count
    );
END;
$$;

-- Revoke execute from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.replay_customer_erasure_maintenance(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
-- Grant execute strictly to service_role
GRANT EXECUTE ON FUNCTION public.replay_customer_erasure_maintenance(UUID, UUID, TIMESTAMPTZ) TO service_role;


-- 2. Atomic maintenance RPC for suppression replay
CREATE OR REPLACE FUNCTION public.replay_suppression_maintenance(
    p_org_id UUID,
    p_channel TEXT,
    p_contact_hash TEXT,
    p_reason TEXT,
    p_created_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inserted_count BIGINT := 0;
BEGIN
    -- 1. Input validation
    IF p_org_id IS NULL OR p_channel IS NULL OR p_contact_hash IS NULL OR p_reason IS NULL OR p_created_at IS NULL THEN
        RAISE EXCEPTION 'DENIED: Missing required parameters';
    END IF;

    IF btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'DENIED: Invalid reason';
    END IF;

    IF p_channel NOT IN ('email', 'sms') THEN
        RAISE EXCEPTION 'DENIED: Invalid channel';
    END IF;

    IF length(p_contact_hash) != 64 OR p_contact_hash !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'DENIED: Invalid contact hash';
    END IF;

    -- 2. Verify organization exists
    PERFORM 1
    FROM public.organizations
    WHERE id = p_org_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND';
    END IF;

    -- 3. Insert suppression with ON CONFLICT DO NOTHING to preserve idempotency
    -- Uniqueness constraint: (organization_id, channel, contact_hash)
    INSERT INTO public.suppressions (
        organization_id,
        channel,
        contact_hash,
        reason,
        created_at
    ) VALUES (
        p_org_id,
        p_channel,
        p_contact_hash,
        p_reason,
        p_created_at
    )
    ON CONFLICT (organization_id, channel, contact_hash) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    -- 4. Return non-PII operational summary (zero contact hashes in return payload)
    RETURN jsonb_build_object(
        'inserted', v_inserted_count > 0,
        'organization_id', p_org_id,
        'channel', p_channel
    );
END;
$$;

-- Revoke execute from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.replay_suppression_maintenance(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
-- Grant execute strictly to service_role
GRANT EXECUTE ON FUNCTION public.replay_suppression_maintenance(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
