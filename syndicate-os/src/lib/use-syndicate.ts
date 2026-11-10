"use client";

import { useEffect, useMemo, useReducer } from "react";
import { INITIAL_STATE, reducer } from "./engine";
import { stamp } from "./format";
import { AGENT_IDS } from "./mock-data";
import type { AgentConfig, AgentId, AgentStatus, Rolls } from "./types";

const TICK_MS = 1000;
const BOOT_DELAY_MS = 400;

function roll(): Rolls {
  const rolls = {} as Record<AgentId, readonly [number, number, number]>;
  for (const id of AGENT_IDS) rolls[id] = [Math.random(), Math.random(), Math.random()];
  return rolls;
}

/**
 * Owns the dashboard state and the clock that drives it. The first render is
 * the fixed mock data; the simulation only starts ticking once mounted in the
 * browser, so the server-rendered page and the first client render match.
 */
export function useSyndicate() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  useEffect(() => {
    const bootTimer = setTimeout(() => dispatch({ type: "BOOT", ts: stamp() }), BOOT_DELAY_MS);
    const ticker = setInterval(
      () => dispatch({ type: "TICK", ts: stamp(), rolls: roll() }),
      TICK_MS,
    );
    return () => {
      clearTimeout(bootTimer);
      clearInterval(ticker);
    };
  }, []);

  const actions = useMemo(
    () => ({
      toggleDeploy: (id: AgentId) => dispatch({ type: "TOGGLE_DEPLOY", id, ts: stamp() }),
      setStatus: (id: AgentId, status: AgentStatus) =>
        dispatch({ type: "SET_STATUS", id, status, ts: stamp() }),
      deployAll: () => dispatch({ type: "SET_ALL", status: "active", ts: stamp() }),
      recallAll: () => dispatch({ type: "SET_ALL", status: "idle", ts: stamp() }),
      patchConfig: (id: AgentId, patch: Partial<AgentConfig>) =>
        dispatch({ type: "PATCH_CONFIG", id, patch, ts: stamp() }),
      assign: (id: AgentId, text: string) => dispatch({ type: "ASSIGN", id, text, ts: stamp() }),
      command: (raw: string) => dispatch({ type: "COMMAND", raw, ts: stamp() }),
      clearLog: () => dispatch({ type: "CLEAR_LOG", ts: stamp() }),
    }),
    [],
  );

  return { state, actions };
}

export type SyndicateActions = ReturnType<typeof useSyndicate>["actions"];
