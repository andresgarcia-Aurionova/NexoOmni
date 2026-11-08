-- Foundation only: these records do not grant tenant access. Existing accounts
-- require an explicit review; no existing session or policy is widened.
CREATE TABLE public.tenant_support_lifecycle (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'review' CHECK (state IN ('review', 'setup', 'delivered')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.tenant_support_lifecycle ENABLE ROW LEVEL SECURITY;
-- Platform routes use service_role; tenants cannot change their lifecycle.

CREATE TABLE public.tenant_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  operator_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 300),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz,
  CHECK (
    (status = 'pending' AND decided_at IS NULL AND expires_at IS NULL)
    OR (status = 'rejected' AND decided_at IS NOT NULL AND expires_at IS NULL)
    OR (status IN ('approved', 'revoked') AND decided_at IS NOT NULL AND expires_at IS NOT NULL)
  )
);

CREATE INDEX tenant_support_requests_account_created_idx
  ON public.tenant_support_requests (account_id, created_at DESC);
CREATE INDEX tenant_support_requests_operator_idx
  ON public.tenant_support_requests (operator_user_id, account_id, expires_at)
  WHERE status = 'approved';

ALTER TABLE public.tenant_support_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_support_requests_admin_select ON public.tenant_support_requests
  FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'admin'));
-- Writes are restricted to service_role and the checked RPCs below.

CREATE FUNCTION public.decide_tenant_support_request(
  p_request_id uuid,
  p_approve boolean,
  p_expires_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.tenant_support_requests%ROWTYPE;
  v_account_name text;
BEGIN
  IF auth.uid() IS NULL OR p_approve IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.tenant_support_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_request.account_id, 'admin') THEN
    RAISE EXCEPTION 'Request not available' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Request already decided' USING ERRCODE = '22023';
  END IF;
  IF p_approve AND (p_expires_at IS NULL OR p_expires_at <= now()) THEN
    RAISE EXCEPTION 'Invalid expiration' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND p_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rejection cannot have an expiration' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tenant_support_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        decided_at = now(), decided_by = auth.uid(),
        expires_at = CASE WHEN p_approve THEN p_expires_at ELSE NULL END
    WHERE id = p_request_id;
  SELECT name INTO STRICT v_account_name FROM public.accounts WHERE id = v_request.account_id;
  INSERT INTO public.platform_commercial_audit(account_id, account_name, actor_user_id, action, details)
    VALUES (v_request.account_id, v_account_name, auth.uid(),
      CASE WHEN p_approve THEN 'tenant_support_approved' ELSE 'tenant_support_rejected' END,
      jsonb_build_object('request_id', p_request_id, 'operator_user_id', v_request.operator_user_id,
                         'expires_at', CASE WHEN p_approve THEN p_expires_at ELSE NULL END));
END;
$$;
REVOKE ALL ON FUNCTION public.decide_tenant_support_request(uuid, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_tenant_support_request(uuid, boolean, timestamptz) TO authenticated;

CREATE FUNCTION public.revoke_tenant_support_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.tenant_support_requests%ROWTYPE;
  v_account_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_request FROM public.tenant_support_requests
    WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_account_member(v_request.account_id, 'admin') THEN
    RAISE EXCEPTION 'Request not available' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'Request is not approved' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tenant_support_requests SET status = 'revoked' WHERE id = p_request_id;
  SELECT name INTO STRICT v_account_name FROM public.accounts WHERE id = v_request.account_id;
  INSERT INTO public.platform_commercial_audit(account_id, account_name, actor_user_id, action, details)
    VALUES (v_request.account_id, v_account_name, auth.uid(), 'tenant_support_revoked',
      jsonb_build_object('request_id', p_request_id, 'operator_user_id', v_request.operator_user_id));
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_tenant_support_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_tenant_support_request(uuid) TO authenticated;
