-- MR-6A: explicit support authorization supplements existing tenant membership.
-- No business-role changes, membership provisioning or existing-policy changes.
CREATE TABLE public.support_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    user_id UUID NOT NULL,
    support_role TEXT NOT NULL CHECK (support_role = 'MPG_ADMIN'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    UNIQUE (organization_id, user_id),
    CONSTRAINT support_access_grants_membership_fkey
        FOREIGN KEY (organization_id, user_id)
        REFERENCES public.organization_users (organization_id, user_id)
        ON DELETE CASCADE
);

CREATE INDEX support_access_grants_user_id_idx
    ON public.support_access_grants (user_id);

ALTER TABLE public.support_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_access_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.support_access_grants TO authenticated;
GRANT ALL ON TABLE public.support_access_grants TO service_role;

CREATE POLICY support_access_grants_select_own_valid
    ON public.support_access_grants FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        AND support_role = 'MPG_ADMIN'
        AND revoked_at IS NULL
        AND expires_at > now()
        AND public.user_has_role(
            organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']
        )
    );
