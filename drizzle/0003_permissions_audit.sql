-- =====================================================================
-- Roles & permissions, audit log, MFA/session helpers, API keys.
--
-- Access model (all enforced here, in Postgres):
--   account owner            → every permission in every business
--   member + all-businesses  → that role in every business (incl. new ones)
--   member + business role   → that role in that business (overrides the above)
--
-- A role is a list of permission keys (src/lib/permissions.ts) plus a data
-- scope: 'all' or 'assigned' (only customers/jobs/tasks/appointments assigned
-- to the person). Reads are filtered by per-table SELECT policies; writes
-- need the table's edit permission. Application writes go through
-- app.has_permission() first and then run pinned to one business.
-- =====================================================================

-- Start from a clean slate of policies; everything is recreated below.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS app.writable_sub_account_ids();
--> statement-breakpoint
DROP FUNCTION IF EXISTS app.admin_sub_account_ids();
--> statement-breakpoint
DROP FUNCTION IF EXISTS app.my_admin_account_ids();
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Grants: what the current user may do, per business
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.my_owner_account_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(account_id), '{}'::uuid[])
  FROM account_members WHERE user_id = app.current_user_id() AND role = 'owner'
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.my_grants()
RETURNS TABLE (sub_account_id uuid, permissions text[], assigned_only boolean, role_id uuid, role_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id,
         CASE WHEN am.role = 'owner' THEN ARRAY['*']::text[] ELSE r.permissions END,
         CASE WHEN am.role = 'owner' THEN false ELSE r.data_scope = 'assigned' END,
         r.id,
         CASE WHEN am.role = 'owner' THEN 'Owner' ELSE r.name END
  FROM account_members am
  JOIN sub_accounts s ON s.account_id = am.account_id
  LEFT JOIN sub_account_members sm ON sm.sub_account_id = s.id AND sm.user_id = am.user_id
  LEFT JOIN roles r ON r.account_id = s.account_id AND r.id = coalesce(sm.role_id, am.all_businesses_role_id)
  WHERE am.user_id = app.current_user_id()
    AND (am.role = 'owner' OR r.id IS NOT NULL)
$$;
--> statement-breakpoint

-- Businesses where the current request holds `p_perm` ('member' = any access).
--   p_scope: 'any' | 'all' (full data scope) | 'assigned' (assigned-only scope)
--   p_requested_only: intersect with the businesses this request asked for.
-- System/public contexts are pinned to exactly one requested business.
CREATE OR REPLACE FUNCTION app.grant_ids(p_perm text, p_scope text, p_requested_only boolean) RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_requested uuid[] := app.requested_sub_account_ids();
BEGIN
  IF app.actor() IN ('system', 'public') THEN
    IF p_scope = 'assigned' OR coalesce(array_length(v_requested, 1), 0) <> 1 THEN
      RETURN '{}'::uuid[];
    END IF;
    RETURN v_requested;
  END IF;
  IF app.current_user_id() IS NULL THEN
    RETURN '{}'::uuid[];
  END IF;
  RETURN coalesce((
    SELECT array_agg(g.sub_account_id) FROM app.my_grants() g
    WHERE (NOT p_requested_only OR g.sub_account_id = ANY (v_requested))
      AND (p_perm = 'member' OR '*' = ANY (g.permissions) OR p_perm = ANY (g.permissions))
      AND (p_scope = 'any' OR (p_scope = 'assigned') = g.assigned_only)
  ), '{}'::uuid[]);
END $$;
--> statement-breakpoint

-- Every business the user may open (the switcher list).
CREATE OR REPLACE FUNCTION app.accessible_sub_account_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.grant_ids('member', 'any', false)
$$;
--> statement-breakpoint
-- Businesses visible to THIS request: requested ∩ accessible. Empty = fail closed.
CREATE OR REPLACE FUNCTION app.visible_sub_account_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.grant_ids('member', 'any', true)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.permitted_sub_account_ids(p_perm text) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.grant_ids(p_perm, 'any', true)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.full_sub_account_ids(p_perm text) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.grant_ids(p_perm, 'all', true)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.assigned_sub_account_ids(p_perm text) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.grant_ids(p_perm, 'assigned', true)
$$;
--> statement-breakpoint
-- Ignores which businesses were requested (for settings/team screens).
CREATE OR REPLACE FUNCTION app.granted_sub_account_ids(p_perm text) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.grant_ids(p_perm, 'any', false)
$$;
--> statement-breakpoint
-- The check every application write makes before it runs.
CREATE OR REPLACE FUNCTION app.has_permission(p_sub_account_id uuid, p_perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_sub_account_id = ANY (app.permitted_sub_account_ids(p_perm))
$$;
--> statement-breakpoint
-- Accounts where the user may invite people (owner, or team.manage in any business).
CREATE OR REPLACE FUNCTION app.team_account_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT s.account_id), '{}'::uuid[])
  FROM sub_accounts s WHERE s.id = ANY (app.granted_sub_account_ids('team.manage'))
