import { sql, type SQL } from 'drizzle-orm';

/**
 * Drizzle expands JS arrays in sql`` into ($1, $2, ...). For `= any(...)` we want a
 * single array parameter instead, so pass a Postgres array literal and cast it.
 */
export function pgArray(values: readonly string[], type: 'uuid' | 'text' = 'uuid'): SQL {
  const literal = `{${values.map((v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`).join(',')}}`;
  return type === 'uuid' ? sql`${literal}::uuid[]` : sql`${literal}::text[]`;
}
