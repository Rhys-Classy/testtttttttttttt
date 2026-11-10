"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { ArrowDownToLine, ChevronDown, ChevronUp, CornerDownLeft, Terminal, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import { COMMANDS } from "../lib/engine";
import { AGENT_IDS, PROFILES } from "../lib/mock-data";
import type { AccentKey, AgentId, LogEntry, LogLevel, LogSource } from "../lib/types";

interface TerminalLogProps {
  entries: readonly LogEntry[];
  onCommand: (raw: string) => void;
  onClear: () => void;
  /** Lets the page focus the prompt from a global shortcut. */
  inputRef: RefObject<HTMLInputElement | null>;
}

type Filter = "ALL" | AgentId | "SYSTEM";

const ACCENT_TEXT: Record<AccentKey, string> = {
  pink: "text-pink",
  cyan: "text-cyan",
  acid: "text-acid",
};

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "ALL", label: "ALL" },
  { value: "HYPE_BEAST", label: "HYPE" },
  { value: "THE_SHADOW", label: "SHADOW" },
  { value: "THE_FIXER", label: "FIXER" },
  { value: "THE_BANKER", label: "BANKER" },
  { value: "SYSTEM", label: "SYS" },
];

const LEVEL: Record<LogLevel, { tag: string | null; tagTone: string; text: string }> = {
  info: { tag: null, tagTone: "", text: "text-ink/85" },
  success: { tag: "[OK]", tagTone: "text-acid", text: "text-acid" },
  warn: { tag: "[!!]", tagTone: "text-pink", text: "text-ink" },
  error: { tag: "[ERR]", tagTone: "text-pink", text: "text-pink" },
  input: { tag: "$", tagTone: "text-acid", text: "text-ink" },
};

const HISTORY_LIMIT = 50;
/** How close to the bottom still counts as "following the feed", in pixels. */
const STICK_THRESHOLD = 24;

function sourceTone(source: LogSource): string {
  if (source === "SYSTEM") return "text-mute";
  if (source === "OPERATOR") return "text-ink";
  return ACCENT_TEXT[PROFILES[source].accent];
}

function matches(entry: LogEntry, filter: Filter): boolean {
  if (filter === "ALL") return true;
  if (filter === "SYSTEM") return entry.source === "SYSTEM" || entry.source === "OPERATOR";
  return entry.source === filter;
}

/** Complete the word being typed: a command first, then an operative. */
function complete(value: string): string {
  const parts = value.split(/\s+/);
  if (parts.length === 1) {
    const hits = COMMANDS.filter((command) => command.name.startsWith(parts[0].toLowerCase()));
    return hits.length === 1 ? `${hits[0].name} ` : value;
  }
  if (parts.length === 2 && parts[1]) {
    const names = [...AGENT_IDS.map((id) => id.toLowerCase()), "all"];
    const hits = names.filter((name) => name.includes(parts[1].toLowerCase()));
    return hits.length === 1 ? `${parts[0]} ${hits[0]} ` : value;
  }
  return value;
}

/**
 * The feed: every action any operative takes, plus a command line that drives
 * the same engine as the buttons. Follows the newest line unless you scroll up
 * to read; then it holds position and counts what you are missing.
 */