$$;
--> statement-breakpoint
-- No privilege escalation: you can only hand out a role whose permissions you hold yourself.
CREATE OR REPLACE FUNCTION app.can_grant_role(p_sub_account_id uuid, p_role_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.my_grants() g JOIN roles r ON r.id = p_role_id
    JOIN sub_accounts s ON s.id = g.sub_account_id AND s.account_id = r.account_id
    WHERE g.sub_account_id = p_sub_account_id
      AND ('*' = ANY (g.permissions)
           OR (r.permissions <@ g.permissions AND (NOT g.assigned_only OR r.data_scope = 'assigned')))
  )
$$;
--> statement-breakpoint

-- A business role must come from the business's own master account, for a member of it.
CREATE OR REPLACE FUNCTION app.sub_account_members_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sub_accounts s
    JOIN roles r ON r.account_id = s.account_id AND r.id = NEW.role_id
    JOIN account_members am ON am.account_id = s.account_id AND am.user_id = NEW.user_id
    WHERE s.id = NEW.sub_account_id
  ) THEN
    RAISE EXCEPTION 'The person and the role must belong to the same master account as the business'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sub_account_members_check BEFORE INSERT OR UPDATE ON sub_account_members
  FOR EACH ROW EXECUTE FUNCTION app.sub_account_members_check();
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Row level security: business-owned tables
--
--   tenant_scope (restrictive)  row's business is visible to this request
--   tenant_read                 view permission; assigned-only roles see
--                               only rows linked to them
--   tenant_insert/update        edit permission
--   tenant_delete               delete permission (defaults to edit)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  m record;
  v_me constant text := '(SELECT app.current_user_id())';
  v_assigned text;
  v_read text;
