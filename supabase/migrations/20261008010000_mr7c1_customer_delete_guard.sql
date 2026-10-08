-- Migration: 20261008010000_mr7c1_customer_delete_guard.sql
-- Description: MR-7C.1 Privacy Lifecycle Direct Delete Safety Guard
-- 1. Drop customers_delete policy to prevent tenant OWNER/ADMIN from hard-deleting customer records
-- 2. Revoke DELETE on public.customers from PUBLIC, anon, authenticated
-- 3. Grant DELETE on public.customers to service_role for future controlled lifecycle orchestration

-- 1. Drop tenant delete policy
DROP POLICY IF EXISTS customers_delete ON public.customers;

-- 2. Revoke direct delete privileges from tenant / public roles
REVOKE DELETE ON public.customers FROM PUBLIC, anon, authenticated;

-- 3. Retain trusted server / service_role capability for future lifecycle orchestration
GRANT DELETE ON public.customers TO service_role;
