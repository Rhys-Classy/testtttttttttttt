-- =====================================================================
-- Security layer: runtime role, tenant context, row level security,
-- cross-business referential integrity and narrowly scoped helper
-- functions for pre-auth / worker / public lookups.
--
-- Model
--   * Migrations run as the admin/owner role (DATABASE_ADMIN_URL).
--   * The app runs as `bos_app` (DATABASE_URL): not a superuser, no BYPASSRLS,
--     does not own any table, so every query is filtered by RLS. Table owners
--     bypass RLS on purpose so the SECURITY DEFINER entry points below work.
--   * Each request runs in a transaction that sets:
--        app.user_id          current user (uuid) or ''
--        app.actor            'user' | 'system' | 'public'
--        app.sub_account_ids  comma separated business ids the request asked for
--     RLS only exposes rows whose sub_account_id is BOTH requested AND
--     accessible to the user (membership is checked in the database, not
--     trusted from the app). System/public contexts are pinned to exactly
--     one business.
-- =====================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bos_app') THEN
    CREATE ROLE bos_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Context helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.actor() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.actor', true), ''), 'user')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.requested_sub_account_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.sub_account_ids', true), ''), ',')::uuid[], '{}'::uuid[])
$$;
--> statement-breakpoint

-- Accounts the current user belongs to.
CREATE OR REPLACE FUNCTION app.my_account_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(account_id), '{}'::uuid[])
  FROM account_members WHERE user_id = app.current_user_id()
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.my_admin_account_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(account_id), '{}'::uuid[])
  FROM account_members WHERE user_id = app.current_user_id() AND role IN ('owner', 'admin')
$$;
--> statement-breakpoint

-- Every business the current user may open, regardless of which one is selected.
-- System/public contexts are pinned to exactly one requested business.
CREATE OR REPLACE FUNCTION app.accessible_sub_account_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor text := app.actor();
  v_requested uuid[] := app.requested_sub_account_ids();
  v_uid uuid := app.current_user_id();
BEGIN
  IF v_actor IN ('system', 'public') THEN
    IF coalesce(array_length(v_requested, 1), 0) = 1 THEN
      RETURN v_requested;
    END IF;
    RETURN '{}'::uuid[];
  END IF;
  IF v_uid IS NULL THEN
    RETURN '{}'::uuid[];
  END IF;
  RETURN coalesce((
    SELECT array_agg(s.id) FROM sub_accounts s
    WHERE EXISTS (SELECT 1 FROM account_members am
                  WHERE am.account_id = s.account_id AND am.user_id = v_uid AND am.role IN ('owner', 'admin'))
       OR EXISTS (SELECT 1 FROM sub_account_members sm
                  WHERE sm.sub_account_id = s.id AND sm.user_id = v_uid)
  ), '{}'::uuid[]);
END $$;
--> statement-breakpoint

-- Businesses visible to THIS request: requested ∩ accessible. Empty = fail closed.
CREATE OR REPLACE FUNCTION app.visible_sub_account_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(x), '{}'::uuid[])
  FROM unnest(app.requested_sub_account_ids()) AS x
  WHERE x = ANY (app.accessible_sub_account_ids())
$$;
--> statement-breakpoint

-- Visible businesses where the user may write (viewer memberships are read-only).
CREATE OR REPLACE FUNCTION app.writable_sub_account_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := app.current_user_id();
BEGIN
  IF app.actor() IN ('system', 'public') THEN
    RETURN app.visible_sub_account_ids();
  END IF;
  RETURN coalesce((
    SELECT array_agg(s.id) FROM sub_accounts s
    WHERE s.id = ANY (app.visible_sub_account_ids())
      AND (
        EXISTS (SELECT 1 FROM account_members am
                WHERE am.account_id = s.account_id AND am.user_id = v_uid AND am.role IN ('owner', 'admin'))
        OR EXISTS (SELECT 1 FROM sub_account_members sm
                   WHERE sm.sub_account_id = s.id AND sm.user_id = v_uid AND sm.role IN ('admin', 'staff'))
      )
  ), '{}'::uuid[]);
END $$;
--> statement-breakpoint

