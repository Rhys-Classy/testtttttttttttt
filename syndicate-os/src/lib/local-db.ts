import type { CollectionRef, DocRef, DocSnapshot, HostDb } from "./host";

/**
 * The same small document store the hosting page offers, kept in this
 * browser's own storage. It lets the dashboard file work and remember the
 * brief when it runs outside Claude, without a second code path: everything
 * above this file talks to a HostDb and cannot tell the two apart.
 */

const PREFIX = "syndicate.db:";
const META = { fromCache: false, hasPendingWrites: false };

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function createLocalDb(storage: Storage = window.localStorage): HostDb {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  // Another tab or window of the same app changed something.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith(PREFIX)) notify();
  });

  const read = (path: string): Record<string, unknown> | undefined => {
    try {
      const raw = storage.getItem(PREFIX + path);
      const value: unknown = raw ? JSON.parse(raw) : undefined;
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };

  const snapshot = (path: string): DocSnapshot => {
    const data = read(path);
    return {
      id: path.slice(path.lastIndexOf("/") + 1),
      exists: data !== undefined,
      data: () => data,
      metadata: META,
    };
  };

  /** Deliver the current state once, shortly, then again on every change. */
  const subscribe = (fire: () => void) => {
    let open = true;
    const guarded = () => {
      if (open) fire();
    };
    listeners.add(guarded);
    setTimeout(guarded, 0);
    return () => {
      open = false;
      listeners.delete(guarded);
    };
  };

  const doc = (path: string): DocRef => ({
    // Async so a full or blocked store rejects like the hosted one, not throws.
    async set(data) {
      storage.setItem(PREFIX + path, JSON.stringify(data));
      notify();
    },
    async delete() {
      storage.removeItem(PREFIX + path);
      notify();
    },
    onSnapshot: (next) => subscribe(() => next(snapshot(path))),
  });

  /** Documents directly inside a collection, not ones nested further down. */
  const children = (collection: string): DocSnapshot[] => {
    const start = `${PREFIX}${collection}/`;
    const found: DocSnapshot[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(start) || key.slice(start.length).includes("/")) continue;
      found.push(snapshot(key.slice(PREFIX.length)));
    }
    return found;
  };

  const query = (
    collection: string,
    order?: { field: string; dir: "asc" | "desc" },
    max?: number,
  ): CollectionRef => {
    const run = () => {
      let docs = children(collection);
      if (order) {
        const sign = order.dir === "desc" ? -1 : 1;
        const key = (item: DocSnapshot) => item.data()?.[order.field];
        docs.sort((a, b) => {
          const x = key(a);
          const y = key(b);
          if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
          return String(x ?? "").localeCompare(String(y ?? "")) * sign;
        });
      }
      if (max !== undefined) docs = docs.slice(0, max);
      return { docs, metadata: META };
    };
    return {
      orderBy: (field, dir = "asc") => query(collection, { field, dir }, max),
      limit: (count) => query(collection, order, count),
      doc: (id) => doc(`${collection}/${id ?? newId()}`),
      onSnapshot: (next) => subscribe(() => next(run())),
    };
  };

  return { doc, collection: (path) => query(path) };
}