export function TerminalLog({ entries, onCommand, onClear, inputRef }: TerminalLogProps) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  /** Id of the newest entry when the reader scrolled away. Null while following. */
  const [heldAt, setHeldAt] = useState<number | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  const visible = entries.filter((entry) => matches(entry, filter));
  const newestId = entries.length > 0 ? entries[entries.length - 1].id : 0;
  const missed = heldAt === null ? 0 : visible.filter((entry) => entry.id > heldAt).length;
  const latest = entries[entries.length - 1];

  // Keep the newest line in view while following. Runs after every new entry.
  useEffect(() => {
    const box = boxRef.current;
    if (box && following.current) box.scrollTop = box.scrollHeight;
  }, [newestId, filter, collapsed]);

  const handleScroll = () => {
    const box = boxRef.current;
    if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < STICK_THRESHOLD;
    following.current = atBottom;
    setHeldAt((current) => (atBottom ? null : (current ?? newestId)));
  };

  const jumpToLatest = () => {
    const box = boxRef.current;
    following.current = true;
    setHeldAt(null);
    if (box) box.scrollTop = box.scrollHeight;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const command = draft.trim();
    if (!command) return;
    onCommand(command);
    setHistory((current) => [...current, command].slice(-HISTORY_LIMIT));
    setHistoryIndex(null);
    setDraft("");
    setCollapsed(false);
    jumpToLatest();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" && history.length > 0) {
      event.preventDefault();
      const index = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(index);
      setDraft(history[index]);
    } else if (event.key === "ArrowDown" && historyIndex !== null) {
      event.preventDefault();
      const index = historyIndex + 1;
      if (index >= history.length) {
        setHistoryIndex(null);
        setDraft("");
      } else {
        setHistoryIndex(index);
        setDraft(history[index]);
      }
    } else if (event.key === "Tab" && !event.shiftKey && draft.trim()) {
      // Only swallow Tab when there is something to complete; otherwise it moves focus as usual.
      const completed = complete(draft);
      if (completed !== draft) {
        event.preventDefault();
        setDraft(completed);
      }
    } else if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  };

  return (
    <section
      aria-label="Operations feed"
      className="relative z-20 shrink-0 border-t border-cyan/60 bg-panel shadow-[0_-18px_40px_-28px_var(--color-cyan)]"
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 md:gap-3 md:px-5">
        <Terminal aria-hidden className="size-3.5 shrink-0 text-cyan" />
        <h2 className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-ink">
          <span className="hidden sm:inline">Syndicate://</span>feed
        </h2>
        <span
          className={cn(
            "hidden shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] sm:flex",
            heldAt === null ? "text-acid" : "text-pink",
          )}
        >
          <span
            aria-hidden
            className={cn("size-1.5", heldAt === null ? "animate-pulse-dot bg-acid" : "bg-pink")}
          />
          {heldAt === null ? "Live" : "Held"}
        </span>

        <div
          role="group"
          aria-label="Filter the feed"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]"
        >
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "shrink-0 rounded-none border px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.15em] transition-colors duration-75",
                filter === value
                  ? "border-ink bg-ink text-void"
                  : "border-line text-mute hover:border-ink/60 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClear}
          aria-label="Flush the feed"
          className="grid size-7 shrink-0 place-items-center rounded-none border border-line text-mute transition-colors duration-75 hover:border-pink hover:text-pink"
        >
          <Trash2 aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-controls="syndicate-feed"
          aria-label={collapsed ? "Expand the feed" : "Collapse the feed"}
          className="grid size-7 shrink-0 place-items-center rounded-none border border-line text-mute transition-colors duration-75 hover:border-ink/60 hover:text-ink"
        >
          {collapsed ? (
            <ChevronUp aria-hidden className="size-3.5" />
          ) : (
            <ChevronDown aria-hidden className="size-3.5" />
          )}
        </button>
      </div>

      <div className="relative">
        {collapsed ? (
          <p className="truncate px-4 py-2 font-mono text-xs text-mute md:px-5">
            {latest ? (
              <>
                &gt; [{latest.ts}]{" "}
                <span className={cn("font-semibold", sourceTone(latest.source))}>{latest.source}</span>{" "}
                {latest.message}
              </>
            ) : (
              "> feed idle"
            )}
          </p>
        ) : (
          <div
            id="syndicate-feed"
            ref={boxRef}
            onScroll={handleScroll}
            role="log"
            aria-live="off"
            aria-label="Operative activity"
            tabIndex={0}
            className="h-28 overflow-y-auto overscroll-contain px-4 py-2 font-mono text-xs leading-5 sm:h-36 md:h-44 md:px-5 md:text-[13px]"
          >
            {visible.length === 0 ? (
              <p className="text-mute">&gt; nothing on this channel yet</p>
            ) : (
              <ol>
                {visible.map((entry) => {
                  const level = LEVEL[entry.level];
                  return (
                    // Hanging indent: wrapped lines tuck in under the timestamp, not the prompt.
                    <li
                      key={entry.id}
                      className="animate-log-in whitespace-pre-wrap break-words pl-[2ch] -indent-[2ch]"
                    >
                      <span className="select-none text-mute/70">&gt; </span>
                      <span className="text-mute">[{entry.ts}]</span>{" "}
                      <span className={cn("font-semibold", sourceTone(entry.source))}>
                        {entry.source}
                      </span>{" "}
                      {level.tag && <span className={level.tagTone}>{level.tag} </span>}
                      <span className={level.text}>{entry.message}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {!collapsed && missed > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-2 right-4 flex items-center gap-1.5 rounded-none border border-pink bg-void px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-pink transition-colors duration-75 hover:bg-pink hover:text-void"
          >
            <ArrowDownToLine aria-hidden className="size-3" />
            {missed} new
          </button>
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-line px-4 py-2 font-mono focus-within:bg-raised focus-within:shadow-[inset_2px_0_0_var(--color-acid)] md:px-5"
      >
        <label htmlFor="syndicate-prompt" className="shrink-0 text-xs text-acid md:text-[13px]">
          <span className="hidden sm:inline">operator@syndicate</span>
          <span className="text-mute">:~$</span>
          <span className="sr-only"> command</span>
        </label>
        <input
          id="syndicate-prompt"
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setHistoryIndex(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="type help"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={200}
          // 16px on phones stops iOS zooming the page when the field takes focus.
          className="min-w-0 flex-1 bg-transparent text-base text-ink caret-acid outline-none placeholder:text-mute/60 md:text-[13px]"
        />
        <button
          type="submit"
          aria-label="Run command"
          className="grid size-7 shrink-0 place-items-center rounded-none border border-line text-mute transition-colors duration-75 hover:border-acid hover:text-acid"
        >
          <CornerDownLeft aria-hidden className="size-3.5" />
        </button>
      </form>
    </section>
  );
}