-- Businesses whose settings/integrations/team the user may administer.
CREATE OR REPLACE FUNCTION app.admin_sub_account_ids() RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := app.current_user_id();
BEGIN
  IF app.actor() IN ('system', 'public') THEN
    RETURN app.visible_sub_account_ids();
  END IF;
  RETURN coalesce((
    SELECT array_agg(s.id) FROM sub_accounts s
    WHERE EXISTS (SELECT 1 FROM account_members am
                  WHERE am.account_id = s.account_id AND am.user_id = v_uid AND am.role IN ('owner', 'admin'))
       OR EXISTS (SELECT 1 FROM sub_account_members sm
                  WHERE sm.sub_account_id = s.id AND sm.user_id = v_uid AND sm.role = 'admin')
  ), '{}'::uuid[]);
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Integration ownership is explicit: global rows have no business,
-- business rows must have one.
-- ---------------------------------------------------------------------
ALTER TABLE integrations ADD CONSTRAINT integrations_scope_ck CHECK (
  (scope = 'global' AND sub_account_id IS NULL) OR
  (scope = 'sub_account' AND sub_account_id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sub_accounts_account_id_uq ON sub_accounts (account_id, id);
--> statement-breakpoint
ALTER TABLE integrations ADD CONSTRAINT integrations_sub_account_same_account_fk
  FOREIGN KEY (account_id, sub_account_id) REFERENCES sub_accounts (account_id, id) ON DELETE CASCADE;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Cross-business referential integrity.
-- Every reference between business-owned rows is a composite FK on
-- (sub_account_id, x_id), so a Classy Kitchen Facelifts invoice can never
-- reference a Classy Clothing Co contact, even through a bug.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.tenant_fk(child text, col text, parent text, on_delete text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  action text := CASE on_delete
    WHEN 'set null' THEN format('ON DELETE SET NULL (%I)', col)
    WHEN 'cascade' THEN 'ON DELETE CASCADE'
    ELSE 'ON DELETE NO ACTION' END;
BEGIN
  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (sub_account_id, %I) REFERENCES %I (sub_account_id, id) %s',
    child, child || '_' || col || '_tenant_fk', col, parent, action);
END $$;
--> statement-breakpoint
SELECT pg_temp.tenant_fk(c, col, p, a) FROM (VALUES
  ('contacts', 'company_id', 'companies', 'set null'),
  ('notes', 'contact_id', 'contacts', 'cascade'),
  ('activities', 'contact_id', 'contacts', 'cascade'),
  ('leads', 'contact_id', 'contacts', 'cascade'),
  ('leads', 'deal_id', 'deals', 'set null'),
  ('leads', 'form_submission_id', 'form_submissions', 'set null'),
  ('pipeline_stages', 'pipeline_id', 'pipelines', 'cascade'),
  ('deals', 'pipeline_id', 'pipelines', 'restrict'),
  ('deals', 'stage_id', 'pipeline_stages', 'restrict'),
  ('deals', 'contact_id', 'contacts', 'set null'),
  ('deals', 'company_id', 'companies', 'set null'),
  ('quotes', 'contact_id', 'contacts', 'restrict'),
  ('quotes', 'company_id', 'companies', 'set null'),
  ('quotes', 'deal_id', 'deals', 'set null'),
  ('quotes', 'job_id', 'jobs', 'set null'),
  ('quotes', 'invoice_id', 'invoices', 'set null'),
  ('quote_line_items', 'quote_id', 'quotes', 'cascade'),
  ('quote_line_items', 'product_id', 'products', 'set null'),
  ('invoices', 'contact_id', 'contacts', 'restrict'),
  ('invoices', 'company_id', 'companies', 'set null'),
  ('invoices', 'deal_id', 'deals', 'set null'),
  ('invoices', 'quote_id', 'quotes', 'set null'),
  ('invoices', 'job_id', 'jobs', 'set null'),
  ('invoices', 'order_id', 'orders', 'set null'),
  ('invoice_line_items', 'invoice_id', 'invoices', 'cascade'),
  ('invoice_line_items', 'product_id', 'products', 'set null'),
  ('payments', 'invoice_id', 'invoices', 'restrict'),
  ('payments', 'contact_id', 'contacts', 'restrict'),
  ('orders', 'contact_id', 'contacts', 'set null'),
  ('tasks', 'contact_id', 'contacts', 'set null'),
  ('tasks', 'deal_id', 'deals', 'set null'),
  ('tasks', 'job_id', 'jobs', 'set null'),
  ('tasks', 'invoice_id', 'invoices', 'set null'),
  ('appointments', 'contact_id', 'contacts', 'set null'),
  ('appointments', 'deal_id', 'deals', 'set null'),
  ('appointments', 'job_id', 'jobs', 'set null'),
  ('appointments', 'staff_id', 'staff_members', 'set null'),
  ('jobs', 'contact_id', 'contacts', 'set null'),
  ('jobs', 'company_id', 'companies', 'set null'),
  ('jobs', 'deal_id', 'deals', 'set null'),
  ('jobs', 'quote_id', 'quotes', 'set null'),
  ('documents', 'contact_id', 'contacts', 'set null'),
  ('conversations', 'contact_id', 'contacts', 'set null'),
  ('messages', 'conversation_id', 'conversations', 'cascade'),
  ('messages', 'contact_id', 'contacts', 'set null'),
  ('campaign_recipients', 'campaign_id', 'campaigns', 'cascade'),
  ('campaign_recipients', 'contact_id', 'contacts', 'cascade'),
  ('form_submissions', 'form_id', 'forms', 'cascade'),
  ('form_submissions', 'contact_id', 'contacts', 'set null'),
  ('workflow_runs', 'workflow_id', 'workflows', 'cascade'),
  ('workflow_runs', 'contact_id', 'contacts', 'cascade')
) AS v(c, col, p, a);
--> statement-breakpoint

-- User references (assignees/owners) point at real users.
ALTER TABLE contacts ADD CONSTRAINT contacts_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_assigned_user_fk FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE deals ADD CONSTRAINT deals_assigned_user_fk FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_user_fk FOREIGN KEY (assignee_user_id) REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_assigned_user_fk FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_assigned_user_fk FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE conversations ADD CONSTRAINT conversations_assigned_user_fk FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE notifications ADD CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
--> statement-breakpoint

-- Search indexes
CREATE INDEX contacts_search_trgm ON contacts USING gin ((first_name || ' ' || last_name || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX companies_search_trgm ON companies USING gin (name gin_trgm_ops);
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Row level security: business-owned tables
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activities', 'companies', 'contacts', 'custom_field_definitions', 'deals', 'leads', 'notes',
    'pipeline_stages', 'pipelines', 'staff_members', 'invoice_line_items', 'invoices', 'orders',
    'payments', 'products', 'quote_line_items', 'quotes', 'webhook_events', 'appointments',
    'documents', 'jobs', 'tasks', 'audit_log', 'campaign_recipients', 'campaigns', 'conversations',
    'events', 'form_submissions', 'forms', 'landing_pages', 'message_templates', 'messages',
    'notifications', 'workflow_runs', 'workflows'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- Permissive: only rows from businesses visible to this request.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (sub_account_id = ANY ((SELECT app.visible_sub_account_ids())::uuid[])) '
      'WITH CHECK (sub_account_id = ANY ((SELECT app.visible_sub_account_ids())::uuid[]))', t);
    -- Restrictive: writes need a writable (non-viewer) membership.
    EXECUTE format(
      'CREATE POLICY tenant_write_insert ON %I AS RESTRICTIVE FOR INSERT '
      'WITH CHECK (sub_account_id = ANY ((SELECT app.writable_sub_account_ids())::uuid[]))', t);
    EXECUTE format(
      'CREATE POLICY tenant_write_update ON %I AS RESTRICTIVE FOR UPDATE '
      'USING (sub_account_id = ANY ((SELECT app.writable_sub_account_ids())::uuid[]))', t);
    EXECUTE format(
      'CREATE POLICY tenant_write_delete ON %I AS RESTRICTIVE FOR DELETE '
      'USING (sub_account_id = ANY ((SELECT app.writable_sub_account_ids())::uuid[]))', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Row level security: platform tables
-- ---------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_select ON users FOR SELECT USING (
  id = (SELECT app.current_user_id())
  OR id IN (SELECT am.user_id FROM account_members am WHERE am.account_id = ANY ((SELECT app.my_account_ids())::uuid[]))
);
--> statement-breakpoint
CREATE POLICY users_update_self ON users FOR UPDATE USING (id = (SELECT app.current_user_id()));
--> statement-breakpoint
CREATE POLICY users_insert_by_admin ON users FOR INSERT WITH CHECK (coalesce(array_length((SELECT app.my_admin_account_ids()), 1), 0) > 0);
--> statement-breakpoint

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sessions_own ON sessions USING (user_id = (SELECT app.current_user_id())) WITH CHECK (user_id = (SELECT app.current_user_id()));
--> statement-breakpoint

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY accounts_select ON accounts FOR SELECT USING (id = ANY ((SELECT app.my_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY accounts_update ON accounts FOR UPDATE USING (id = ANY ((SELECT app.my_admin_account_ids())::uuid[]));
--> statement-breakpoint

ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY account_members_select ON account_members FOR SELECT USING (account_id = ANY ((SELECT app.my_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY account_members_write ON account_members FOR ALL
  USING (account_id = ANY ((SELECT app.my_admin_account_ids())::uuid[]))
  WITH CHECK (account_id = ANY ((SELECT app.my_admin_account_ids())::uuid[]));
--> statement-breakpoint

ALTER TABLE sub_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Account admins see every business in their account (this also lets INSERT ... RETURNING see a brand new business).
CREATE POLICY sub_accounts_select ON sub_accounts FOR SELECT USING (
  id = ANY ((SELECT app.accessible_sub_account_ids())::uuid[])
  OR account_id = ANY ((SELECT app.my_admin_account_ids())::uuid[])
);
--> statement-breakpoint
CREATE POLICY sub_accounts_insert ON sub_accounts FOR INSERT WITH CHECK (account_id = ANY ((SELECT app.my_admin_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY sub_accounts_update ON sub_accounts FOR UPDATE
  USING (id = ANY ((SELECT app.admin_sub_account_ids())::uuid[]) AND id = ANY ((SELECT app.visible_sub_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY sub_accounts_delete ON sub_accounts FOR DELETE USING (account_id = ANY ((SELECT app.my_admin_account_ids())::uuid[]));
--> statement-breakpoint

ALTER TABLE sub_account_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sub_account_members_select ON sub_account_members FOR SELECT
  USING (sub_account_id = ANY ((SELECT app.accessible_sub_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY sub_account_members_write ON sub_account_members FOR ALL
  USING (sub_account_id = ANY ((SELECT app.admin_sub_account_ids())::uuid[]))
  WITH CHECK (sub_account_id = ANY ((SELECT app.admin_sub_account_ids())::uuid[]));
--> statement-breakpoint

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integrations_sub_account ON integrations
  USING (scope = 'sub_account' AND sub_account_id = ANY ((SELECT app.visible_sub_account_ids())::uuid[]))
  WITH CHECK (scope = 'sub_account' AND sub_account_id = ANY ((SELECT app.admin_sub_account_ids())::uuid[])
              AND sub_account_id = ANY ((SELECT app.visible_sub_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY integrations_global ON integrations
  USING (scope = 'global' AND account_id = ANY ((SELECT app.my_account_ids())::uuid[]))
  WITH CHECK (scope = 'global' AND account_id = ANY ((SELECT app.my_admin_account_ids())::uuid[]));
--> statement-breakpoint

ALTER TABLE user_notification_prefs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_notification_prefs_own ON user_notification_prefs
  USING (user_id = (SELECT app.current_user_id())) WITH CHECK (user_id = (SELECT app.current_user_id()));
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Narrow SECURITY DEFINER entry points. Each returns the minimum needed
-- to establish a context; all further reads go through RLS.
-- ---------------------------------------------------------------------

-- Login: find a user by email (pre-auth).
CREATE OR REPLACE FUNCTION app.auth_find_user(p_email text)
RETURNS TABLE (id uuid, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.password_hash FROM users u WHERE lower(u.email) = lower(p_email) LIMIT 1
$$;
--> statement-breakpoint

-- Session cookie -> user.
CREATE OR REPLACE FUNCTION app.auth_session(p_token_hash text)
RETURNS TABLE (session_id uuid, user_id uuid, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.user_id, s.expires_at FROM sessions s
  WHERE s.token_hash = p_token_hash AND s.expires_at > now() LIMIT 1
$$;
--> statement-breakpoint

-- Public links (invoice/quote/form/landing page) -> owning business.
CREATE OR REPLACE FUNCTION app.resolve_public(p_kind text, p_token text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 THEN RETURN NULL; END IF;
  RETURN CASE p_kind
    WHEN 'invoice' THEN (SELECT sub_account_id FROM invoices WHERE public_token = p_token)
    WHEN 'quote' THEN (SELECT sub_account_id FROM quotes WHERE public_token = p_token)
    WHEN 'form' THEN (SELECT sub_account_id FROM forms WHERE public_id = p_token AND status = 'published')
    WHEN 'landing_page' THEN (SELECT sub_account_id FROM landing_pages WHERE public_id = p_token AND published)
    ELSE NULL END;
END $$;
--> statement-breakpoint

-- Provider webhooks arrive at /api/webhooks/<provider>/<integration id>.
CREATE OR REPLACE FUNCTION app.resolve_integration(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT sub_account_id FROM integrations WHERE id = p_id AND scope = 'sub_account'
$$;
--> statement-breakpoint

-- Inbound SMS/email matched by the receiving number/address.
CREATE OR REPLACE FUNCTION app.resolve_integration_by_address(p_provider text, p_address text) RETURNS TABLE (integration_id uuid, sub_account_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, sub_account_id FROM integrations
  WHERE provider = p_provider AND scope = 'sub_account' AND status = 'connected'
    AND (config ->> 'fromNumber' = p_address OR config ->> 'fromAddress' = p_address)
  LIMIT 1
$$;
--> statement-breakpoint

-- Worker: which businesses exist (for periodic sweeps).
CREATE OR REPLACE FUNCTION app.active_sub_account_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(id), '{}'::uuid[]) FROM sub_accounts WHERE archived_at IS NULL
$$;
--> statement-breakpoint

-- Worker: claim outbox events across businesses. Processing happens per business under RLS.
CREATE OR REPLACE FUNCTION app.claim_events(p_limit int, p_lock_seconds int)
RETURNS TABLE (seq bigint, sub_account_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE events e SET locked_until = now() + make_interval(secs => p_lock_seconds), attempts = e.attempts + 1
  WHERE e.seq IN (
    SELECT seq FROM events
    WHERE processed_at IS NULL AND attempts < 5 AND (locked_until IS NULL OR locked_until < now())
    ORDER BY seq LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  RETURNING e.seq, e.sub_account_id
$$;
--> statement-breakpoint

-- Worker: claim workflow runs whose wait has elapsed.
CREATE OR REPLACE FUNCTION app.claim_workflow_runs(p_limit int, p_lock_seconds int)
RETURNS TABLE (id uuid, sub_account_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE workflow_runs r SET locked_until = now() + make_interval(secs => p_lock_seconds)
  WHERE r.id IN (
    SELECT id FROM workflow_runs
    WHERE status IN ('running', 'waiting') AND coalesce(next_run_at, now()) <= now()
      AND (locked_until IS NULL OR locked_until < now())
    ORDER BY next_run_at NULLS FIRST LIMIT p_limit FOR UPDATE SKIP LOCKED
  )
  RETURNING r.id, r.sub_account_id
$$;
--> statement-breakpoint

-- Gap-free-ish document numbering without granting staff UPDATE on sub_accounts.
CREATE OR REPLACE FUNCTION app.next_number(p_sub_account_id uuid, p_kind text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_result text;
BEGIN
  IF NOT (p_sub_account_id = ANY (app.writable_sub_account_ids())) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'invoice' THEN
    UPDATE sub_accounts SET next_invoice_number = next_invoice_number + 1 WHERE id = p_sub_account_id
      RETURNING invoice_prefix || (next_invoice_number - 1)::text INTO v_result;
  ELSIF p_kind = 'quote' THEN
    UPDATE sub_accounts SET next_quote_number = next_quote_number + 1 WHERE id = p_sub_account_id
      RETURNING quote_prefix || (next_quote_number - 1)::text INTO v_result;
  ELSIF p_kind = 'job' THEN
    UPDATE sub_accounts SET next_job_number = next_job_number + 1 WHERE id = p_sub_account_id
      RETURNING job_prefix || (next_job_number - 1)::text INTO v_result;
  ELSIF p_kind = 'order' THEN
    UPDATE sub_accounts SET next_order_number = next_order_number + 1 WHERE id = p_sub_account_id
      RETURNING order_prefix || (next_order_number - 1)::text INTO v_result;
  ELSE
    RAISE EXCEPTION 'unknown number kind %', p_kind;
  END IF;
  RETURN v_result;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Privileges for the runtime role
-- ---------------------------------------------------------------------
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO bos_app;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO bos_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO bos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bos_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bos_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bos_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bos_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO bos_app;
