-- MR-5C — Billing Environment Isolation
-- Strengthens TEST/LIVE persistence boundaries only.
-- Does not authorize live billing, charging, checkout, portal, entitlement sync, or live messaging.

-- -----------------------------------------------------------------------------
-- Subscription environment
-- -----------------------------------------------------------------------------

ALTER TABLE public.organization_subscriptions
    ADD COLUMN environment TEXT;

-- Preserve the environment of the owning billing account for any existing rows.
UPDATE public.organization_subscriptions AS subscription
SET environment = account.environment
FROM public.organization_billing_accounts AS account
WHERE account.id = subscription.billing_account_id
  AND account.organization_id = subscription.organization_id
  AND account.provider = subscription.provider;

ALTER TABLE public.organization_subscriptions
    ALTER COLUMN environment SET DEFAULT 'TEST',
    ALTER COLUMN environment SET NOT NULL;

ALTER TABLE public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_environment_check
        CHECK (environment IN ('TEST', 'LIVE'));

-- The billing account composite key must include environment so a subscription
-- cannot point across TEST/LIVE boundaries.
ALTER TABLE public.organization_billing_accounts
    ADD CONSTRAINT organization_billing_accounts_id_org_provider_env_key
        UNIQUE (id, organization_id, provider, environment);

ALTER TABLE public.organization_subscriptions
    DROP CONSTRAINT organization_subscriptions_account_org_provider_fkey;

ALTER TABLE public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_account_org_provider_env_fkey
        FOREIGN KEY (billing_account_id, organization_id, provider, environment)
        REFERENCES public.organization_billing_accounts(
            id, organization_id, provider, environment
        )
        ON DELETE CASCADE;

-- Provider object IDs are isolated by Stripe environment.
ALTER TABLE public.organization_subscriptions
    DROP CONSTRAINT organization_subscriptions_provider_subscription_key;

ALTER TABLE public.organization_subscriptions
    ADD CONSTRAINT organization_subscriptions_provider_env_subscription_key
        UNIQUE (provider, environment, provider_subscription_id);

-- -----------------------------------------------------------------------------
-- Webhook event environment
-- -----------------------------------------------------------------------------

-- All billing webhook records created before this migration belong to the
-- pre-live-billing engineering period, so TEST is the safe historical default.
ALTER TABLE public.billing_webhook_events
    ADD COLUMN environment TEXT NOT NULL DEFAULT 'TEST';

ALTER TABLE public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_environment_check
        CHECK (environment IN ('TEST', 'LIVE'));

-- Event IDs are deduplicated within provider environment.
ALTER TABLE public.billing_webhook_events
    DROP CONSTRAINT billing_webhook_events_provider_event_key;

ALTER TABLE public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_provider_env_event_key
        UNIQUE (provider, environment, provider_event_id);
