-- MR-5I11. SYNTHETIC DATA ONLY. Execute exclusively in disposable localhost Postgres.
-- Mimics the observed NON-PII hosted cardinalities: 4 orgs, 3 trial rows, 7 usage rows,
-- zero account/subscription/webhook rows. No auth.users and no real customer data.
BEGIN;
INSERT INTO public.organizations (id, name, slug) VALUES
 ('11111111-1111-4111-8111-111111111111','MR5 synthetic tenant A','mr5-upgrade-synthetic-a'),
 ('22222222-2222-4222-8222-222222222222','MR5 synthetic tenant B','mr5-upgrade-synthetic-b'),
 ('33333333-3333-4333-8333-333333333333','MR5 synthetic tenant C','mr5-upgrade-synthetic-c'),
 ('44444444-4444-4444-8444-444444444444','MR5 synthetic tenant D','mr5-upgrade-synthetic-d');

INSERT INTO public.organization_entitlements
 (organization_id,status,allocated_requests,consumed_requests,duration_days,started_at,expires_at)
VALUES
 ('11111111-1111-4111-8111-111111111111','ACTIVE',30,5,30,'2026-10-01T00:00:00Z','2026-10-31T00:00:00Z'),
 ('22222222-2222-4222-8222-222222222222','ACTIVE',30,0,30,'2026-10-01T00:00:00Z','2026-10-31T00:00:00Z'),
 ('33333333-3333-4333-8333-333333333333','NOT_STARTED',30,0,30,NULL,NULL);

INSERT INTO public.organization_usage (organization_id,period,metric,value) VALUES
 ('11111111-1111-4111-8111-111111111111','2026-10','rehearsal_metric_1',1),
 ('11111111-1111-4111-8111-111111111111','2026-10','rehearsal_metric_2',2),
 ('11111111-1111-4111-8111-111111111111','2026-10','rehearsal_metric_3',3),
 ('22222222-2222-4222-8222-222222222222','2026-10','rehearsal_metric_1',4),
 ('22222222-2222-4222-8222-222222222222','2026-10','rehearsal_metric_2',5),
 ('33333333-3333-4333-8333-333333333333','2026-10','rehearsal_metric_1',6),
 ('44444444-4444-4444-8444-444444444444','2026-10','rehearsal_metric_1',7);
COMMIT;