BEGIN
  FOR m IN SELECT * FROM (VALUES
    -- table                     view                 edit               delete             rule            arg
    ('activities',               'contacts.view',     'contacts.edit',   'contacts.edit',   'contact',      NULL),
    ('companies',                'contacts.view',     'contacts.edit',   'contacts.delete', 'company',      NULL),
    ('contacts',                 'contacts.view',     'contacts.edit',   'contacts.delete', 'contact_self', NULL),
    ('custom_field_definitions', 'member',            'settings.manage', 'settings.manage', 'plain',        NULL),
    ('deals',                    'sales.view',        'sales.edit',      'sales.edit',      'assignee',     'assigned_user_id'),
    ('leads',                    'sales.view',        'sales.edit',      'sales.edit',      'assignee',     'assigned_user_id'),
    ('notes',                    'contacts.view',     'contacts.edit',   'contacts.edit',   'contact',      NULL),
    ('pipeline_stages',          'sales.view',        'sales.edit',      'sales.edit',      'plain',        NULL),
    ('pipelines',                'sales.view',        'sales.edit',      'sales.edit',      'plain',        NULL),
    ('staff_members',            'member',            'staff.edit',      'staff.edit',      'plain',        NULL),
    ('invoice_line_items',       'invoices.view',     'invoices.edit',   'invoices.edit',   'parent',       'invoices:invoice_id'),
    ('invoices',                 'invoices.view',     'invoices.edit',   'invoices.edit',   'contact',      NULL),
    ('orders',                   'orders.view',       'orders.edit',     'orders.edit',     'contact',      NULL),
    ('payments',                 'payments.view',     'payments.record', 'payments.record', 'contact',      NULL),
    ('products',                 'products.view',     'products.edit',   'products.edit',   'plain',        NULL),
    ('quote_line_items',         'quotes.view',       'quotes.edit',     'quotes.edit',     'parent',       'quotes:quote_id'),
    ('quotes',                   'quotes.view',       'quotes.edit',     'quotes.edit',     'contact',      NULL),
    ('webhook_events',           'settings.manage',   'member',          'settings.manage', 'plain',        NULL),
    ('appointments',             'calendar.view',     'calendar.edit',   'calendar.edit',   'assignee',     'assigned_user_id'),
    ('documents',                'documents.view',    'documents.edit',  'documents.edit',  'document',     NULL),
    ('jobs',                     'jobs.view',         'jobs.edit',       'jobs.edit',       'assignee',     'assigned_user_id'),
    ('tasks',                    'tasks.view',        'tasks.edit',      'tasks.edit',      'assignee',     'assignee_user_id'),
    ('campaign_recipients',      'marketing.view',    'marketing.edit',  'marketing.edit',  'contact',      NULL),
    ('campaigns',                'marketing.view',    'marketing.edit',  'marketing.edit',  'plain',        NULL),
    ('conversations',            'inbox.view',        'inbox.send',      'inbox.send',      'assignee',     'assigned_user_id'),
    ('events',                   'settings.manage',   'member',          'settings.manage', 'plain',        NULL),
    ('form_submissions',         'marketing.view',    'marketing.edit',  'marketing.edit',  'contact',      NULL),
    ('forms',                    'marketing.view',    'marketing.edit',  'marketing.edit',  'plain',        NULL),
    ('landing_pages',            'marketing.view',    'marketing.edit',  'marketing.edit',  'plain',        NULL),
    ('message_templates',        'member',            'inbox.send',      'inbox.send',      'plain',        NULL),
    ('messages',                 'inbox.view',        'inbox.send',      'inbox.send',      'parent',       'conversations:conversation_id'),
    ('workflow_runs',            'automations.view',  'automations.edit','automations.edit','contact',      NULL),
    ('workflows',                'automations.view',  'automations.edit','automations.edit','plain',        NULL)
  ) AS v(t, view_perm, edit_perm, delete_perm, rule, arg) LOOP
    v_assigned := CASE m.rule
      WHEN 'plain' THEN NULL
      WHEN 'assignee' THEN format('%I = %s', m.arg, v_me)
      WHEN 'contact' THEN format(
        'contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM contacts c WHERE c.sub_account_id = %1$I.sub_account_id AND c.id = %1$I.contact_id)', m.t)
      WHEN 'parent' THEN format(
        'EXISTS (SELECT 1 FROM %2$I p WHERE p.sub_account_id = %1$I.sub_account_id AND p.id = %1$I.%3$I)',
        m.t, split_part(m.arg, ':', 1), split_part(m.arg, ':', 2))
      WHEN 'company' THEN
        'EXISTS (SELECT 1 FROM contacts c WHERE c.sub_account_id = companies.sub_account_id AND c.company_id = companies.id)'
      WHEN 'document' THEN format(
        'uploaded_by_user_id = %s OR (contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM contacts c WHERE c.sub_account_id = documents.sub_account_id AND c.id = documents.contact_id))', v_me)
      WHEN 'contact_self' THEN format($f$owner_user_id = %1$s
        OR EXISTS (SELECT 1 FROM jobs x WHERE x.sub_account_id = contacts.sub_account_id AND x.contact_id = contacts.id AND x.assigned_user_id = %1$s)
        OR EXISTS (SELECT 1 FROM tasks x WHERE x.sub_account_id = contacts.sub_account_id AND x.contact_id = contacts.id AND x.assignee_user_id = %1$s)
        OR EXISTS (SELECT 1 FROM appointments x WHERE x.sub_account_id = contacts.sub_account_id AND x.contact_id = contacts.id AND x.assigned_user_id = %1$s)
        OR EXISTS (SELECT 1 FROM deals x WHERE x.sub_account_id = contacts.sub_account_id AND x.contact_id = contacts.id AND x.assigned_user_id = %1$s)
        OR EXISTS (SELECT 1 FROM leads x WHERE x.sub_account_id = contacts.sub_account_id AND x.contact_id = contacts.id AND x.assigned_user_id = %1$s)
        OR EXISTS (SELECT 1 FROM conversations x WHERE x.sub_account_id = contacts.sub_account_id AND x.contact_id = contacts.id AND x.assigned_user_id = %1$s)$f$, v_me)
    END;
    IF v_assigned IS NULL THEN
      v_read := format('sub_account_id = ANY ((SELECT app.permitted_sub_account_ids(%L))::uuid[])', m.view_perm);
    ELSE
      v_read := format(
        'sub_account_id = ANY ((SELECT app.full_sub_account_ids(%1$L))::uuid[]) '
        'OR (sub_account_id = ANY ((SELECT app.assigned_sub_account_ids(%1$L))::uuid[]) AND (%2$s))',
        m.view_perm, v_assigned);
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', m.t);
    EXECUTE format(
      'CREATE POLICY tenant_scope ON %I AS RESTRICTIVE '
      'USING (sub_account_id = ANY ((SELECT app.visible_sub_account_ids())::uuid[])) '
      'WITH CHECK (sub_account_id = ANY ((SELECT app.visible_sub_account_ids())::uuid[]))', m.t);
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT USING (%s)', m.t, v_read);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON %I FOR INSERT '
      'WITH CHECK (sub_account_id = ANY ((SELECT app.permitted_sub_account_ids(%L))::uuid[]))', m.t, m.edit_perm);
    EXECUTE format(
      'CREATE POLICY tenant_update ON %I FOR UPDATE '
      'USING (sub_account_id = ANY ((SELECT app.permitted_sub_account_ids(%1$L))::uuid[])) '
      'WITH CHECK (sub_account_id = ANY ((SELECT app.permitted_sub_account_ids(%1$L))::uuid[]))', m.t, m.edit_perm);
    EXECUTE format(
      'CREATE POLICY tenant_delete ON %I FOR DELETE '
      'USING (sub_account_id = ANY ((SELECT app.permitted_sub_account_ids(%L))::uuid[]))', m.t, m.delete_perm);
  END LOOP;
