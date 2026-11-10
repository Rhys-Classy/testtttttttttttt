import Anthropic from "@anthropic-ai/sdk";
import { failure, isFailure, type ModelFailure, type SampleFn } from "./host";
import type { Connection } from "./providers";

/**
 * Claude through Anthropic's own SDK, with the operator's API key. The key is
 * theirs and stays on their computer, which is the case the SDK's browser
 * switch exists for.
 */

/** Room for the longest job plus the thinking Claude does before it writes. */
const MAX_TOKENS = 64_000;

/**
 * Models that can hand a declined request to another model inside the same
 * call. Where it is offered it is switched on, so a false alarm from a safety
 * filter costs a little time and not the whole job.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const HAS_FALLBACK = new Set([
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

function client(connection: Connection): Anthropic {
  return new Anthropic({
    apiKey: connection.apiKey.trim(),
    baseURL: connection.baseUrl.trim() || undefined,
    dangerouslyAllowBrowser: true,
  });
}

function toFailure(error: unknown, signal?: AbortSignal): ModelFailure {
  if (isFailure(error)) return error;
  if (signal?.aborted || error instanceof Anthropic.APIUserAbortError) {
    return failure("cancelled", "stopped");
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return failure("bad_key", error.message);
  }
  if (error instanceof Anthropic.NotFoundError) return failure("bad_model", error.message);
  if (error instanceof Anthropic.RateLimitError) return failure("rate_limited", error.message);
  if (error instanceof Anthropic.BadRequestError) return failure("bad_request", error.message);
  // A subclass of APIError in this SDK, so it has to be checked first.
  if (error instanceof Anthropic.APIConnectionError) return failure("unreachable", error.message);
  if (error instanceof Anthropic.APIError) {
    return failure(error.status === 402 ? "billing" : "upstream_error", error.message);
  }
  return failure("upstream_error", String(error));
}

/** The parts of a finished message the dashboard reads, whichever endpoint produced it. */
interface Finished {
  stop_reason: string | null;
  content: { type: string; text?: string }[];
}

function finish(message: Finished) {
  // A decline arrives as a normal response. Reading its text as if it were the work would file a refusal.
  if (message.stop_reason === "refusal") throw failure("refused", "the model declined the job");
  const text = message.content
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("")
    .trim();
  if (!text) throw failure("empty_completion", "the model returned no text");
  return { text, truncated: message.stop_reason === "max_tokens" };
}

export function anthropicSample(connection: Connection): SampleFn {
  return async (input, options = {}) => {
    const api = client(connection);
    const request = {
      model: connection.model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user" as const, content: input }],
    };
    const { signal, onText } = options;

    try {
      if (HAS_FALLBACK.has(connection.model)) {
        const stream = api.beta.messages.stream({
          ...request,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        });
        signal?.addEventListener("abort", () => stream.abort(), { once: true });
        if (signal?.aborted) stream.abort();
        stream.on("text", (delta, snapshot) => onText?.({ text: snapshot, delta }));
        return finish(await stream.finalMessage());
      }

      const stream = api.messages.stream(request);
      signal?.addEventListener("abort", () => stream.abort(), { once: true });
      if (signal?.aborted) stream.abort();
      stream.on("text", (delta, snapshot) => onText?.({ text: snapshot, delta }));
      return finish(await stream.finalMessage());
    } catch (error) {
      throw toFailure(error, signal);
    }
  };
}

export async function anthropicModels(connection: Connection): Promise<string[]> {
  try {
    const ids: string[] = [];
    for await (const model of client(connection).models.list()) ids.push(model.id);
    return ids;
  } catch (error) {
    throw toFailure(error);
  }
}
