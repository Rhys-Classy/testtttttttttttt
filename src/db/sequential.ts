/**
 * Like Promise.all, but awaits one after another. A transaction is a single
 * connection, so queries on it must not overlap. Drizzle query builders are lazy,
 * so building them up front and awaiting in order is safe.
 */
export async function sequential<const T extends readonly PromiseLike<unknown>[]>(items: T): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const out: unknown[] = [];
  for (const item of items) out.push(await item);
  return out as { -readonly [K in keyof T]: Awaited<T[K]> };
}
