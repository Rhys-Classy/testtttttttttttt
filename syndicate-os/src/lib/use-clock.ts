"use client";

import { useSyncExternalStore } from "react";
import { stamp } from "./format";

const subscribe = (notify: () => void) => {
  const timer = setInterval(notify, 1000);
  return () => clearInterval(timer);
};

const serverSnapshot = () => "--:--:--";

/** Local wall-clock time, updated every second. Placeholder until mounted in the browser. */
export function useClock(): string {
  return useSyncExternalStore(subscribe, stamp, serverSnapshot);
}
