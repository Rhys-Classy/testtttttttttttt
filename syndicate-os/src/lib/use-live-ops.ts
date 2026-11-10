"use client";

import { useCallback, useEffect, useRef, type Dispatch } from "react";
import { currentDirective } from "./engine";
import { stamp } from "./format";
import type { DocSnapshot, HostDb, SampleFn } from "./host";
import { buildPrompt, countWords, splitTitle } from "./live";
import { AGENT_IDS, PROFILES } from "./mock-data";
import type {
  AgentId,
  BusinessBrief,
  Deliverable,
  SyndicateAction,
  SyndicateState,
} from "./types";

const BRIEF_PATH = "brief/main";
const VAULT_PATH = "deliverables";
/** Most recent pieces kept on screen. */
const VAULT_WINDOW = 200;
/** How long the vault may stay silent before the page says so, in ms. */
const VAULT_PATIENCE_MS = 10_000;
/** Repaint a streaming draft at most this often, in ms. */
const PAINT_EVERY_MS = 120;

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Stored documents are data other people may have written: take only what fits. */
function toBrief(data: Record<string, unknown>): BusinessBrief {
  return {
    name: text(data.name),
    offer: text(data.offer),
    area: text(data.area),
    customer: text(data.customer),
    edge: text(data.edge),
    tone: text(data.tone),
    facts: text(data.facts),
  };
}

