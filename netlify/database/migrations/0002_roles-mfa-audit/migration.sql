-- Generated from drizzle/0002_roles_mfa_audit.sql by scripts/netlify-migrations.mjs. Do not edit.
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"created_by_user_id" uuid,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"data_scope" text DEFAULT 'all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "sub_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account_members" ADD COLUMN "all_businesses_role_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sub_account_members" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_last_step" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_recovery_hashes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_label" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entity_label" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_sub_account_idx" ON "api_keys" USING btree ("sub_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_account_name_uq" ON "roles" USING btree ("account_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_account_key_uq" ON "roles" USING btree ("account_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_account_id_uq" ON "roles" USING btree ("account_id","id");--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_all_businesses_role_id_roles_id_fk" FOREIGN KEY ("all_businesses_role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_account_members" ADD CONSTRAINT "sub_account_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_members_user_idx" ON "account_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sub_account_members_user_idx" ON "sub_account_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contacts_owner_idx" ON "contacts" USING btree ("sub_account_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "deals_assigned_idx" ON "deals" USING btree ("sub_account_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "leads_assigned_idx" ON "leads" USING btree ("sub_account_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "notes_contact_idx" ON "notes" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE INDEX "payments_contact_idx" ON "payments" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE INDEX "quotes_contact_idx" ON "quotes" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE INDEX "appointments_assigned_idx" ON "appointments" USING btree ("sub_account_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "appointments_contact_idx" ON "appointments" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE INDEX "documents_contact_idx" ON "documents" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE INDEX "jobs_assigned_idx" ON "jobs" USING btree ("sub_account_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "jobs_contact_idx" ON "jobs" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE INDEX "tasks_contact_idx" ON "tasks" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE INDEX "audit_log_sub_account_time_idx" ON "audit_log" USING btree ("sub_account_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_account_time_idx" ON "audit_log" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_assigned_idx" ON "conversations" USING btree ("sub_account_id","assigned_user_id");--> statement-breakpoint

-- ---------------------------------------------------------------------
-- Starting roles for every master account (kept in sync with
-- src/lib/permissions.ts SYSTEM_ROLES by tests/permissions.test.ts).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.default_roles()
RETURNS TABLE (key text, name text, description text, permissions text[], data_scope text)
LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('admin', 'Admin', 'Runs the business: everything including settings, integrations and team.', ARRAY['contacts.view', 'contacts.edit', 'contacts.delete', 'sales.view', 'sales.edit', 'quotes.view', 'quotes.edit', 'invoices.view', 'invoices.edit', 'payments.view', 'payments.record', 'payments.refund', 'products.view', 'products.edit', 'orders.view', 'orders.edit', 'jobs.view', 'jobs.edit', 'tasks.view', 'tasks.edit', 'calendar.view', 'calendar.edit', 'staff.view', 'staff.edit', 'documents.view', 'documents.edit', 'inbox.view', 'inbox.send', 'marketing.view', 'marketing.edit', 'automations.view', 'automations.edit', 'reports.view', 'reports.financial', 'ai.use', 'settings.manage', 'integrations.manage', 'team.manage', 'audit.view']::text[], 'all'),
    ('manager', 'Manager', 'Customers, sales, quotes, jobs, tasks, inbox, marketing and reports. No invoices, payments or settings.', ARRAY['contacts.view', 'contacts.edit', 'sales.view', 'sales.edit', 'quotes.view', 'quotes.edit', 'products.view', 'orders.view', 'orders.edit', 'jobs.view', 'jobs.edit', 'tasks.view', 'tasks.edit', 'calendar.view', 'calendar.edit', 'staff.view', 'staff.edit', 'documents.view', 'documents.edit', 'inbox.view', 'inbox.send', 'marketing.view', 'marketing.edit', 'automations.view', 'reports.view', 'ai.use']::text[], 'all'),
    ('staff', 'Staff', 'Only the customers, jobs, tasks and appointments assigned to them.', ARRAY['contacts.view', 'jobs.view', 'jobs.edit', 'tasks.view', 'tasks.edit', 'calendar.view', 'calendar.edit', 'staff.view', 'documents.view', 'documents.edit', 'inbox.view', 'inbox.send']::text[], 'assigned'),
    ('accountant', 'Accountant', 'Invoices, payments, refunds and financial reports. Read-only customers and quotes.', ARRAY['contacts.view', 'quotes.view', 'invoices.view', 'invoices.edit', 'payments.view', 'payments.record', 'payments.refund', 'products.view', 'products.edit', 'orders.view', 'reports.view', 'reports.financial', 'audit.view']::text[], 'all'),
    ('viewer', 'Viewer', 'Can look at everything, change nothing.', ARRAY['contacts.view', 'sales.view', 'quotes.view', 'invoices.view', 'payments.view', 'products.view', 'orders.view', 'jobs.view', 'tasks.view', 'calendar.view', 'staff.view', 'documents.view', 'inbox.view', 'marketing.view', 'automations.view', 'reports.view', 'audit.view', 'reports.financial']::text[], 'all')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.install_default_roles(p_account_id uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO roles (account_id, key, name, description, permissions, data_scope)
  SELECT p_account_id, d.key, d.name, d.description, d.permissions, d.data_scope FROM app.default_roles() d
  ON CONFLICT (account_id, key) DO NOTHING
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.accounts_install_roles_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.install_default_roles(NEW.id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounts_install_roles AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION app.accounts_install_roles_trg();
--> statement-breakpoint
SELECT app.install_default_roles(id) FROM accounts;
--> statement-breakpoint

-- Old account 'admin' → member with the Admin role in every business.
UPDATE account_members am SET role = 'member',
  all_businesses_role_id = (SELECT r.id FROM roles r WHERE r.account_id = am.account_id AND r.key = 'admin')
WHERE am.role = 'admin';
--> statement-breakpoint
ALTER TABLE account_members ADD CONSTRAINT account_members_role_ck CHECK (role IN ('owner', 'member'));
--> statement-breakpoint
-- A role can only be used inside its own master account.
ALTER TABLE account_members ADD CONSTRAINT account_members_role_same_account_fk
  FOREIGN KEY (account_id, all_businesses_role_id) REFERENCES roles (account_id, id) ON DELETE SET NULL (all_businesses_role_id);
--> statement-breakpoint

-- Old business roles admin/staff/viewer → the matching role.
UPDATE sub_account_members sm SET role_id = r.id
FROM sub_accounts s, roles r
WHERE s.id = sm.sub_account_id AND r.account_id = s.account_id AND r.key = sm.role;
--> statement-breakpoint
ALTER TABLE sub_account_members ALTER COLUMN role_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE sub_account_members DROP COLUMN role;
--> statement-breakpoint
ALTER TABLE roles ADD CONSTRAINT roles_data_scope_ck CHECK (data_scope IN ('all', 'assigned'));
--> statement-breakpoint

UPDATE audit_log a SET account_id = s.account_id FROM sub_accounts s WHERE s.id = a.sub_account_id;
--> statement-breakpoint
ALTER TABLE audit_log ALTER COLUMN account_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE audit_log ADD CONSTRAINT audit_log_sub_account_same_account_fk
  FOREIGN KEY (account_id, sub_account_id) REFERENCES sub_accounts (account_id, id) ON DELETE CASCADE;