END $$;
--> statement-breakpoint

-- Notifications: to one person (user_id) or everyone in the business (null).
CREATE POLICY tenant_scope ON notifications AS RESTRICTIVE
  USING (sub_account_id = ANY ((SELECT app.visible_sub_account_ids())::uuid[]))
  WITH CHECK (sub_account_id = ANY ((SELECT app.visible_sub_account_ids())::uuid[]));
--> statement-breakpoint
-- Business-wide notifications only reach people allowed to see what they are about.
CREATE POLICY notifications_mine ON notifications
  USING (
    user_id = (SELECT app.current_user_id())
    OR (SELECT app.actor()) <> 'user'
    OR (user_id IS NULL AND CASE split_part(type, '.', 1)
      WHEN 'invoice' THEN sub_account_id = ANY ((SELECT app.permitted_sub_account_ids('invoices.view'))::uuid[])
      WHEN 'payment' THEN sub_account_id = ANY ((SELECT app.permitted_sub_account_ids('payments.view'))::uuid[])
      WHEN 'quote' THEN sub_account_id = ANY ((SELECT app.permitted_sub_account_ids('quotes.view'))::uuid[])
      WHEN 'lead' THEN sub_account_id = ANY ((SELECT app.full_sub_account_ids('sales.view'))::uuid[])
      WHEN 'form' THEN sub_account_id = ANY ((SELECT app.full_sub_account_ids('sales.view'))::uuid[])
      WHEN 'message' THEN sub_account_id = ANY ((SELECT app.full_sub_account_ids('inbox.view'))::uuid[])
      WHEN 'automation' THEN sub_account_id = ANY ((SELECT app.permitted_sub_account_ids('automations.view'))::uuid[])
      WHEN 'task' THEN sub_account_id = ANY ((SELECT app.full_sub_account_ids('tasks.view'))::uuid[])
      WHEN 'appointment' THEN sub_account_id = ANY ((SELECT app.full_sub_account_ids('calendar.view'))::uuid[])
      WHEN 'job' THEN sub_account_id = ANY ((SELECT app.full_sub_account_ids('jobs.view'))::uuid[])
      ELSE sub_account_id = ANY ((SELECT app.full_sub_account_ids('member'))::uuid[])
    END)
  )
  WITH CHECK (true);
--> statement-breakpoint

-- Audit log: readable with audit.view; account-level rows by the owner (and your own sign-ins).
-- Nobody can write, change or delete rows directly: see the triggers/functions below.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_read ON audit_log FOR SELECT USING (
  (sub_account_id IS NOT NULL AND sub_account_id = ANY ((SELECT app.permitted_sub_account_ids('audit.view'))::uuid[]))
  OR (sub_account_id IS NULL AND (account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[])
                                  OR actor_user_id = (SELECT app.current_user_id())))
);
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM bos_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Row level security: platform tables
-- ---------------------------------------------------------------------
CREATE POLICY users_select ON users FOR SELECT USING (
  id = (SELECT app.current_user_id())
  OR id IN (SELECT am.user_id FROM account_members am WHERE am.account_id = ANY ((SELECT app.my_account_ids())::uuid[]))
);
--> statement-breakpoint
CREATE POLICY users_update_self ON users FOR UPDATE USING (id = (SELECT app.current_user_id()));
--> statement-breakpoint
CREATE POLICY users_insert_by_team_manager ON users FOR INSERT
  WITH CHECK (coalesce(array_length((SELECT app.team_account_ids()), 1), 0) > 0);
