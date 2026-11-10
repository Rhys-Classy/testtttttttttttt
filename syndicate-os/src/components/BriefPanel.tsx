"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { ACCENTS } from "../lib/mock-data";
import type { BusinessBrief } from "../lib/types";
import { Drawer, DrawerHeader, drawerButton } from "./Drawer";

interface BriefPanelProps {
  open: boolean;
  brief: BusinessBrief;
  onSave: (brief: BusinessBrief) => void;
  onClose: () => void;
}

interface Field {
  key: keyof BusinessBrief;
  label: string;
  hint: string;
  placeholder: string;
  /** 1 renders a single-line input, more a text area. */
  rows: number;
  limit: number;
  required?: boolean;
}

const FIELDS: readonly Field[] = [
  {
    key: "name",
    label: "Business_name",
    hint: "",
    placeholder: "e.g. Northside Plumbing",
    rows: 1,
    limit: 80,
    required: true,
  },
  {
    key: "offer",
    label: "What_you_sell",
    hint: "Products or services, in plain words.",
    placeholder: "e.g. Blocked drains, hot water systems and bathroom plumbing for homes",
    rows: 3,
    limit: 600,
    required: true,
  },
  {
    key: "area",
    label: "Where_you_work",
    hint: "Town, region, or online. Sets the spelling and local references.",
    placeholder: "e.g. Northern suburbs of Brisbane",
    rows: 1,
    limit: 120,
  },
  {
    key: "customer",
    label: "Ideal_customer",
    hint: "Who you most want more of.",
    placeholder: "e.g. Homeowners in older houses who want it fixed properly the first time",
    rows: 2,
    limit: 400,
  },
  {
    key: "edge",
    label: "Why_they_choose_you",
    hint: "What you do better or differently. Only what is true.",
    placeholder: "e.g. Same-day callouts, upfront fixed quotes",
    rows: 2,
    limit: 400,
  },
  {
    key: "tone",
    label: "Tone_of_voice",
    hint: "How you sound to customers.",
    placeholder: "e.g. Friendly, straight-talking, no jargon",
    rows: 2,
    limit: 300,
  },
  {
    key: "facts",
    label: "Facts_the_crew_can_use",
    hint: "Prices, phone, website, guarantees, years in business. Anything not written here comes back as a [PLACEHOLDER] for you to fill in.",
    placeholder: "e.g. Phone 07 5550 0000. Callout fee $99. 12-month workmanship guarantee.",
    rows: 4,
    limit: 1500,
  },
];

const INPUT =
  "w-full rounded-none border border-line bg-void px-3 py-2 font-sans text-base leading-6 text-ink outline-none placeholder:text-mute/50 focus:border-accent md:text-sm";

function BriefForm({ brief, onSave, onClose }: Omit<BriefPanelProps, "open">) {
  const [draft, setDraft] = useState(brief);

  const ready = draft.name.trim() !== "" && draft.offer.trim() !== "";
  const changed = FIELDS.some(({ key }) => draft[key].trim() !== brief[key].trim());

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    const tidy = { ...draft };
    for (const { key } of FIELDS) tidy[key] = draft[key].trim();
    onSave(tidy);
    onClose();
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader
        titleId="brief-title"
        eyebrow="Business brief"
        title={draft.name.trim() || "WHO_DO_WE_WORK_FOR"}
        closeLabel="Close brief"
        onClose={onClose}
      />

      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
        <p className="text-sm leading-6 text-ink/85">
          This is everything the crew knows about the business. Every job is written from it, and
          operatives are told never to make up a fact that is not here.
        </p>
        {FIELDS.map((field) => {
          const id = `brief-${field.key}`;
          const shared = {
            id,
            value: draft[field.key],
            placeholder: field.placeholder,
            maxLength: field.limit,
            required: field.required,
            "aria-describedby": field.hint ? `${id}-hint` : undefined,
            className: INPUT,
          };
          return (
            <div key={field.key}>
              <label
                htmlFor={id}
                className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-accent"
              >
                {field.label}
                {field.required && <span className="text-mute"> (needed)</span>}
              </label>
              {field.hint && (
                <p id={`${id}-hint`} className="mt-1 text-xs leading-5 text-mute">
                  {field.hint}
                </p>
              )}
              <div className="mt-2">
                {field.rows === 1 ? (
                  <input
                    {...shared}
                    autoComplete="off"
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  />
                ) : (
                  <textarea
                    {...shared}
                    rows={field.rows}
                    onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
          {ready ? "Used on every job from now on" : "Name and what you sell are needed"}
        </p>
        <button type="submit" disabled={!ready || !changed} className={drawerButton.solid}>
          <Save aria-hidden className="size-3.5" />
          Save brief
        </button>
      </footer>
    </form>
  );
}

/** Where the operator tells the crew who they work for. */
export function BriefPanel({ open, ...form }: BriefPanelProps) {
  return (
    <Drawer open={open} onClose={form.onClose} labelledBy="brief-title" accent={ACCENTS.cyan.hex}>
      {/* Mounted on open, so the form always starts from the brief on file. */}
      <BriefForm {...form} />
    </Drawer>
  );
}
