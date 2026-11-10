import type { AgentProfile, BusinessBrief, Directive } from "./types";

/**
 * Pure helpers for live mode: building the instructions an operative sends to
 * Claude, and turning what comes back (or what goes wrong) into something the
 * dashboard can show.
 */

/** Word ceiling for an operator-typed directive, which carries none of its own. */
const DEFAULT_WORDS = 500;

/** An operative can only write for a business it can name and describe. */
export function briefReady(brief: BusinessBrief): boolean {
  return brief.name.trim() !== "" && brief.offer.trim() !== "";
}

/** Roughly how many characters a finished job runs to. Drives the progress bar. */
export function expectedChars(directive: Directive): number {
  return (directive.words ?? DEFAULT_WORDS) * 6;
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/);
  return words[0] === "" ? 0 : words.length;
}

/**
 * Everything Claude is told for one job. Each call starts from nothing, so the
 * whole picture goes in every time: who the operative is, the business, the
 * job, and the rules that keep invented facts out of the owner's marketing.
 */
export function buildPrompt(
  profile: AgentProfile,
  brief: BusinessBrief,
  directive: Directive,
): string {
  const fact = (label: string, value: string) => `${label}: ${value.trim() || "(not given)"}`;
  return [
    `You are ${profile.id}, the ${profile.role.toLowerCase()} operative on a small crew of AI agents working for the business described below. ${profile.remit}`,
    "You are given one job. Hand back the finished work, ready to use as it is.",
    "",
    "BUSINESS BRIEF",
    fact("Business name", brief.name),
    fact("What it sells", brief.offer),
    fact("Where it works", brief.area),
    fact("Ideal customer", brief.customer),
    fact("Why customers choose it", brief.edge),
    fact("Tone of voice", brief.tone),
    fact("Other facts", brief.facts),
    "",
    "YOUR JOB",
    directive.task ?? directive.text,
    "",
    "RULES",
    "- Write the finished piece itself, not advice on how to write it and not a menu of options.",
    "- The brief is your only source of facts. Never invent prices, discounts, statistics, awards, guarantees, timeframes, testimonials, customer names, phone numbers or web addresses. Where a fact is needed and the brief does not give it, write a placeholder in square brackets, such as [PRICE] or [PHONE], for the owner to fill in.",
    "- Write in the brief's tone of voice, with the spelling and everyday phrasing of the place the business works in.",
    "- Plain text only. No markdown: no #, *, _ or backticks. Put section headings in CAPITALS on their own line, and number items where order matters.",
    "- First line: a short title for this piece, with no label in front of it. Then a blank line, then the work.",
    `- Keep it under about ${directive.words ?? DEFAULT_WORDS} words. No introduction, no sign-off, no commentary about the work.`,
  ].join("\n");
}

/** Split Claude's answer into its first-line title and the work underneath. */
export function splitTitle(text: string, fallback: string): { title: string; body: string } {
  const trimmed = text.trim();
  const breakAt = trimmed.indexOf("\n");
  if (breakAt === -1) return { title: fallback, body: trimmed };
  const title = trimmed
    .slice(0, breakAt)
    .replace(/^[#*\s"']+|[*"'\s]+$/g, "")
    .slice(0, 90);
  const body = trimmed.slice(breakAt + 1).trim();
  return title && body ? { title, body } : { title: fallback, body: trimmed };
}

/**
 * What to tell the operator when a job fails. `fatal` means Claude is off for
 * this view altogether, so the dashboard stops asking.
 */
export function explainFailure(code: string): { message: string; fatal: boolean } {
  switch (code) {
    case "not_granted":
    case "sampling_disabled":
    case "not_declared":
    case "capability_disabled":
    case "capability_removed":
      return {
        fatal: true,
        message:
          "Claude access is switched off for this page, so operatives cannot do real work here. Allow it from the page's Permissions menu, then reload",
      };
    case "rate_limited":
      return {
        fatal: false,
        message: "Claude is rate-limiting this page. Give it a minute, then deploy again",
      };
    case "session_expired":
      return {
        fatal: false,
        message: "your Claude session has expired. Sign in again, then deploy",
      };
    case "refused":
      return { fatal: false, message: "Claude declined this job. Reword it and deploy again" };
    case "empty_completion":
      return {
        fatal: false,
        message: "Claude came back empty-handed. Give a more specific job and deploy again",
      };
    case "prompt_too_large":
      return { fatal: false, message: "the brief is too long to send. Trim it in BRIEF" };
    default:
      return {
        fatal: false,
        message: "the connection to Claude dropped before the job finished. Deploy again to retry",
      };
  }
}
