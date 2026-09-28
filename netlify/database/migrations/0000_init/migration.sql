-- Generated from drizzle/0000_init.sql by scripts/netlify-migrations.mjs. Do not edit.
CREATE TABLE "account_members" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_members_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"sub_account_id" uuid,
	"provider" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_encrypted" text,
	"last_error" text,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_account_members" (
	"sub_account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_account_members_sub_account_id_user_id_pk" PRIMARY KEY("sub_account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sub_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_name" text,
	"color" text DEFAULT '#4f46e5' NOT NULL,
	"trading_name" text,
	"legal_name" text,
	"abn" text,
	"acn" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"phone" text,
	"email" text,
	"website" text,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"terminology" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"region" text DEFAULT 'AU' NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"timezone" text DEFAULT 'Australia/Melbourne' NOT NULL,
	"locale" text DEFAULT 'en-AU' NOT NULL,
	"tax_regime" text DEFAULT 'AU_GST' NOT NULL,
	"tax_registered" boolean DEFAULT true NOT NULL,
	"prices_include_tax" boolean DEFAULT false NOT NULL,
	"invoice_prefix" text DEFAULT 'INV-' NOT NULL,
	"next_invoice_number" integer DEFAULT 1001 NOT NULL,
	"quote_prefix" text DEFAULT 'Q-' NOT NULL,
	"next_quote_number" integer DEFAULT 1001 NOT NULL,
	"job_prefix" text DEFAULT 'JOB-' NOT NULL,
	"next_job_number" integer DEFAULT 1001 NOT NULL,
	"order_prefix" text DEFAULT 'ORD-' NOT NULL,
	"next_order_number" integer DEFAULT 1001 NOT NULL,
	"payment_terms_days" integer DEFAULT 14 NOT NULL,
	"quote_validity_days" integer DEFAULT 30 NOT NULL,
	"invoice_terms" text,
	"quote_terms" text,
	"bank_details" text,
	"enabled_modules" text[] DEFAULT '{}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notification_prefs" (
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_notification_prefs_user_id_event_type_pk" PRIMARY KEY("user_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"timezone" text DEFAULT 'Australia/Melbourne' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"contact_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"website" text,
	"abn" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"company_id" uuid,
	"job_title" text,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"email" text,
	"phone" text,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"website" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source" text,
	"owner_user_id" uuid,
	"status" text DEFAULT 'lead' NOT NULL,
	"lead_score" integer DEFAULT 0 NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"next_contact_at" timestamp with time zone,
	"email_opt_out" boolean DEFAULT false NOT NULL,
	"sms_opt_out" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"title" text NOT NULL,
	"value_cents" bigint DEFAULT 0 NOT NULL,
	"probability" integer,
	"expected_close_date" date,
	"assigned_user_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"lost_reason" text,
	"stage_changed_at" timestamp with time zone DEFAULT now(),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"title" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_user_id" uuid,
	"value_cents" bigint DEFAULT 0 NOT NULL,
	"probability" integer DEFAULT 10 NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"next_action" text,
	"next_action_at" timestamp with time zone,
	"notes" text,
	"deal_id" uuid,
	"form_submission_id" uuid,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"contact_id" uuid,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'open' NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT 1 NOT NULL,
	"unit_price_cents" bigint DEFAULT 0 NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"tax_code" text DEFAULT 'GST' NOT NULL,
	"tax_rate_bps" integer DEFAULT 1000 NOT NULL,
	"line_subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"line_tax_cents" bigint DEFAULT 0 NOT NULL,
	"line_total_cents" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"quote_id" uuid,
	"job_id" uuid,
	"order_id" uuid,
	"title" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"prices_include_tax" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"amount_paid_cents" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"terms" text,
	"public_token" text NOT NULL,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"last_reminder_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"shipping_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"invoice_id" uuid,
	"contact_id" uuid,
	"amount_cents" bigint NOT NULL,
	"refunded_cents" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"method" text DEFAULT 'card' NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_payment_id" text,
	"provider_charge_id" text,
	"provider_checkout_session_id" text,
	"card_brand" text,
	"card_last4" text,
	"failure_reason" text,
	"receipt_url" text,
	"receipt_sent_at" timestamp with time zone,
	"reference" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"description" text,
	"kind" text DEFAULT 'service' NOT NULL,
	"unit" text,
	"cost_cents" bigint,
	"price_cents" bigint DEFAULT 0 NOT NULL,
	"tax_code" text DEFAULT 'GST' NOT NULL,
	"category" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT 1 NOT NULL,
	"unit_price_cents" bigint DEFAULT 0 NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"tax_code" text DEFAULT 'GST' NOT NULL,
	"tax_rate_bps" integer DEFAULT 1000 NOT NULL,
	"line_subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"line_tax_cents" bigint DEFAULT 0 NOT NULL,
	"line_total_cents" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"title" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"expiry_date" date,
	"prices_include_tax" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'AUD' NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"terms" text,
	"public_token" text NOT NULL,
	"accept_options" jsonb DEFAULT '{"createJob":true,"createInvoice":true}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by_name" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"job_id" uuid,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"integration_id" uuid,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'appointment' NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"job_id" uuid,
	"staff_id" uuid,
	"assigned_user_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text,
	"notes" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"external_provider" text,
	"external_event_id" text,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"entity_type" text DEFAULT 'business' NOT NULL,
	"entity_id" uuid,
	"contact_id" uuid,
	"kind" text DEFAULT 'document' NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"deal_id" uuid,
	"quote_id" uuid,
	"status" text DEFAULT 'booked' NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"value_cents" bigint DEFAULT 0 NOT NULL,
	"assigned_user_id" uuid,
	"notes" text,
	"completed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'todo' NOT NULL,
	"due_at" timestamp with time zone,
	"all_day" boolean DEFAULT true NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"contact_id" uuid,
	"deal_id" uuid,
	"job_id" uuid,
	"invoice_id" uuid,
	"assignee_user_id" uuid,
	"recurrence" text,
	"reminder_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"message_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"segment" jsonb DEFAULT '{"match":"all","rules":[]}'::jsonb NOT NULL,
	"subject" text,
	"body" text DEFAULT '' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{"recipients":0,"sent":0,"delivered":0,"failed":0,"opened":0,"clicked":0,"optedOut":0}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"contact_id" uuid,
	"channel" text NOT NULL,
	"subject" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_user_id" uuid,
	"snoozed_until" timestamp with time zone,
	"unread" boolean DEFAULT true NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"last_direction" text,
	"external_thread_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"contact_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"contact_id" uuid,
	"data" jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_id" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{"createLead":true,"notify":true}'::jsonb NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landing_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_id" text NOT NULL,
	"title" text NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"is_signature" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"body_html" text,
	"from_address" text,
	"to_address" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_seconds" integer,
	"is_internal_note" boolean DEFAULT false NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_by_user_id" uuid,
	"campaign_id" uuid,
	"workflow_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" jsonb DEFAULT '[0]'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"trigger" jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{"stopOnReply":true,"allowReentry":false}'::jsonb NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_account_members" ADD CONSTRAINT "sub_account_members_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_account_members" ADD CONSTRAINT "sub_account_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_accounts" ADD CONSTRAINT "sub_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_prefs" ADD CONSTRAINT "user_notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_sub_account_id_sub_accounts_id_fk" FOREIGN KEY ("sub_account_id") REFERENCES "public"."sub_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integrations_sub_account_idx" ON "integrations" USING btree ("sub_account_id");--> statement-breakpoint
CREATE INDEX "integrations_account_idx" ON "integrations" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_accounts_account_slug_uq" ON "sub_accounts" USING btree ("account_id","slug");--> statement-breakpoint
CREATE INDEX "sub_accounts_account_idx" ON "sub_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "activities_tenant_uq" ON "activities" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "activities_contact_idx" ON "activities" USING btree ("sub_account_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX "activities_entity_idx" ON "activities" USING btree ("sub_account_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_tenant_uq" ON "companies" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("sub_account_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_uq" ON "contacts" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("sub_account_id","email");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("sub_account_id","phone");--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("sub_account_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_tenant_uq" ON "custom_field_definitions" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_key_uq" ON "custom_field_definitions" USING btree ("sub_account_id","entity_type","key");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_tenant_uq" ON "deals" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "deals_stage_idx" ON "deals" USING btree ("sub_account_id","pipeline_id","stage_id");--> statement-breakpoint
CREATE INDEX "deals_contact_idx" ON "deals" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_tenant_uq" ON "leads" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("sub_account_id","status");--> statement-breakpoint
CREATE INDEX "leads_contact_idx" ON "leads" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_tenant_uq" ON "notes" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "notes_entity_idx" ON "notes" USING btree ("sub_account_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_tenant_uq" ON "pipeline_stages" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "pipeline_stages_pipeline_idx" ON "pipeline_stages" USING btree ("sub_account_id","pipeline_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_tenant_uq" ON "pipelines" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_members_tenant_uq" ON "staff_members" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_line_items_tenant_uq" ON "invoice_line_items" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("sub_account_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_uq" ON "invoices" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("sub_account_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_public_token_uq" ON "invoices" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("sub_account_id","status","due_date");--> statement-breakpoint
CREATE INDEX "invoices_contact_idx" ON "invoices" USING btree ("sub_account_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_uq" ON "orders" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_uq" ON "orders" USING btree ("sub_account_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_uq" ON "payments" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_uq" ON "payments" USING btree ("sub_account_id","provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("sub_account_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payments_paid_at_idx" ON "payments" USING btree ("sub_account_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_uq" ON "products" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_line_items_tenant_uq" ON "quote_line_items" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "quote_line_items_quote_idx" ON "quote_line_items" USING btree ("sub_account_id","quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_tenant_uq" ON "quotes" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_number_uq" ON "quotes" USING btree ("sub_account_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_public_token_uq" ON "quotes" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("sub_account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_tenant_uq" ON "webhook_events" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_uq" ON "webhook_events" USING btree ("sub_account_id","provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_tenant_uq" ON "appointments" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "appointments_starts_idx" ON "appointments" USING btree ("sub_account_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_uq" ON "documents" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "documents_entity_idx" ON "documents" USING btree ("sub_account_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_tenant_uq" ON "jobs" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_number_uq" ON "jobs" USING btree ("sub_account_id","number");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("sub_account_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_tenant_uq" ON "tasks" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("sub_account_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("sub_account_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_tenant_uq" ON "campaign_recipients" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_unique" ON "campaign_recipients" USING btree ("sub_account_id","campaign_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_tenant_uq" ON "campaigns" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_tenant_uq" ON "conversations" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "conversations_inbox_idx" ON "conversations" USING btree ("sub_account_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_contact_idx" ON "conversations" USING btree ("sub_account_id","contact_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "events_id_uq" ON "events" USING btree ("id");--> statement-breakpoint
CREATE INDEX "events_pending_idx" ON "events" USING btree ("processed_at","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submissions_tenant_uq" ON "form_submissions" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "form_submissions_form_idx" ON "form_submissions" USING btree ("sub_account_id","form_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_tenant_uq" ON "forms" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "forms_public_id_uq" ON "forms" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "landing_pages_tenant_uq" ON "landing_pages" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "landing_pages_public_id_uq" ON "landing_pages" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_tenant_uq" ON "message_templates" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tenant_uq" ON "messages" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("sub_account_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_scheduled_idx" ON "messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_uq" ON "notifications" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("sub_account_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_tenant_uq" ON "workflow_runs" USING btree ("sub_account_id","id");--> statement-breakpoint
CREATE INDEX "workflow_runs_due_idx" ON "workflow_runs" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_contact_idx" ON "workflow_runs" USING btree ("sub_account_id","contact_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_tenant_uq" ON "workflows" USING btree ("sub_account_id","id");