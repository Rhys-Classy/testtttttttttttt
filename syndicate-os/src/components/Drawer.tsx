"use client";

import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Id of the heading that names the dialog. */
  labelledBy: string;
  /** Hex colour for the edge, glow and highlights inside. */
  accent: string;
  /** Wider panel, for reading long text. */
  wide?: boolean;
  children: ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function Panel({ onClose, labelledBy, accent, wide, children }: Omit<DrawerProps, "open">) {
  const panelRef = useRef<HTMLElement>(null);

  // Take focus on open, hand it back to whatever opened the drawer on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => opener?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    // Keep Tab inside the drawer while it is open.
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <motion.aside
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onKeyDown={handleKeyDown}
      style={{ "--accent": accent } as CSSProperties}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
      // The env() padding keeps the header and footer clear of a phone's system bars.
      className={cn(
        "absolute inset-y-0 right-0 flex w-full flex-col border-l border-accent bg-panel pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)] shadow-[-28px_0_70px_-30px_var(--accent)]",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      {children}
    </motion.aside>
  );
}

/** A panel that slides in from the right over a dimmed page. One at a time. */
export function Drawer({ open, onClose, ...panel }: DrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <div key="drawer" className="fixed inset-0 z-50">
          <motion.div
            aria-hidden
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 bg-void/75 backdrop-blur-[2px]"
          />
          <Panel onClose={onClose} {...panel} />
        </div>
      )}
    </AnimatePresence>
  );
}

interface DrawerHeaderProps {
  eyebrow: ReactNode;
  title: ReactNode;
  titleId: string;
  closeLabel: string;
  onClose: () => void;
}

export function DrawerHeader({ eyebrow, title, titleId, closeLabel, onClose }: DrawerHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-mute">{eyebrow}</p>
        <h2 id={titleId} className="mt-1 font-mono text-2xl font-bold tracking-tight text-accent [overflow-wrap:anywhere]">
          {title}
        </h2>
      </div>
      <button
        type="button"
        data-autofocus
        onClick={onClose}
        aria-label={closeLabel}
        className="grid size-9 shrink-0 place-items-center rounded-none border border-line text-mute transition-colors duration-75 hover:border-accent hover:text-accent"
      >
        <X aria-hidden className="size-4" />
      </button>
    </header>
  );
}

export function DrawerSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line px-5 py-4">
      <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-accent">
        {title}
      </h3>
      {hint && <p className="mt-1 text-xs leading-5 text-mute">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Shared look for the buttons along the bottom of a drawer. */
export const drawerButton = {
  quiet:
    "h-9 rounded-none border border-line px-4 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink transition-colors duration-75 hover:border-accent hover:text-accent",
  solid:
    "flex h-9 items-center gap-2 rounded-none border border-accent bg-accent px-4 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-void transition-colors duration-75 hover:bg-transparent hover:text-accent disabled:border-line disabled:bg-transparent disabled:text-mute",
};
