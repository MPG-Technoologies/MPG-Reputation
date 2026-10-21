-- MR-5I7: narrow four mutable internal TEST billing tables to row DML.
-- Original additive migrations granted ALL to service_role; that also grants
-- TRUNCATE, REFERENCES and TRIGGER, which the fenced SQL workers do not need.
-- This is repository-only / disposable Supabase engineering: no hosted apply,
-- no new grants to client roles, no RLS bypass and no settlement authority.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.stripe_subscription_reconciliation_leases,
  public.stripe_test_checkout_reservations,
  public.stripe_test_customer_provisioning,
  public.stripe_test_billing_action_limits
  FROM service_role;

-- Fail migration on any unexpected effective privilege inheritance. This
-- catches changing default PUBLIC or schema grants in the actual migrated DB,
-- rather than assuming REVOKE alone proves the intended effective ACL.
DO $mr5i7_acl$
DECLARE
  v_table TEXT;
  v_privilege TEXT;
  v_relation TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'stripe_subscription_reconciliation_leases',
    'stripe_test_checkout_reservations',
    'stripe_test_customer_provisioning',
    'stripe_test_billing_action_limits'
  ] LOOP
    v_relation := pg_catalog.format('public.%I', v_table);
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE'
    ] LOOP
      IF NOT pg_catalog.has_table_privilege('service_role', v_relation, v_privilege) THEN
        RAISE EXCEPTION 'MR5I7_REQUIRED_SERVICE_ROW_PRIVILEGE_MISSING'
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY[
      'TRUNCATE','REFERENCES','TRIGGER'
    ] LOOP
      IF pg_catalog.has_table_privilege('service_role', v_relation, v_privilege) THEN
        RAISE EXCEPTION 'MR5I7_EXCESS_SERVICE_TABLE_PRIVILEGE'
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
    ] LOOP
      IF pg_catalog.has_table_privilege('anon', v_relation, v_privilege)
         OR pg_catalog.has_table_privilege('authenticated', v_relation, v_privilege)
      THEN
        RAISE EXCEPTION 'MR5I7_CLIENT_TABLE_PRIVILEGE_EXPOSED'
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END LOOP;
END;
$mr5i7_acl$;
