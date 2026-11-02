// Ids must be unique within a project and stable across saves. Uses crypto.randomUUID
// where available (Electron, modern browsers, Node 19+), with a fallback for old runtimes.

let counter = 0;

export function newId(prefix = ''): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID
    ? g.crypto.randomUUID()
    : `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}
