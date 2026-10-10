-- ==============================================================================
-- MPG REPUTATION — LOCAL DEVELOPMENT SEED SCRIPT
-- ==============================================================================
-- Purpose: Deterministic local development and test bootstrap for clean resets.
-- Characteristics:
--   - Synthetic test data only (Northstar Dental fixtures)
--   - Strictly blocked outside local development environment
--   - Idempotent and deterministic with fixed UUIDs
--   - Provisions local auth user, organization, OWNER membership, and location
-- ==============================================================================

DO $$
BEGIN
    -- Strict safety guard: Only permit execution on local development database
    IF current_setting('app.settings.jwt_secret', true) IS NULL 
       OR current_setting('app.settings.jwt_secret', true) != 'super-secret-jwt-token-with-at-least-32-characters-long' THEN
        RAISE EXCEPTION 'CRITICAL: seed.sql is strictly restricted to local development Supabase environment';
    END IF;
END $$;

BEGIN;

-- 1. Deterministic Synthetic Auth User
-- Email: developer@local.test
-- Password: SafePassword123!
INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    email_change_token_current,
    phone_change,
    phone_change_token,
    reauthentication_token,
    email_change_confirm_status,
    is_sso_user,
    is_anonymous,
    created_at,
    updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000',
    'a0000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'developer@local.test',
    extensions.crypt('SafePassword123!', extensions.gen_salt('bf', 10)),
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"name": "Local Developer", "email_verified": true}'::jsonb,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    false,
    false,
    now(),
    now()
) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    email_confirmed_at = EXCLUDED.email_confirmed_at,
    confirmation_token = EXCLUDED.confirmation_token,
    recovery_token = EXCLUDED.recovery_token;

-- 2. Auth Identity for GoTrue Email Provider (email is GENERATED ALWAYS AS lower(identity_data->>'email'))
INSERT INTO auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
) VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    jsonb_build_object(
        'sub', 'a0000000-0000-0000-0000-000000000001',
        'email', 'developer@local.test',
        'email_verified', true,
        'phone_verified', false
    ),
    'email',
    now(),
    now(),
    now()
) ON CONFLICT (provider, provider_id) DO NOTHING;

-- 3. Synthetic Organization
INSERT INTO public.organizations (
    id,
    name,
    slug,
    country,
    timezone,
    status,
    created_at,
    updated_at
) VALUES (
    'b0000000-0000-0000-0000-000000000001',
    'Northstar Dental (Local Dev)',
    'northstar-dental-local-dev',
    'CA',
    'America/Toronto',
    'ACTIVE',
    now(),
    now()
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    status = EXCLUDED.status;

-- 4. OWNER Membership
INSERT INTO public.organization_users (
    organization_id,
    user_id,
    role,
    created_at,
    updated_at
) VALUES (
    'b0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'OWNER',
    now(),
    now()
) ON CONFLICT (organization_id, user_id) DO UPDATE SET
    role = 'OWNER';

-- 5. Primary Active Location
INSERT INTO public.locations (
    id,
    organization_id,
    name,
    address,
    country,
    timezone,
    status,
    created_at,
    updated_at
) VALUES (
    'c0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'Main Clinic',
    '100 Market Street, Suite 400',
    'CA',
    'America/Toronto',
    'ACTIVE',
    now(),
    now()
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    status = EXCLUDED.status;

-- 6. Confirmed Synthetic Review Destination
INSERT INTO public.review_destinations (
    id,
    organization_id,
    location_id,
    provider,
    url,
    canonical_url,
    status,
    confirmed_by,
    confirmed_at,
    created_at,
    updated_at
) VALUES (
    'd0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'google',
    'https://g.page/r/synthetic-northstar-dev/review',
    'https://g.page/r/synthetic-northstar-dev/review',
    'CONFIRMED',
    'a0000000-0000-0000-0000-000000000001',
    now(),
    now(),
    now()
) ON CONFLICT (id) DO UPDATE SET
    url = EXCLUDED.url,
    canonical_url = EXCLUDED.canonical_url,
    status = EXCLUDED.status;

-- 7. Provision Trial Entitlement (MR-4 standard: 30 requests / 30 days)
SELECT public.provision_organization_trial(
    'b0000000-0000-0000-0000-000000000001'::uuid,
    30,
    30
);

COMMIT;
