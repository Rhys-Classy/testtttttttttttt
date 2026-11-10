"use client";

import { useRef, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import { ACCENTS, PROFILES } from "../lib/mock-data";
import type { AgentId } from "../lib/types";
import { Drawer, DrawerHeader, drawerButton } from "./Drawer";

/** What the reader shows: a finished piece from the vault, or a job still being written. */
export interface ReaderView {
  agentId: AgentId;
  title: string;
  body: string;
  /** One line under the title: word count, date, or what is happening. */
  meta: string;
  /** True while Claude is still writing this. */
  writing: boolean;
  truncated: boolean;
  /** Set for pieces that are in the vault and can be removed. */
  deliverableId: string | null;
}

interface DeliverablePanelProps {
  view: ReaderView | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}

function Reader({ view, onClose, onDelete }: DeliverablePanelProps & { view: ReaderView }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"no" | "yes" | "selected">("no");
  const [confirming, setConfirming] = useState(false);
  const profile = PROFILES[view.agentId];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${view.title}\n\n${view.body}`);
      setCopied("yes");
    } catch {
      // Some app views refuse clipboard writes. Select the text so Ctrl+C still works.
      if (bodyRef.current) window.getSelection()?.selectAllChildren(bodyRef.current);
      setCopied("selected");
    }
    setTimeout(() => setCopied("no"), 2500);
  };

  return (
    <>
      <DrawerHeader
        titleId="reader-title"
        eyebrow={
          <>
            <span className="text-accent">{view.agentId}</span> <span aria-hidden>{"//"}</span>{" "}
            {profile.role} <span aria-hidden>{"//"}</span> {view.meta}
          </>
        }
        title={view.title}
        closeLabel="Close reader"
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5" tabIndex={0}>
        {view.truncated && (
          <p className="mb-4 border border-pink/50 bg-pink/10 px-3 py-2 text-xs leading-5 text-ink">
            This piece hit the length limit and stops early. Ask for less in one job to get it whole.
          </p>
        )}
        <div
          ref={bodyRef}
          className="max-w-[68ch] whitespace-pre-wrap font-sans text-[15px] leading-7 text-ink [overflow-wrap:anywhere]"
        >
          {view.body || <span className="text-mute">Thinking it through. The first words usually land within a minute.</span>}
          {view.writing && (
            <span
              aria-hidden
              className="ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[0.15em] animate-blink bg-accent"
            />
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        {view.deliverableId && !view.writing ? (
          <button
            type="button"
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              onDelete(view.deliverableId as string);
              onClose();
            }}
            onBlur={() => setConfirming(false)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-none border px-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] transition-colors duration-75",
              confirming
                ? "border-pink bg-pink text-void"
                : "border-line text-mute hover:border-pink hover:text-pink",
            )}
          >
            <Trash2 aria-hidden className="size-3.5" />
            {confirming ? "Confirm delete" : "Delete"}
          </button>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
            {view.writing ? "Still writing" : "Not yet in the vault"}
          </p>
        )}
        <button
          type="button"
          onClick={copy}
          disabled={!view.body}
          aria-live="polite"
          className={drawerButton.solid}
        >
          {copied === "yes" ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
          {copied === "yes" ? "Copied" : copied === "selected" ? "Selected: press Ctrl+C" : "Copy all"}
        </button>
      </footer>
    </>
  );
}

/** Full-height reader for one piece of work, finished or still streaming in. */
export function DeliverablePanel(props: DeliverablePanelProps) {
  const { view, onClose } = props;
  const accent = view ? ACCENTS[PROFILES[view.agentId].accent].hex : ACCENTS.cyan.hex;
  return (
    <Drawer open={view !== null} onClose={onClose} labelledBy="reader-title" accent={accent} wide>
      {view && <Reader {...props} view={view} />}
    </Drawer>
  );
}
