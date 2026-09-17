# MPG Reputation — Data Model v0.1

| Metadata | Value |
|---|---|
| Product | MPG Reputation (`PROD-REP-001`) |
| Version | 0.1 |
| Status | IMPLEMENTATION DATA MODEL |
| Date | 2026-09-17 |

## 1. Overview

The MPG Reputation V0.1 data model enforces multi-tenant isolation, idempotency, auditable event tracking, and neutral review delivery.

## 2. Core Tables

### `organizations`
Tenant anchor representing a business.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `name`: TEXT NOT NULL
- `slug`: TEXT NOT NULL UNIQUE
- `country`: VARCHAR(2) NOT NULL DEFAULT 'CA'
- `timezone`: TEXT NOT NULL DEFAULT 'America/Toronto'
- `status`: TEXT NOT NULL DEFAULT 'ACTIVE' -- ACTIVE, INACTIVE, SUSPENDED
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now()

### `organization_users`
Maps Supabase Auth users (`auth.users.id`) to organizations with roles.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `user_id`: UUID NOT NULL
- `role`: TEXT NOT NULL DEFAULT 'OPERATOR' -- OWNER, ADMIN, OPERATOR, VIEWER
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- UNIQUE(`organization_id`, `user_id`)

### `locations`
Physical or operational business locations. Multi-location support is native from V0.1.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `name`: TEXT NOT NULL
- `address`: TEXT
- `country`: VARCHAR(2) NOT NULL DEFAULT 'CA'
- `timezone`: TEXT NOT NULL DEFAULT 'America/Toronto'
- `status`: TEXT NOT NULL DEFAULT 'ACTIVE' -- ACTIVE, INACTIVE
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now()

### `customers`
Minimal customer reference data. No clinical/PHI records.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `location_id`: UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE
- `first_name`: TEXT NOT NULL
- `last_name`: TEXT
- `email`: TEXT
- `phone`: TEXT
- `permission_email`: TEXT NOT NULL DEFAULT 'allowed' -- allowed, unknown, denied
- `permission_sms`: TEXT NOT NULL DEFAULT 'unknown'
- `permission_source`: TEXT NOT NULL DEFAULT 'quick_complete'
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now()

### `customer_completion_events`
Canonical completion event record. Concurrency and idempotency control point.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `location_id`: UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE
- `customer_id`: UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE
- `source`: TEXT NOT NULL -- 'quick_complete'
- `source_event_id`: TEXT NOT NULL
- `source_customer_id`: TEXT
- `source_transaction_id`: TEXT
- `completed_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- `country`: VARCHAR(2) NOT NULL DEFAULT 'CA'
- `contact`: JSONB NOT NULL DEFAULT '{}'::jsonb
- `permission`: JSONB NOT NULL DEFAULT '{}'::jsonb
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- UNIQUE(`organization_id`, `source`, `source_event_id`)

### `review_destinations`
Validated, confirmed review destination URLs (Google in V0.1).
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `location_id`: UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE
- `provider`: TEXT NOT NULL DEFAULT 'google' -- 'google'
- `url`: TEXT NOT NULL
- `canonical_url`: TEXT NOT NULL
- `status`: TEXT NOT NULL DEFAULT 'CONFIRMED' -- PENDING_CONFIRMATION, CONFIRMED, INACTIVE
- `confirmed_by`: UUID
- `confirmed_at`: TIMESTAMPTZ
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- UNIQUE(`location_id`, `provider`)

### `review_requests`
Review solicitation records and lifecycle state machine.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `location_id`: UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE
- `customer_id`: UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE
- `completion_event_id`: UUID NOT NULL REFERENCES customer_completion_events(id) ON DELETE CASCADE
- `destination_id`: UUID REFERENCES review_destinations(id) ON DELETE SET NULL
- `channel`: TEXT NOT NULL DEFAULT 'email' -- email, sms (future)
- `status`: TEXT NOT NULL DEFAULT 'SCHEDULED' -- SCHEDULED, SENDING, SENT, DELIVERED, CLICKED, FAILED, CANCELLED, SUPPRESSED
- `token`: TEXT NOT NULL UNIQUE
- `token_hash`: TEXT NOT NULL
- `scheduled_for`: TIMESTAMPTZ NOT NULL DEFAULT now()
- `sent_at`: TIMESTAMPTZ
- `clicked_at`: TIMESTAMPTZ
- `cancelled_at`: TIMESTAMPTZ
- `failed_at`: TIMESTAMPTZ
- `error_message`: TEXT
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- UNIQUE(`completion_event_id`, `channel`)

### `review_request_events`
Append-only log of review request lifecycle transitions.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `review_request_id`: UUID NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE
- `event_type`: TEXT NOT NULL -- created, scheduled, sent, clicked, failed, cancelled
- `idempotency_key`: TEXT
- `metadata`: JSONB NOT NULL DEFAULT '{}'::jsonb
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()

### `message_events`
Outbound message attempts and provider telemetry.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `review_request_id`: UUID NOT NULL REFERENCES review_requests(id) ON DELETE CASCADE
- `provider`: TEXT NOT NULL -- 'console', 'resend'
- `provider_message_id`: TEXT
- `event_type`: TEXT NOT NULL -- sent, delivered, bounced, failed
- `status`: TEXT NOT NULL
- `sanitized_error`: TEXT
- `metadata`: JSONB NOT NULL DEFAULT '{}'::jsonb
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()

### `suppressions`
Opt-outs and suppressions per organization / contact channel.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `channel`: TEXT NOT NULL -- 'email'
- `contact_hash`: TEXT NOT NULL
- `reason`: TEXT NOT NULL DEFAULT 'UNSUBSCRIBE'
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- UNIQUE(`organization_id`, `channel`, `contact_hash`)

### `organization_usage`
Rollup counters for period-based tracking.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `period`: TEXT NOT NULL -- '2026-09' or 'lifetime'
- `metric`: TEXT NOT NULL -- 'completed_customers', 'review_requests_sent', 'link_clicks', etc.
- `value`: BIGINT NOT NULL DEFAULT 0
- `updated_at`: TIMESTAMPTZ NOT NULL DEFAULT now()
- UNIQUE(`organization_id`, `period`, `metric`)

### `audit_events`
Append-only domain and security audit trail.
- `id`: UUID (PK, default `gen_random_uuid()`)
- `organization_id`: UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
- `actor_type`: TEXT NOT NULL -- 'user', 'system', 'api'
- `actor_id`: UUID
- `event_type`: TEXT NOT NULL -- organization.created, location.created, customer.completed, etc.
- `entity_type`: TEXT NOT NULL
- `entity_id`: UUID NOT NULL
- `metadata`: JSONB NOT NULL DEFAULT '{}'::jsonb
- `created_at`: TIMESTAMPTZ NOT NULL DEFAULT now()

## 3. RLS Strategy

Row Level Security is enabled on all tables exposed to the Data API.
Users access data via helper function:
```sql
CREATE OR REPLACE FUNCTION auth_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id 
  FROM organization_users 
  WHERE user_id = auth.uid();
$$;
```

Policies verify `organization_id IN (SELECT auth_user_org_ids())`.
