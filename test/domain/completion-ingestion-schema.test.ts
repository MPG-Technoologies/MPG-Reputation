import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  readFileSync,
} from 'node:fs'

import {
  resolve,
} from 'node:path'

describe(
  'MR-3A completion ingestion migration',
  () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/20260919170000_mr3_completion_ingestion.sql'
      ),
      'utf8'
    )

    it(
      'stores API secret hashes rather than plaintext secrets',
      () => {
        expect(sql).toContain(
          'secret_hash TEXT NOT NULL'
        )

        expect(sql).not.toMatch(
          /\bsecret\s+TEXT\b/
        )
      }
    )

    it(
      'uses database-enforced nonce uniqueness and organization-level serialized rate limiting',
      () => {
        expect(sql).toContain(
          'UNIQUE (credential_id, nonce)'
        )

        expect(sql).toContain(
          'pg_advisory_xact_lock'
        )

        expect(sql).toContain(
          "created_at >= now() - INTERVAL '1 minute'"
        )

        expect(sql).toContain(
          'rate_limit_per_minute'
        )

        expect(sql).toContain(
          'v_request_count >= v_rate_limit'
        )

        expect(sql).not.toContain(
          'p_rate_limit'
        )
      }
    )

    it(
      'preserves tenant audit rows without nulling organization ownership',
      () => {
        expect(sql).toContain(
          'ON DELETE SET NULL (location_id)'
        )

        expect(sql).toContain(
          'ON DELETE SET NULL (completion_event_id)'
        )
      }
    )

    it(
      'keeps public and authenticated roles away from system ingestion RPCs',
      () => {
        expect(sql).toContain(
          'FROM PUBLIC, anon, authenticated'
        )

        expect(sql).toContain(
          'TO service_role'
        )
      }
    )

    it(
      'persists completion plus customer.completed outbox atomically',
      () => {
        expect(sql).toContain(
          'INSERT INTO public.customer_completion_events'
        )

        expect(sql).toContain(
          'INSERT INTO public.domain_event_outbox'
        )

        expect(sql).toContain(
          "'customer.completed'"
        )
      }
    )

    it(
      'serializes duplicate source events before customer mutation',
      () => {
        const lockIndex =
          sql.indexOf(
            'pg_advisory_xact_lock'
          )

        const customerInsertIndex =
          sql.indexOf(
            'INSERT INTO public.customers'
          )

        expect(lockIndex).toBeGreaterThan(
          -1
        )

        expect(
          customerInsertIndex
        ).toBeGreaterThan(lockIndex)

        expect(sql).toContain(
          'source_event_id = v_source_event_id'
        )

        expect(sql).toContain(
          "'duplicate', true"
        )
      }
    )
  }
)
