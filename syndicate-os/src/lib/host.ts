/**
 * The slice of the hosting page's `window.claude` runtime that live mode uses.
 * It exists only when the dashboard is opened through Claude; anywhere else
 * `window.claude` is undefined and the dashboard runs its scripted demo.
 */

export interface SampleTextUpdate {
  /** The whole answer so far. */
  text: string;
  /** Only what was added since the last update. */
  delta: string;
}

export interface SampleOptions {
  onText?: (update: SampleTextUpdate) => void;
  signal?: AbortSignal;
  modelTier?: "default" | "complex" | "quick";
  /** False forces a fresh answer instead of replaying a recent identical one. */
  cache?: boolean;
}

export interface SampleResult {
  text: string;
  /** True when the answer hit the length limit and stops early. */
  truncated: boolean;
}

/** Ask Claude one memoryless question. Rejects with `{ code, message }`. */
export type SampleFn = (input: string, options?: SampleOptions) => Promise<SampleResult>;

export interface DbError {
  code: string;
  message: string;
}

export interface DocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}

export interface QuerySnapshot {
  docs: DocSnapshot[];
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}

export type Unsubscribe = () => void;

export interface DocRef {
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (snap: DocSnapshot) => void, error?: (e: DbError) => void): Unsubscribe;
}

export interface Query {
  orderBy(field: string, dir?: "asc" | "desc"): Query;
  limit(n: number): Query;
  onSnapshot(next: (snap: QuerySnapshot) => void, error?: (e: DbError) => void): Unsubscribe;
}

export interface CollectionRef extends Query {
  doc(id?: string): DocRef;
}

/** The page's own document store, kept across reloads. */
export interface HostDb {
  doc(path: string): DocRef;
  collection(path: string): CollectionRef;
}

interface Capabilities {
  sample: SampleFn;
  db: HostDb;
}

export interface HostRuntime {
  /** Resolves the capability, or null when this view cannot offer it. */
  use<K extends keyof Capabilities>(name: K): Promise<Capabilities[K] | null>;
}

declare global {
  interface Window {
    claude?: HostRuntime;
    /** Set by the demo build. The dashboard then never looks for a host and stays scripted. */
    __SYNDICATE_DEMO__?: boolean;
    /** Set by the build from brief.json: the business the crew works for until the operator changes it. */
    __SYNDICATE_BRIEF__?: unknown;
  }
}

/** The page's own failure shape, shared by every way of reaching a model. */
export interface ModelFailure {
  code: string;
  message: string;
}

export const failure = (code: string, message: string): ModelFailure => ({ code, message });

export function isFailure(value: unknown): value is ModelFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

/** True in the demo-only build, where nothing may go live whatever the page is opened in. */
export function isDemoBuild(): boolean {
  return typeof window !== "undefined" && window.__SYNDICATE_DEMO__ === true;
}

/** True when the page is running somewhere that might connect it to Claude. */
export function hasHost(): boolean {
  return (
    !isDemoBuild() && typeof window !== "undefined" && typeof window.claude?.use === "function"
  );
}