function toDeliverable(doc: DocSnapshot): Deliverable[] {
  const data = doc.data();
  if (!doc.exists || !data) return [];
  const agentId = AGENT_IDS.find((id) => id === data.agentId);
  const body = text(data.body);
  if (!agentId || !body) return [];
  return [
    {
      id: doc.id,
      agentId,
      title: text(data.title) || "Untitled",
      directive: text(data.directive),
      body,
      words: typeof data.words === "number" ? data.words : countWords(body),
      createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
      truncated: data.truncated === true,
      saved: true,
    },
  ];
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The side of live mode that touches the outside world. It asks the hosting
 * page for Claude and for storage, sends each deployed operative's job to
 * Claude, streams the draft back into the dashboard, and files finished work.
 *
 * Outside a Claude-hosted page none of this runs and the dashboard stays in
 * its scripted demo.
 */
export function useLiveOps(state: SyndicateState, dispatch: Dispatch<SyndicateAction>) {
  const sampleRef = useRef<SampleFn | null>(null);
  const dbRef = useRef<HostDb | null>(null);
  /**
   * The call made for each operative's current job. An entry is only ever
   * replaced by a newer job or removed when the operative stops working. It is
   * deliberately NOT removed when its call finishes: effects run a beat after
   * the state they belong to, so one may still be looking at the old job, and
   * a missing entry would read as "nobody is on this" and send it twice.
   */
  const calls = useRef(new Map<AgentId, { run: number; controller: AbortController }>());
  /** Pieces already handed to the vault, so each is written once. */
  const filing = useRef(new Set<string>());

  // Ask the host for Claude and for storage, once.
  useEffect(() => {
    const host = window.claude;
    if (!host || typeof host.use !== "function") return;

    let cancelled = false;
    let patience: ReturnType<typeof setTimeout> | undefined;
    const stops: (() => void)[] = [];

    Promise.all([host.use("sample"), host.use("db")])
      .then(([sample, db]) => {
        if (cancelled) return;
        if (!sample) {
          dispatch({ type: "LINK_FAILED", ts: stamp() });
          return;
        }
        sampleRef.current = sample;
        dbRef.current = db;
        dispatch({ type: "GO_LIVE", ts: stamp(), persistent: db !== null });
        if (!db) return;

        patience = setTimeout(() => {
          dispatch({
            type: "VAULT_NOTE",
            note: "The vault has not answered yet, so saved work may be missing from this list for now.",
          });
        }, VAULT_PATIENCE_MS);

        stops.push(
          db.doc(BRIEF_PATH).onSnapshot(
            (snap) => {
              const data = snap.data();
              if (snap.exists && data) {
                dispatch({ type: "BRIEF_SET", brief: toBrief(data), ts: stamp(), announce: false });
              }
            },
            () => undefined,
          ),
          db
            .collection(VAULT_PATH)
            .orderBy("createdAt", "desc")
            .limit(VAULT_WINDOW)
            .onSnapshot(
              (snap) => {
                if (!snap.metadata.fromCache) {
                  clearTimeout(patience);
                  dispatch({ type: "VAULT_NOTE", note: null });
                }
                dispatch({ type: "VAULT_SYNC", deliverables: snap.docs.flatMap(toDeliverable) });
              },
              () => {
                clearTimeout(patience);
                dispatch({
                  type: "VAULT_NOTE",
                  note: "The vault stopped responding. New work stays on this page until it is closed, so copy what you want to keep.",
                });
              },
            ),
        );
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "LINK_FAILED", ts: stamp() });
      });

    return () => {
      cancelled = true;
      clearTimeout(patience);
      for (const stop of stops) stop();
    };
  }, [dispatch]);

  // Send each working operative's job to Claude exactly once, and stop the
  // call of any operative that has been pulled off its job.
  useEffect(() => {
    const sample = sampleRef.current;
    if (state.mode !== "live" || !sample) return;

    for (const agent of state.agents) {
      const made = calls.current.get(agent.id);
      if (agent.status !== "active") {
        if (made) {
          made.controller.abort();
          calls.current.delete(agent.id);
        }
        continue;
      }
      // This job has already been sent, whether or not the answer is back yet.
      if (made && made.run >= agent.run) continue;
      made?.controller.abort();

      const { id, run } = agent;
      const controller = new AbortController();
      calls.current.set(id, { run, controller });
      const directive = currentDirective(agent, "live");
      let lastPaint = 0;

      sample(buildPrompt(PROFILES[id], state.brief, directive), {
        signal: controller.signal,
        // Running a job twice should give a second take, not a replay of the first.
        cache: false,
        onText: (update) => {
          const now = Date.now();
          if (now - lastPaint < PAINT_EVERY_MS) return;
          lastPaint = now;
          dispatch({ type: "JOB_TEXT", id, run, text: update.text });
        },
      }).then(
        (result) => {
          if (controller.signal.aborted) return;
          const { title, body } = splitTitle(result.text, directive.text);
          dispatch({
            type: "JOB_DONE",
            id,
            run,
            ts: stamp(),
            deliverable: {
              id: newId(),
              agentId: id,
              title,
              directive: directive.text,
              body,
              words: countWords(body),
              createdAt: Date.now(),
              truncated: result.truncated,
              saved: false,
            },
          });
        },
        (error: unknown) => {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? String(error.code)
              : "upstream_error";
          // Stopping a job ourselves is not a failure to report.
          if (controller.signal.aborted || code === "cancelled") return;
          dispatch({ type: "JOB_FAILED", id, run, code, ts: stamp() });
        },
      );
    }
  }, [state.agents, state.mode, state.brief, dispatch]);

  // File finished work. Driven by the state, not by the call that produced it,
  // so only pieces the dashboard actually accepted are ever stored.
  useEffect(() => {
    const db = dbRef.current;
    if (!db) return;
    for (const item of state.deliverables) {
      if (item.saved || filing.current.has(item.id)) continue;
      // Marked for good, even on failure: a write that fails is reported, never retried in a loop.
      filing.current.add(item.id);
      db.collection(VAULT_PATH)
        .doc(item.id)
        .set({
          agentId: item.agentId,
          title: item.title,
          directive: item.directive,
          body: item.body,
          words: item.words,
          createdAt: item.createdAt,
          truncated: item.truncated,
        })
        .then(
          () => dispatch({ type: "DELIVERABLE_SAVED", id: item.id }),
          () =>
            dispatch({
              type: "VAULT_NOTE",
              note: "A piece could not be saved to the vault. It stays on this page until it is closed, so copy it now.",
            }),
        );
    }
  }, [state.deliverables, dispatch]);

  // Leaving the page: stop every call so no usage is spent on work nobody will see.
  useEffect(() => {
    const made = calls.current;
    return () => {
      for (const call of made.values()) call.controller.abort();
      made.clear();
    };
  }, []);

  const saveBrief = useCallback(
    (brief: BusinessBrief) => {
      dispatch({ type: "BRIEF_SET", brief, ts: stamp(), announce: true });
      dbRef.current
        ?.doc(BRIEF_PATH)
        .set({ ...brief })
        .catch(() =>
          dispatch({
            type: "VAULT_NOTE",
            note: "The brief could not be saved. It applies until this page is closed.",
          }),
        );
    },
    [dispatch],
  );

  const removeDeliverable = useCallback(
    (id: string) => {
      dispatch({ type: "DELIVERABLE_REMOVED", id, ts: stamp() });
      dbRef.current
        ?.collection(VAULT_PATH)
        .doc(id)
        .delete()
        .catch(() => undefined);
    },
    [dispatch],
  );

  return { saveBrief, removeDeliverable };
}
