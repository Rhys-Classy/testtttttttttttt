"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { cn } from "../lib/cn";

interface GlitchTextProps {
  children: ReactNode;
  className?: string;
  /** Also glitch on an irregular timer, not just on hover. */
  ambient?: boolean;
  /** Glitch once whenever this value changes. */
  trigger?: string | number;
}

const FRAMES = [0, 0.2, 0.4, 0.6, 0.8, 1];

/** Hold each keyframe, then jump to the next: a glitch should snap, not glide. */
const snap = (progress: number) => (progress < 1 ? 0 : 1);

const spread = (range: number) => (Math.random() - 0.5) * range;

/** A random horizontal band of the text, as a clip-path. */
function slice(): string {
  const top = Math.random() * 70;
  const height = 12 + Math.random() * 30;
  return `inset(${top.toFixed(1)}% 0 ${Math.max(0, 100 - top - height).toFixed(1)}% 0)`;
}

/**
 * Text that tears on hover: the body skews and flickers while a pink and a
 * cyan ghost slide out from behind it in random slices. Every burst is rolled
 * fresh, so no two look alike.
 */
export function GlitchText({ children, className, ambient = false, trigger }: GlitchTextProps) {
  const body = useAnimationControls();
  const pinkGhost = useAnimationControls();
  const cyanGhost = useAnimationControls();
  const reduceMotion = useReducedMotion();

  const fire = useCallback(() => {
    if (reduceMotion) return;
    const transition = {
      duration: 0.26 + Math.random() * 0.2,
      times: FRAMES,
      ease: snap,
    };
    void body.start({
      skewX: [0, spread(26), spread(8), spread(18), spread(6), 0],
      x: [0, spread(6), spread(3), spread(5), spread(2), 0],
      opacity: [1, 0.55 + Math.random() * 0.3, 1, 0.7 + Math.random() * 0.2, 0.9, 1],
      transition,
    });
    void pinkGhost.start({
      opacity: [0, 0.9, 0.5, 0.85, 0.3, 0],
      x: [0, -3 + spread(8), spread(6), -2 + spread(8), spread(4), 0],
      clipPath: [slice(), slice(), slice(), slice(), slice(), slice()],
      transition,
    });
    void cyanGhost.start({
      opacity: [0, 0.8, 0.6, 0.9, 0.3, 0],
      x: [0, 3 + spread(8), spread(6), 2 + spread(8), spread(4), 0],
      clipPath: [slice(), slice(), slice(), slice(), slice(), slice()],
      transition,
    });
  }, [body, pinkGhost, cyanGhost, reduceMotion]);

  useEffect(() => {
    if (!ambient || reduceMotion) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          fire();
          schedule();
        },
        3500 + Math.random() * 6000,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [ambient, reduceMotion, fire]);

  const lastTrigger = useRef(trigger);
  useEffect(() => {
    if (lastTrigger.current === trigger) return;
    lastTrigger.current = trigger;
    fire();
  }, [trigger, fire]);

  return (
    <motion.span
      className={cn("relative inline-block", className)}
      animate={body}
      onHoverStart={fire}
    >
      {children}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 text-pink mix-blend-screen"
        initial={{ opacity: 0 }}
        animate={pinkGhost}
      >
        {children}
      </motion.span>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 text-cyan mix-blend-screen"
        initial={{ opacity: 0 }}
        animate={cyanGhost}
      >
        {children}
      </motion.span>
    </motion.span>
  );
}
