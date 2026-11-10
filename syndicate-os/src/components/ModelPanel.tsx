"use client";

import { useState, type FormEvent } from "react";
import { Plug, Search, Unplug } from "lucide-react";
import { cn } from "../lib/cn";
import { isFailure } from "../lib/host";
import { explainFailure } from "../lib/live";
import { ACCENTS } from "../lib/mock-data";
import {
  PRESETS,
  listModels,
  loadConnection,
  presetFor,
  type Connection,
} from "../lib/providers";
import { Drawer, DrawerHeader, DrawerSection, drawerButton } from "./Drawer";

interface ModelPanelProps {
  open: boolean;
  /** What is connected now, as shown in the header. Null when nothing is. */
  engine: string | null;
  onConnect: (connection: Connection) => void;
  onDisconnect: () => void;
  onClose: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "busy"; text: string }
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string };

const INPUT =
  "h-10 w-full min-w-0 rounded-none border border-line bg-void px-3 font-mono text-base text-ink outline-none placeholder:text-mute/50 focus:border-accent md:text-[13px]";
const LABEL = "font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-accent";

function ModelForm({ engine, onConnect, onDisconnect, onClose }: Omit<ModelPanelProps, "open">) {
  // Mounted when the panel opens, so reading the saved connection here is a one-off.
  const [saved] = useState(loadConnection);
  const [presetKey, setPresetKey] = useState(saved?.preset ?? PRESETS[0].key);
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [model, setModel] = useState(saved?.model ?? PRESETS[0].model);
  const [found, setFound] = useState<string[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const preset = presetFor(presetKey);
  const draft: Connection = {
    preset: preset.key,
    kind: preset.kind,
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
  };
  const hasAddress = draft.baseUrl !== "";
  const hasKey = !preset.needsKey || draft.apiKey !== "";
  const ready = hasAddress && hasKey && draft.model !== "";

  const choose = (key: string) => {
    const next = presetFor(key);
    setPresetKey(next.key);
    setBaseUrl(next.baseUrl);
    setModel(next.model);
    setFound(null);
    setStatus({ kind: "idle" });
  };

  const find = () => {
    // Ignored while a lookup is running. The button stays enabled so it keeps keyboard focus.
    if (status.kind === "busy") return;
    setStatus({ kind: "busy", text: "Asking for the list of models..." });
    listModels(draft).then(
      (ids) => {
        setFound(ids);
        if (ids.length === 0) {
          setStatus({
            kind: "error",
            text: preset.local
              ? "Connected, but no models are installed there yet. Download one in that program first."
              : "Connected, but the address returned no models. Type the model name in by hand.",
          });
          return;
        }
        if (!draft.model) setModel(ids[0]);
        setStatus({
          kind: "ok",
          text: `Connected. ${ids.length} ${ids.length === 1 ? "model" : "models"} found.`,
        });
      },
      (error: unknown) => {
        const known = isFailure(error) ? error : null;
        const { message } = explainFailure(known?.code ?? "upstream_error", known?.message);
        setFound(null);
        setStatus({ kind: "error", text: `${message[0].toUpperCase()}${message.slice(1)}.` });
      },
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    onConnect(draft);
    onClose();
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader
        titleId="model-title"
        eyebrow="Model"
        title={engine ?? "NOT_CONNECTED"}
        closeLabel="Close model settings"
        onClose={onClose}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <DrawerSection
          title="What does the thinking"
          hint="Pick any AI service you have a key for, or a model running on this computer. Change it whenever you like."
        >
          <div role="group" aria-label="Model source" className="grid grid-cols-2 gap-px bg-line p-px">
            {PRESETS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={option.key === preset.key}
                onClick={() => choose(option.key)}
                className={cn(
                  "rounded-none px-3 py-2.5 text-left transition-colors duration-75",
                  option.key === preset.key
                    ? "bg-accent text-void"
                    : "bg-panel text-ink hover:bg-raised",
                )}
              >
                <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.15em]">
                  {option.label}
                </span>
                <span
                  className={cn(
                    "mt-0.5 block text-xs",
                    option.key === preset.key ? "text-void/75" : "text-mute",
                  )}
                >
                  {option.blurb}
                </span>
              </button>
            ))}
          </div>
        </DrawerSection>

        <div className="space-y-4 border-b border-line px-5 py-4">
          <div>
            <label htmlFor="model-address" className={LABEL}>
              Address
            </label>
            <input
              id="model-address"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              className={cn(INPUT, "mt-2")}
            />
          </div>

          {!preset.local && (
            <div>
              <label htmlFor="model-key" className={LABEL}>
                API key{!preset.needsKey && <span className="text-mute"> (if it needs one)</span>}
              </label>
              <input
                id="model-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Paste the key here"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="model-key-note"
                className={cn(INPUT, "mt-2")}
              />
              <p id="model-key-note" className="mt-1.5 text-xs leading-5 text-mute">
                The key is sent only to the address above. It is kept in this browser on this
                computer and is not encrypted.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="model-name" className={LABEL}>
              Model
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="model-name"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Find models, or type a name"
                autoComplete="off"
                spellCheck={false}
                className={INPUT}
              />
              <button
                type="button"
                onClick={find}
                disabled={!hasAddress || !hasKey}
                aria-busy={status.kind === "busy"}
                className={cn(drawerButton.quiet, "flex h-10 shrink-0 items-center gap-2 px-3 disabled:text-mute")}
              >
                <Search aria-hidden className="size-3.5" />
                Find models
              </button>
            </div>
            {found && found.length > 0 && (
              <ul aria-label="Models found" className="mt-2 max-h-44 overflow-y-auto border border-line">
                {found.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      aria-pressed={id === draft.model}
                      onClick={() => setModel(id)}
                      className={cn(
                        "block w-full truncate rounded-none px-3 py-1.5 text-left font-mono text-xs transition-colors duration-75",
                        id === draft.model ? "bg-accent text-void" : "text-ink hover:bg-raised",
                      )}
                    >
                      {id}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p
            role="status"
            className={cn(
              "min-h-5 text-sm leading-5",
              status.kind === "error" && "text-pink",
              status.kind === "ok" && "text-acid",
              status.kind === "busy" && "text-mute",
            )}
          >
            {status.kind === "idle" ? "" : status.text}
          </p>

          {preset.local && (
            <p className="text-xs leading-5 text-mute">
              {preset.label} must be open on this computer with a model downloaded. Nothing you
              send leaves the machine and nothing is billed. If it will not connect, {preset.label}{" "}
              is turning this page away: allow outside connections in its settings and try again.
            </p>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        {engine ? (
          <button
            type="button"
            onClick={() => {
              onDisconnect();
              onClose();
            }}
            className={cn(drawerButton.quiet, "flex items-center gap-2 px-3 hover:border-pink hover:text-pink")}
          >
            <Unplug aria-hidden className="size-3.5" />
            Disconnect
          </button>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute">
            {ready ? "Ready to connect" : "Address, model" + (preset.needsKey ? " and key" : "") + " needed"}
          </p>
        )}
        <button type="submit" disabled={!ready} className={drawerButton.solid}>
          <Plug aria-hidden className="size-3.5" />
          {engine ? "Switch model" : "Connect"}
        </button>
      </footer>
    </form>
  );
}

/** Where the operator plugs in whatever should do the crew's thinking. */
export function ModelPanel({ open, ...form }: ModelPanelProps) {
  return (
    <Drawer open={open} onClose={form.onClose} labelledBy="model-title" accent={ACCENTS.acid.hex}>
      <ModelForm {...form} />
    </Drawer>
  );
}
