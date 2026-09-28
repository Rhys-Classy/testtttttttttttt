import { bigint, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Primary key used by every table. */
export const pk = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Money is always stored as integer cents. */
export const cents = (name: string) => bigint(name, { mode: 'number' });

export const customFields = () =>
  jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({});

export const tags = () => text('tags').array().notNull().default([]);

export type Address = {
  line1?: string;
  line2?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  country?: string;
};
