import { anthropicModels, anthropicSample } from "./anthropic";
import { failure, isFailure, type SampleFn } from "./host";

/**
 * Bring-your-own model. One connection at a time: an address, an optional
 * key and a model name. Two wire formats cover almost everything:
 *
 *   anthropic  Claude, through Anthropic's own SDK
 *   openai     the chat-completions format, which OpenAI, OpenRouter, Groq and
 *              most other hosted APIs speak, and which Ollama and LM Studio
 *              serve for models running on this computer
 */

export type ProviderKind = "anthropic" | "openai";

export interface Connection {
  /** Which preset it was set up from. Only used to label it and to reopen the form. */
  preset: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Preset {
  key: string;
  label: string;
  /** Short name for the header chip. */
  short: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Pre-filled model name, where there is a sensible one. */
  model: string;
  needsKey: boolean;
  /** Runs on this computer: nothing leaves it and nothing is billed. */
  local: boolean;
  blurb: string;
}

export const PRESETS: readonly Preset[] = [
  {
    key: "anthropic",
    label: "Claude",
    short: "CLAUDE",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-opus-5-5",
    needsKey: true,
    local: false,
    blurb: "Anthropic API key",
  },
  {
    key: "openai",
    label: "OpenAI",
    short: "OPENAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    needsKey: true,
    local: false,
    blurb: "OpenAI API key",
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    short: "OPENROUTER",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    needsKey: true,
    local: false,
    blurb: "One key, many models",
  },
  {
    key: "ollama",
    label: "Ollama",
    short: "OLLAMA",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    model: "",
    needsKey: false,
    local: true,
    blurb: "Runs on this computer",
  },
  {
    key: "lmstudio",
    label: "LM Studio",
    short: "LM STUDIO",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    model: "",
    needsKey: false,
    local: true,
    blurb: "Runs on this computer",
  },
  {
    key: "custom",
    label: "Any other API",
    short: "CUSTOM",
    kind: "openai",
    baseUrl: "",
    model: "",
    needsKey: false,
    local: false,
    blurb: "Any OpenAI-style address",
  },
];

export const presetFor = (key: string): Preset =>
  PRESETS.find((preset) => preset.key === key) ?? PRESETS[PRESETS.length - 1];

/** How a connection reads in the header: where it runs and which model. */
export function connectionLabel(connection: Connection): string {
  return `${presetFor(connection.preset).short} // ${connection.model}`;
}

// ---------------------------------------------------------------- storage ----

const STORAGE_KEY = "syndicate.model.v1";

/** The saved connection, or null. Storage can be blocked or hold junk: both mean "none". */
export function loadConnection(): Connection | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { preset, kind, baseUrl, apiKey, model } = value as Record<string, unknown>;
    if (kind !== "anthropic" && kind !== "openai") return null;
    if (typeof baseUrl !== "string" || typeof model !== "string" || !model) return null;
    return {
      preset: typeof preset === "string" ? preset : "custom",
      kind,
      baseUrl,
      apiKey: typeof apiKey === "string" ? apiKey : "",
      model,
    };
  } catch {
    return null;
  }
}

export function saveConnection(connection: Connection | null): void {
  try {
    if (connection) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is blocked: the connection still works until the page is closed.
  }
}

// ------------------------------------------------- the chat-completions way ----

interface StreamChunk {
  choices?: { delta?: { content?: unknown }; message?: { content?: unknown }; finish_reason?: unknown }[];
  error?: { message?: unknown };
}

const join = (base: string, path: string) => `${base.trim().replace(/\/+$/, "")}${path}`;

function headers(connection: Connection): Record<string, string> {
  const key = connection.apiKey.trim();
  return key
    ? { "content-type": "application/json", authorization: `Bearer ${key}` }
    : { "content-type": "application/json" };
}

function codeForStatus(status: number): string {
  if (status === 401 || status === 403) return "bad_key";
  if (status === 402) return "billing";
  if (status === 404) return "bad_model";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "bad_request";
  return "upstream_error";
}

/** The provider's own explanation, if it sent one in a shape we recognise. */
async function detailOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body as { error: unknown };
      if (typeof error === "string") return error;
      if (typeof error === "object" && error !== null && "message" in error) {
        return String((error as { message: unknown }).message);
      }
    }
  } catch {
    // Not JSON. The status code will have to do.
  }
  return `HTTP ${response.status}`;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw failure("cancelled", "stopped");
    // A refused connection, a blocked cross-origin call and a typo in the address all land here.
    throw failure("unreachable", String(error));
  }
  if (response.ok) return response;
  throw failure(codeForStatus(response.status), await detailOf(response));
}

/**
 * Some local models think out loud inside <think> tags before answering.
 * That is working, not the deliverable, so it is cut, including a block
 * that is still being written.
 */
const visible = (raw: string) => raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trimStart();

function openAiSample(connection: Connection): SampleFn {
  return async (input, options = {}) => {
    const response = await request(join(connection.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: headers(connection),
      signal: options.signal,
      body: JSON.stringify({
        model: connection.model,
        stream: true,
        messages: [{ role: "user", content: input }],
      }),
    });

    let raw = "";
    let shown = "";
    let truncated = false;
    const take = (chunk: StreamChunk) => {
      if (chunk.error) throw failure("upstream_error", String(chunk.error.message ?? "stream error"));
      const choice = chunk.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason === "length") truncated = true;
      const piece = choice.delta?.content ?? choice.message?.content;
      if (typeof piece !== "string" || !piece) return;
      raw += piece;
      const next = visible(raw);
      if (next.length > shown.length) {
        options.onText?.({ text: next, delta: next.slice(shown.length) });
        shown = next;
      }
    };

    try {
      if (!response.body || response.headers.get("content-type")?.includes("application/json")) {
        // The server ignored `stream` and answered in one piece.
        take((await response.json()) as StreamChunk);
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const data = line.startsWith("data:") ? line.slice(5).trim() : "";
            if (!data || data === "[DONE]") continue;
            let chunk: StreamChunk;
            try {
              chunk = JSON.parse(data) as StreamChunk;
            } catch {
              continue; // a keep-alive or a comment line
            }
            take(chunk);
          }
        }
      }
    } catch (error) {
      if (options.signal?.aborted) throw failure("cancelled", "stopped");
      throw isFailure(error) ? error : failure("upstream_error", String(error));
    }

    const text = visible(raw).trim();
    if (!text) throw failure("empty_completion", "the model returned no text");
    return { text, truncated };
  };
}

async function openAiModels(connection: Connection): Promise<string[]> {
  const response = await request(join(connection.baseUrl, "/models"), {
    headers: headers(connection),
  });
  const body: unknown = await response.json().catch(() => null);
  const list =
    typeof body === "object" && body !== null && "data" in body
      ? (body as { data: unknown }).data
      : body;
  if (!Array.isArray(list)) return [];
  return list
    .map((entry: unknown) =>
      typeof entry === "object" && entry !== null && "id" in entry
        ? String((entry as { id: unknown }).id)
        : "",
    )
    .filter(Boolean)
    .sort();
}

// ------------------------------------------------------------------ entry ----

/** A function that asks the connected model one question, in the shape the dashboard already uses. */
export function createSample(connection: Connection): SampleFn {
  return connection.kind === "anthropic" ? anthropicSample(connection) : openAiSample(connection);
}

/** The models this connection can use. Doubles as the "does this address and key work" test. */
export function listModels(connection: Connection): Promise<string[]> {
  return connection.kind === "anthropic" ? anthropicModels(connection) : openAiModels(connection);
}