--> statement-breakpoint
-- Password hashes and MFA secrets are never readable by the runtime role.
REVOKE SELECT ON users FROM bos_app;
--> statement-breakpoint
GRANT SELECT (id, email, name, timezone, mfa_enabled_at, password_changed_at, last_login_at, created_at, updated_at) ON users TO bos_app;
--> statement-breakpoint

CREATE POLICY sessions_own ON sessions
  USING (user_id = (SELECT app.current_user_id())) WITH CHECK (user_id = (SELECT app.current_user_id()));
--> statement-breakpoint

CREATE POLICY accounts_select ON accounts FOR SELECT USING (id = ANY ((SELECT app.my_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY accounts_update ON accounts FOR UPDATE USING (id = ANY ((SELECT app.my_owner_account_ids())::uuid[]));
--> statement-breakpoint

CREATE POLICY account_members_select ON account_members FOR SELECT
  USING (account_id = ANY ((SELECT app.my_account_ids())::uuid[]));
--> statement-breakpoint
-- Owners manage everything; team managers may only add plain members (business roles are set separately).
CREATE POLICY account_members_insert ON account_members FOR INSERT WITH CHECK (
  account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[])
  OR (role = 'member' AND all_businesses_role_id IS NULL AND account_id = ANY ((SELECT app.team_account_ids())::uuid[]))
);
--> statement-breakpoint
CREATE POLICY account_members_update ON account_members FOR UPDATE
  USING (account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]) AND user_id <> (SELECT app.current_user_id()))
  WITH CHECK (account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY account_members_delete ON account_members FOR DELETE
  USING (account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]) AND user_id <> (SELECT app.current_user_id()));
--> statement-breakpoint

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_select ON roles FOR SELECT USING (account_id = ANY ((SELECT app.my_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY roles_write ON roles FOR ALL
  USING (account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]))
  WITH CHECK (account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]));
--> statement-breakpoint

-- Owners also see brand-new businesses (so INSERT ... RETURNING works before any grant exists).
CREATE POLICY sub_accounts_select ON sub_accounts FOR SELECT USING (
  id = ANY ((SELECT app.accessible_sub_account_ids())::uuid[])
  OR account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[])
);
--> statement-breakpoint
CREATE POLICY sub_accounts_insert ON sub_accounts FOR INSERT
  WITH CHECK (account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY sub_accounts_update ON sub_accounts FOR UPDATE
  USING (id = ANY ((SELECT app.permitted_sub_account_ids('settings.manage'))::uuid[]) OR account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY sub_accounts_delete ON sub_accounts FOR DELETE
  USING (account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]));
--> statement-breakpoint

