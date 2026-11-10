"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Types `text` out when it changes. The first render shows the whole string,
 * so server-rendered text is never blank; only later changes animate.
 */
export function useTypewriter(text: string, charsPerStep = 2, stepMs = 16): string {
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState({ text, shown: text.length });

  // New text: restart from empty. Adjusting state during render avoids a flash of the old text.
  if (state.text !== text) setState({ text, shown: 0 });
  const shown = state.text === text ? state.shown : 0;

  useEffect(() => {
    if (shown >= text.length) return;
    const timer = setTimeout(() => {
      setState((current) =>
        current.text === text
          ? { text, shown: Math.min(text.length, current.shown + charsPerStep) }
          : current,
      );
    }, stepMs);
    return () => clearTimeout(timer);
  }, [shown, text, charsPerStep, stepMs]);

  return reduceMotion ? text : text.slice(0, shown);
}
