import { uuid } from 'drizzle-orm/pg-core';
import { subAccounts } from './platform';

/**
 * Every business-owned table carries `sub_account_id`. Row level security
 * policies (see drizzle/*_security.sql) filter on this column, and composite
 * foreign keys (sub_account_id, x_id) stop a row in one business from pointing
 * at a row in another.
 */
export const subAccountId = () =>
  uuid('sub_account_id').notNull().references(() => subAccounts.id, { onDelete: 'cascade' });
