"use client";

import { useCallback, useEffect, useRef, type Dispatch } from "react";
import { currentDirective } from "./engine";
import { stamp } from "./format";
import { hasHost, isFailure, type DocSnapshot, type HostDb, type SampleFn } from "./host";
import { buildPrompt, countWords, splitTitle } from "./live";
import { createLocalDb } from "./local-db";
import { AGENT_IDS, PROFILES } from "./mock-data";
import {
  connectionLabel,
  createSample,
  loadConnection,
  saveConnection,
  type Connection,
} from "./providers";
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

/** The brief built into this copy of the app, used until the operator saves their own. */
function bundledBrief(): BusinessBrief | null {
  const bundled = window.__SYNDICATE_BRIEF__;
  if (typeof bundled !== "object" || bundled === null) return null;
  const brief = toBrief(bundled as Record<string, unknown>);
  return brief.name ? brief : null;
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

/** Follow the stored brief and the stored work. Returns the function that stops following. */
function watchStore(db: HostDb, dispatch: Dispatch<SyndicateAction>): () => void {
  const patience = setTimeout(() => {
    dispatch({
      type: "VAULT_NOTE",
      note: "The vault has not answered yet, so saved work may be missing from this list for now.",
    });
  }, VAULT_PATIENCE_MS);

  const stops = [
    db.doc(BRIEF_PATH).onSnapshot(
      (snap) => {
        const data = snap.data();
        const brief = snap.exists && data ? toBrief(data) : bundledBrief();
        if (brief) dispatch({ type: "BRIEF_SET", brief, ts: stamp(), announce: false });
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
  ];

  return () => {
    clearTimeout(patience);
    for (const stop of stops) stop();
  };
}

/**
 * The side of live mode that touches the outside world: it finds something to
 * do the thinking, sends each deployed operative's job to it, streams the
 * draft back into the dashboard, and files finished work.
 *
 * There are two ways to get a model. Opened through Claude, the hosting page
 * supplies one along with storage. Anywhere else, the operator connects their
 * own (any API, or a model running on this computer) and work is filed in
 * this browser. With neither, the dashboard stays in its scripted demo.
 */
export function useLiveOps(state: SyndicateState, dispatch: Dispatch<SyndicateAction>) {
  const sampleRef = useRef<SampleFn | null>(null);
  const dbRef = useRef<HostDb | null>(null);
  /** Stops following the browser's own store, when that is the one in use. */
  const stopLocalWatch = useRef<(() => void) | null>(null);
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

  // Opened through Claude: ask the host for a model and for storage, once.
  useEffect(() => {
    // The demo build never asks, so it can never go live.
    const host = hasHost() ? window.claude : undefined;
    if (!host) return;

    let cancelled = false;
    let stopWatch: (() => void) | undefined;

    Promise.all([host.use("sample"), host.use("db")])
      .then(([sample, db]) => {
        if (cancelled) return;
        if (!sample) {
          dispatch({ type: "LINK_FAILED", ts: stamp() });
          return;
        }
        sampleRef.current = sample;
        dbRef.current = db;
        dispatch({
          type: "GO_LIVE",
          ts: stamp(),
          persistent: db !== null,
          label: "CLAUDE_UPLINK",
        });
        if (db) stopWatch = watchStore(db, dispatch);
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "LINK_FAILED", ts: stamp() });
      });

    return () => {
      cancelled = true;
      stopWatch?.();
    };
  }, [dispatch]);

  // Send each working operative's job to the model exactly once, and stop the
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
          const known = isFailure(error) ? error : null;
          const code = known?.code ?? "upstream_error";
          // Stopping a job ourselves is not a failure to report.
          if (controller.signal.aborted || code === "cancelled") return;
          dispatch({
            type: "JOB_FAILED",
            id,
            run,
            code,
            detail: known?.message ?? "",
            ts: stamp(),
          });
        },
      );
    }
  }, [state.agents, state.mode, state.brief, state.engine, dispatch]);

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
      stopLocalWatch.current?.();
    };
  }, []);

  /** Start using the operator's own model, swap it for another, or (null) let it go. */
  const connect = useCallback(
    (connection: Connection | null, remember = true) => {
      if (hasHost()) return; // the hosting page already supplies the model
      if (remember) saveConnection(connection);

      // Whatever is in flight was asked of the old model. Stop it; a job still
      // assigned is sent again to the new one.
      for (const call of calls.current.values()) call.controller.abort();
      calls.current.clear();

      if (!connection) {
        sampleRef.current = null;
        dispatch({ type: "GO_SIM", ts: stamp() });
        return;
      }

      sampleRef.current = createSample(connection);
      if (!dbRef.current) {
        const db = createLocalDb();
        dbRef.current = db;
        stopLocalWatch.current = watchStore(db, dispatch);
      }
      dispatch({
        type: "GO_LIVE",
        ts: stamp(),
        persistent: true,
        label: connectionLabel(connection),
      });
    },
    [dispatch],
  );

  /** At start-up: pick the saved model back up, if the operator connected one before. */
  const restore = useCallback(() => {
    if (hasHost()) return;
    const saved = loadConnection();
    if (saved) connect(saved, false);
  }, [connect]);

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

  return { saveBrief, removeDeliverable, connect, restore };
}
