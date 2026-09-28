import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAppContext } from '@/server/context';
import { runAssistant } from '@/server/assistant/run';

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })).min(1).max(40),
});

export async function POST(req: Request) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const reply = await runAssistant(ctx, parsed.data.messages);
  return NextResponse.json(reply);
}
