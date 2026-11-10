"use client";

import { useState, type CSSProperties } from "react";

const LINES = [
  "mounting operative registry",
  "decrypting directive queue",
  "linking feed",
  "handing control to operator",
];

/**
 * Two-second power-on screen. The timing is pure CSS, so it clears itself even
 * if scripts are slow to load; a click skips it. Decorative, hidden from
 * assistive tech, and not shown at all with reduced motion.
 */
export function BootOverlay() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      aria-hidden
      onClick={() => setDismissed(true)}
      onAnimationEnd={(event) => {
        if (event.animationName === "boot-out") setDismissed(true);
      }}
      className="boot-overlay fixed inset-0 z-[70] grid cursor-pointer place-items-center bg-void px-6"
    >
      <div className="w-full max-w-md font-mono">
        <p className="glitch-anim text-3xl font-bold tracking-tight md:text-4xl">
          SYNDICATE<span className="text-pink">.OS</span>
        </p>
        <ul className="mt-6 space-y-1 text-xs text-mute md:text-sm">
          {LINES.map((line, index) => (
            <li
              key={line}
              className="boot-line flex justify-between gap-4"
              style={{ "--i": index } as CSSProperties}
            >
              <span>&gt; {line}</span>
              <span className="text-acid">OK</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 h-1 bg-line">
          <div className="boot-bar h-full bg-pink" />
        </div>
        <p className="mt-3 text-[10px] uppercase tracking-[0.25em] text-mute">click to skip</p>
      </div>
    </div>
  );
}