CREATE POLICY sub_account_members_select ON sub_account_members FOR SELECT
  USING (sub_account_id = ANY ((SELECT app.accessible_sub_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY sub_account_members_insert ON sub_account_members FOR INSERT WITH CHECK (
  sub_account_id = ANY ((SELECT app.granted_sub_account_ids('team.manage'))::uuid[])
  AND user_id <> (SELECT app.current_user_id())
  AND app.can_grant_role(sub_account_id, role_id)
);
--> statement-breakpoint
CREATE POLICY sub_account_members_update ON sub_account_members FOR UPDATE
  USING (sub_account_id = ANY ((SELECT app.granted_sub_account_ids('team.manage'))::uuid[]) AND user_id <> (SELECT app.current_user_id()))
  WITH CHECK (app.can_grant_role(sub_account_id, role_id));
--> statement-breakpoint
CREATE POLICY sub_account_members_delete ON sub_account_members FOR DELETE
  USING (sub_account_id = ANY ((SELECT app.granted_sub_account_ids('team.manage'))::uuid[]) AND user_id <> (SELECT app.current_user_id()));
--> statement-breakpoint

CREATE POLICY integrations_sub_account_read ON integrations FOR SELECT
  USING (scope = 'sub_account' AND sub_account_id = ANY ((SELECT app.visible_sub_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY integrations_sub_account_insert ON integrations FOR INSERT
  WITH CHECK (scope = 'sub_account' AND sub_account_id = ANY ((SELECT app.permitted_sub_account_ids('integrations.manage'))::uuid[]));
--> statement-breakpoint
-- Status updates (e.g. a failing provider) are written by background work pinned to the business.
CREATE POLICY integrations_sub_account_update ON integrations FOR UPDATE
  USING (scope = 'sub_account' AND sub_account_id = ANY ((SELECT app.permitted_sub_account_ids('integrations.manage'))::uuid[]))
  WITH CHECK (scope = 'sub_account' AND sub_account_id = ANY ((SELECT app.permitted_sub_account_ids('integrations.manage'))::uuid[]));
--> statement-breakpoint
CREATE POLICY integrations_sub_account_delete ON integrations FOR DELETE
  USING (scope = 'sub_account' AND sub_account_id = ANY ((SELECT app.permitted_sub_account_ids('integrations.manage'))::uuid[]));
--> statement-breakpoint
CREATE POLICY integrations_global_read ON integrations FOR SELECT
  USING (scope = 'global' AND account_id = ANY ((SELECT app.my_account_ids())::uuid[]));
--> statement-breakpoint
CREATE POLICY integrations_global_write ON integrations FOR ALL
  USING (scope = 'global' AND account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]))
  WITH CHECK (scope = 'global' AND account_id = ANY ((SELECT app.my_owner_account_ids())::uuid[]));
--> statement-breakpoint

CREATE POLICY user_notification_prefs_own ON user_notification_prefs
  USING (user_id = (SELECT app.current_user_id())) WITH CHECK (user_id = (SELECT app.current_user_id()));
--> statement-breakpoint

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_keys_manage ON api_keys
  USING (sub_account_id = ANY ((SELECT app.granted_sub_account_ids('integrations.manage'))::uuid[]))
  WITH CHECK (sub_account_id = ANY ((SELECT app.granted_sub_account_ids('integrations.manage'))::uuid[]));
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Numbering now checks the matching permission.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.next_number(p_sub_account_id uuid, p_kind text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_result text;
  v_perm text := CASE p_kind WHEN 'invoice' THEN 'invoices.edit' WHEN 'quote' THEN 'quotes.edit'
                             WHEN 'job' THEN 'jobs.edit' WHEN 'order' THEN 'orders.edit' END;
BEGIN
  IF v_perm IS NULL THEN
    RAISE EXCEPTION 'unknown number kind %', p_kind;
  END IF;
  IF NOT app.has_permission(p_sub_account_id, v_perm) THEN
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
  ELSE
    UPDATE sub_accounts SET next_order_number = next_order_number + 1 WHERE id = p_sub_account_id
      RETURNING order_prefix || (next_order_number - 1)::text INTO v_result;
  END IF;
  RETURN v_result;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Authentication entry points (pre-session, so SECURITY DEFINER).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS app.auth_find_user(text);
--> statement-breakpoint
CREATE FUNCTION app.auth_find_user(p_email text)
RETURNS TABLE (id uuid, password_hash text, mfa_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.password_hash, u.mfa_enabled_at IS NOT NULL FROM users u WHERE lower(u.email) = lower(p_email) LIMIT 1
$$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS app.auth_session(text);
--> statement-breakpoint
CREATE FUNCTION app.auth_session(p_token_hash text)
RETURNS TABLE (session_id uuid, user_id uuid, expires_at timestamptz, last_seen_at timestamptz, idle_minutes int, require_mfa boolean, mfa_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.user_id, s.expires_at, s.last_seen_at,
         (SELECT min(nullif(a.settings ->> 'sessionIdleMinutes', '')::int) FROM account_members am JOIN accounts a ON a.id = am.account_id WHERE am.user_id = s.user_id),
         coalesce((SELECT bool_or(coalesce((a.settings ->> 'requireMfa')::boolean, false)) FROM account_members am JOIN accounts a ON a.id = am.account_id WHERE am.user_id = s.user_id), false),
         u.mfa_enabled_at IS NOT NULL
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash AND s.expires_at > now() LIMIT 1
$$;
--> statement-breakpoint
-- Sliding idle timeout: refresh at most once a minute.
CREATE OR REPLACE FUNCTION app.touch_session(p_session_id uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE sessions SET last_seen_at = now() WHERE id = p_session_id AND last_seen_at < now() - interval '1 minute'
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.end_session(p_token_hash text) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM sessions WHERE token_hash = p_token_hash RETURNING user_id
$$;
--> statement-breakpoint
-- MFA state for the second login step and for the signed-in user's security screen.
CREATE OR REPLACE FUNCTION app.auth_mfa_state(p_user_id uuid)
RETURNS TABLE (secret_encrypted text, enabled boolean, last_step bigint, recovery_codes_left int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.mfa_secret_encrypted, u.mfa_enabled_at IS NOT NULL, u.mfa_last_step, coalesce(array_length(u.mfa_recovery_hashes, 1), 0)
  FROM users u WHERE u.id = p_user_id
$$;
--> statement-breakpoint
-- Accept a TOTP time step once (replay protection); false if it was already used.
CREATE OR REPLACE FUNCTION app.auth_consume_totp_step(p_user_id uuid, p_step bigint) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE users SET mfa_last_step = p_step
  WHERE id = p_user_id AND (mfa_last_step IS NULL OR mfa_last_step < p_step);
  RETURN FOUND;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.auth_consume_recovery_code(p_user_id uuid, p_hash text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE users SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, p_hash)
  WHERE id = p_user_id AND p_hash = ANY (mfa_recovery_hashes);
  RETURN FOUND;
END $$;
--> statement-breakpoint
-- The signed-in user's own password hash (to confirm the current password).
CREATE OR REPLACE FUNCTION app.my_password_hash() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT password_hash FROM users WHERE id = app.current_user_id()
$$;
--> statement-breakpoint
-- API keys: sha256(key) → the one business and permissions it carries.
CREATE OR REPLACE FUNCTION app.auth_api_key(p_key_hash text)
RETURNS TABLE (id uuid, sub_account_id uuid, name text, permissions text[])
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE api_keys k SET last_used_at = now()
  WHERE k.key_hash = p_key_hash AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())
    AND EXISTS (SELECT 1 FROM sub_accounts s WHERE s.id = k.sub_account_id AND s.archived_at IS NULL)
  RETURNING k.id, k.sub_account_id, k.name, k.permissions
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Audit log writers
-- ---------------------------------------------------------------------

-- Sign-in events. Only 'auth.*' actions; one row per master account of the user.
CREATE OR REPLACE FUNCTION app.audit_auth(p_user_id uuid, p_action text, p_ip text, p_data jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_action NOT LIKE 'auth.%' THEN
    RAISE EXCEPTION 'audit_auth only records auth.* events';
  END IF;
  IF p_action = 'auth.login' THEN
    UPDATE users SET last_login_at = now() WHERE id = p_user_id;
  END IF;
  INSERT INTO audit_log (account_id, actor_user_id, actor, action, entity_type, entity_id, entity_label, data, ip)
  SELECT am.account_id, p_user_id, 'user', p_action, 'user', p_user_id, u.name, coalesce(p_data, '{}'::jsonb), p_ip
  FROM account_members am JOIN users u ON u.id = am.user_id
  WHERE am.user_id = p_user_id;
END $$;
--> statement-breakpoint

-- Explicit application events for one business the request can see.
CREATE OR REPLACE FUNCTION app.audit_write(p_sub_account_id uuid, p_action text, p_entity_type text, p_entity_id uuid, p_entity_label text, p_data jsonb)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (p_sub_account_id = ANY (app.visible_sub_account_ids())) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO audit_log (account_id, sub_account_id, actor_user_id, actor, actor_label, action, entity_type, entity_id, entity_label, data, ip)
  SELECT s.account_id, s.id, app.current_user_id(),
         coalesce(nullif(current_setting('app.audit_actor', true), ''), app.actor()),
         nullif(current_setting('app.actor_label', true), ''),
         p_action, p_entity_type, p_entity_id, p_entity_label, coalesce(p_data, '{}'::jsonb),
         nullif(current_setting('app.client_ip', true), '')
  FROM sub_accounts s WHERE s.id = p_sub_account_id;
END $$;
--> statement-breakpoint

-- Row changes on important tables. TG_ARGV[0] = entity type shown in the log.
CREATE OR REPLACE FUNCTION app.audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_entity text := TG_ARGV[0];
  v_new jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_old jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed jsonb := '{}'::jsonb;
  v_key text;
  v_action text;
  v_sub uuid;
  v_account uuid;
  v_label text;
  v_entity_id uuid;
  v_quiet constant text[] := ARRAY['id', 'sub_account_id', 'account_id', 'created_at', 'updated_at', 'public_token',
    'last_reminder_at', 'reminder_count', 'viewed_at', 'last_contacted_at', 'next_contact_at', 'lead_score',
    'run_count', 'last_run_at', 'receipt_sent_at', 'receipt_url', 'key_hash', 'last_used_at', 'sort_order',
    'last_error', 'next_invoice_number', 'next_quote_number', 'next_job_number', 'next_order_number'];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      CONTINUE WHEN v_key = ANY (v_quiet) OR (v_new -> v_key) IS NOT DISTINCT FROM (v_old -> v_key);
      IF v_key = 'secrets_encrypted' THEN
        v_changed := v_changed || jsonb_build_object('credentials', jsonb_build_array('(hidden)', '(updated)'));
      ELSIF jsonb_typeof(v_new -> v_key) IN ('object', 'array') OR jsonb_typeof(v_old -> v_key) IN ('object', 'array') THEN
        v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_array(NULL, '(changed)'));
      ELSE
        v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_array(
          CASE WHEN length(v_old ->> v_key) > 200 THEN to_jsonb(left(v_old ->> v_key, 200) || '…') ELSE v_old -> v_key END,
          CASE WHEN length(v_new ->> v_key) > 200 THEN to_jsonb(left(v_new ->> v_key, 200) || '…') ELSE v_new -> v_key END));
      END IF;
    END LOOP;
    IF v_changed = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
    IF v_changed ? 'status' THEN
      v_action := v_entity || '.' || (v_new ->> 'status');
    ELSIF v_changed ? 'archived_at' THEN
      v_action := v_entity || CASE WHEN v_new ->> 'archived_at' IS NULL THEN '.restored' ELSE '.archived' END;
    ELSE
      v_action := v_entity || '.updated';
    END IF;
  ELSE
    v_action := v_entity || CASE TG_OP WHEN 'INSERT' THEN '.created' ELSE '.deleted' END;
  END IF;

  IF TG_TABLE_NAME = 'sub_accounts' THEN
    v_sub := NULL;
    v_account := (v_row ->> 'account_id')::uuid;
  ELSE
    v_sub := (v_row ->> 'sub_account_id')::uuid;
    v_account := coalesce((v_row ->> 'account_id')::uuid, (SELECT s.account_id FROM sub_accounts s WHERE s.id = v_sub));
  END IF;
  -- Business or account is being deleted (cascade): nothing to attach the entry to.
  IF v_account IS NULL OR NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = v_account)
     OR (v_sub IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sub_accounts s WHERE s.id = v_sub)) THEN
    RETURN NULL;
  END IF;

  v_entity_id := CASE WHEN v_row ? 'id' THEN (v_row ->> 'id')::uuid ELSE (v_row ->> 'user_id')::uuid END;
  v_label := CASE TG_TABLE_NAME
    WHEN 'contacts' THEN nullif(trim(coalesce(v_row ->> 'first_name', '') || ' ' || coalesce(v_row ->> 'last_name', '')), '')
    WHEN 'payments' THEN '$' || to_char((v_row ->> 'amount_cents')::numeric / 100, 'FM999,999,990.00') || ' ' || coalesce(v_row ->> 'method', '')
    WHEN 'integrations' THEN coalesce(v_row ->> 'label', v_row ->> 'provider')
    WHEN 'account_members' THEN (SELECT u.name FROM users u WHERE u.id = (v_row ->> 'user_id')::uuid)
    WHEN 'sub_account_members' THEN (SELECT u.name FROM users u WHERE u.id = (v_row ->> 'user_id')::uuid)
    ELSE coalesce(v_row ->> 'number', v_row ->> 'name')
  END;
  IF TG_TABLE_NAME IN ('sub_account_members', 'account_members') THEN
    v_changed := v_changed || jsonb_strip_nulls(jsonb_build_object(
      'role', (SELECT r.name FROM roles r WHERE r.id = coalesce((v_row ->> 'role_id')::uuid, (v_row ->> 'all_businesses_role_id')::uuid))));
  ELSIF TG_OP = 'INSERT' AND TG_TABLE_NAME IN ('invoices', 'quotes') THEN
    v_changed := jsonb_build_object('total', '$' || to_char((v_row ->> 'total_cents')::numeric / 100, 'FM999,999,990.00'));
  END IF;

  INSERT INTO audit_log (account_id, sub_account_id, actor_user_id, actor, actor_label, action, entity_type, entity_id, entity_label, data, ip)
  VALUES (
    v_account, v_sub, app.current_user_id(),
    coalesce(nullif(current_setting('app.audit_actor', true), ''), app.actor()),
    nullif(current_setting('app.actor_label', true), ''),
    v_action, v_entity, v_entity_id, v_label,
    CASE WHEN v_changed = '{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('changed', v_changed) END,
    nullif(current_setting('app.client_ip', true), ''));
  RETURN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE a record;
BEGIN
  FOR a IN SELECT * FROM (VALUES
    ('contacts', 'contact'), ('invoices', 'invoice'), ('quotes', 'quote'), ('payments', 'payment'),
    ('products', 'product'), ('workflows', 'automation'), ('integrations', 'integration'),
    ('api_keys', 'api_key'), ('roles', 'role'), ('account_members', 'account_member'),
    ('sub_account_members', 'business_member'), ('sub_accounts', 'business')
  ) AS v(t, entity) LOOP
    EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.audit_trigger(%L)', a.t, a.entity);
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Privileges for the runtime role
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO bos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON roles, api_keys TO bos_app;
