-- Run only against an isolated development database after migration 175.
-- All fixtures are rolled back.
BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000101', 'support-test-owner@example.invalid', '{"platform_provisioned":true}'),
  ('00000000-0000-0000-0000-000000000102', 'support-test-agent@example.invalid', '{"platform_provisioned":true}'),
  ('00000000-0000-0000-0000-000000000103', 'support-test-outsider@example.invalid', '{"platform_provisioned":true}'),
  ('00000000-0000-0000-0000-000000000104', 'support-test-operator@example.invalid', '{"platform_provisioned":true}'),
  ('00000000-0000-0000-0000-000000000105', 'support-test-admin@example.invalid', '{"platform_provisioned":true}');
INSERT INTO public.accounts (id, name, owner_user_id)
VALUES ('00000000-0000-0000-0000-000000000201', 'Support test', '00000000-0000-0000-0000-000000000101');
INSERT INTO public.account_subscriptions (account_id, seat_limit)
VALUES ('00000000-0000-0000-0000-000000000201', 3);
INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
VALUES
  ('00000000-0000-0000-0000-000000000101', 'Owner', 'support-test-owner@example.invalid', '00000000-0000-0000-0000-000000000201', 'owner'),
  ('00000000-0000-0000-0000-000000000102', 'Agent', 'support-test-agent@example.invalid', '00000000-0000-0000-0000-000000000201', 'agent'),
  ('00000000-0000-0000-0000-000000000105', 'Admin', 'support-test-admin@example.invalid', '00000000-0000-0000-0000-000000000201', 'admin');
INSERT INTO public.tenant_support_requests (id, account_id, operator_user_id, reason)
VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201',
   '00000000-0000-0000-0000-000000000104', 'Test support'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201',
   '00000000-0000-0000-0000-000000000104', 'Second support request');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_support_requests) THEN
    RAISE EXCEPTION 'Agent can see support requests';
  END IF;
  BEGIN
    PERFORM public.decide_tenant_support_request('00000000-0000-0000-0000-000000000301', true, now() + interval '1 hour');
    RAISE EXCEPTION 'Agent could approve a support request';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_support_requests) THEN
    RAISE EXCEPTION 'Outsider can see support requests';
  END IF;
  BEGIN
    PERFORM public.decide_tenant_support_request('00000000-0000-0000-0000-000000000301', true, now() + interval '1 hour');
    RAISE EXCEPTION 'Outsider could approve a support request';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.tenant_support_requests) <> 2 THEN
    RAISE EXCEPTION 'Owner cannot see the request';
  END IF;
  BEGIN
    INSERT INTO public.tenant_support_requests (account_id, operator_user_id, reason)
    VALUES ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000104', 'Direct insert');
    RAISE EXCEPTION 'Owner could insert a request directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.decide_tenant_support_request('00000000-0000-0000-0000-000000000301', true, now() - interval '1 second');
    RAISE EXCEPTION 'Past expiration accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.decide_tenant_support_request('00000000-0000-0000-0000-000000000301', true, now() + interval '1 hour');
  BEGIN
    PERFORM public.decide_tenant_support_request('00000000-0000-0000-0000-000000000301', true, now() + interval '2 hours');
    RAISE EXCEPTION 'Already decided request accepted again';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.revoke_tenant_support_request('00000000-0000-0000-0000-000000000301');
END $$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000105', true);
DO $$
BEGIN
  PERFORM public.decide_tenant_support_request('00000000-0000-0000-0000-000000000302', false, NULL);
END $$;

RESET ROLE;
DO $$
BEGIN
  IF (SELECT status FROM public.tenant_support_requests WHERE id = '00000000-0000-0000-0000-000000000301') <> 'revoked' THEN
    RAISE EXCEPTION 'Revocation was not saved';
  END IF;
  IF (SELECT count(*) FROM public.platform_commercial_audit
      WHERE details->>'request_id' = '00000000-0000-0000-0000-000000000301'
        AND action IN ('tenant_support_approved', 'tenant_support_revoked')) <> 2 THEN
    RAISE EXCEPTION 'Audit entries were not saved';
  END IF;
  IF (SELECT status FROM public.tenant_support_requests WHERE id = '00000000-0000-0000-0000-000000000302') <> 'rejected' THEN
    RAISE EXCEPTION 'Rejection was not saved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_commercial_audit
                 WHERE details->>'request_id' = '00000000-0000-0000-0000-000000000302'
                   AND action = 'tenant_support_rejected') THEN
    RAISE EXCEPTION 'Rejection was not audited';
  END IF;
END $$;
ROLLBACK;
