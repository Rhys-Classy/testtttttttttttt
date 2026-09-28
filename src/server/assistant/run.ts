import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import { readScope, type AppContext } from '@/server/context';
import { getGlobalCredentials } from '@/server/services/integrations';
import { friendlyError } from '@/server/actions/_util';
import { TOOL_DEFS, dateContext, runTool, type PendingAction } from './tools';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type AssistantReply = { text: string; pending: PendingAction[]; toolsUsed: string[] };

const MAX_TOOL_ROUNDS = 8;

async function resolveClient(ctx: AppContext) {
  const creds = await readScope(ctx, (tx) => getGlobalCredentials<{ apiKey: string }>(tx, 'anthropic'));
  const apiKey = creds?.secrets.apiKey ?? env().ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { client: new Anthropic({ apiKey }), model: creds?.config.model || env().AI_MODEL };
}

function systemPrompt(ctx: AppContext) {
  const d = dateContext(ctx);
  const scope = ctx.current ? `The user is working inside ONE business: ${ctx.current.name}. Only that business's data is visible.` : `The user is in "All Businesses" view and can see: ${ctx.businesses.map((b) => b.name).join('; ')}.`;
  return [
    'You are the operations assistant inside a business management app used by a busy owner who runs several businesses and wants to spend less time on admin.',
    scope,
    `Today is ${d.weekday} ${d.today} (${ctx.tz}). Currency AUD; amounts on invoices usually attract 10% GST.`,
    '',
    'How to work:',
    '- Use the tools to get facts. Never guess numbers, names or dates. If a tool returns nothing, say so.',
    '- Always say which business each item belongs to - the same customer name can exist in more than one business.',
    '- To act on a person, find their contact_id with `search` first. If several people match, ask which one.',
    '- create_invoice_draft, create_quote_draft, book_appointment and send_message only PROPOSE the action; the user confirms it with a button. Tell them it is ready to confirm - do not claim it is done.',
    '- create_task runs immediately.',
    '- If something is ambiguous (which business, which person, what amount), ask one short question instead of guessing.',
    '',
    'How to answer (the owner has ADHD and reads on a phone):',
    '- Lead with the answer. Short lines, bullets or a numbered checklist, most urgent first.',
    '- Group by business when more than one is involved. No preamble, no sign-off.',
    '- When suggesting what to do next, give the single best next action first.',
  ].join('\n');
}

/**
 * Manual tool loop. Every tool executes as the logged-in user inside their current
 * scope (RLS applies); there is no raw database access available to the model.
 */
export async function runAssistant(ctx: AppContext, history: ChatTurn[]): Promise<AssistantReply> {
  const resolved = await resolveClient(ctx);
  if (!resolved) {
    return { text: 'The AI assistant is not connected yet. Add a Claude API key in Settings → Integrations (it is shared by all businesses). The command bar (Ctrl/⌘ K) works without it.', pending: [], toolsUsed: [] };
  }
  const { client, model } = resolved;
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-20).map((t) => ({ role: t.role, content: t.content }));
  const pending: PendingAction[] = [];
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: [{ type: 'text', text: systemPrompt(ctx), cache_control: { type: 'ephemeral' } }],
        tools: TOOL_DEFS,
        messages,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return { text: 'The Claude API key was rejected. Update it in Settings → Integrations.', pending, toolsUsed };
      if (e instanceof Anthropic.RateLimitError) return { text: 'The assistant is busy (rate limited). Try again in a minute.', pending, toolsUsed };
      if (e instanceof Anthropic.APIError) return { text: `The assistant hit an error (${e.status ?? 'network'}). Try again shortly.`, pending, toolsUsed };
      throw e;
    }

    if (response.stop_reason === 'refusal') {
      return { text: "I can't help with that one.", pending, toolsUsed };
    }
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length) {
      const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { text: text || (pending.length ? 'Ready for you to confirm.' : 'Done.'), pending, toolsUsed };
    }

    // Keep the full assistant content (including thinking blocks) for the next round.
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      toolsUsed.push(use.name);
      try {
        const out = await runTool(ctx, use.name, use.input);
        if (out.pending) pending.push(out.pending);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out.result) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: friendlyError(e), is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'That took too many steps. Try asking something more specific.', pending, toolsUsed };
}
