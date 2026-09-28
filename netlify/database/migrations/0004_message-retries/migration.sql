-- Generated from drizzle/0004_message_retries.sql by scripts/netlify-migrations.mjs. Do not edit.
ALTER TABLE "messages" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;