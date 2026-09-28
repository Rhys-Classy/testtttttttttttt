import { NextResponse } from 'next/server';
import { z } from 'zod';
import { can, getAppContext } from '@/server/context';
import { CONFIRM_TOOLS, executeConfirmedAction } from '@/server/assistant/tools';
import { friendlyError } from '@/server/actions/_util';

const Body = z.object({ tool: z.enum(CONFIRM_TOOLS as [string, ...string[]]), input: z.record(z.string(), z.unknown()) });

/** The user pressed Confirm on an action the assistant proposed. */
export async function POST(req: Request) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!can(ctx, 'ai.use')) return NextResponse.json({ ok: false, error: 'Your role doesn’t include the AI assistant.' }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  try {
    const res = await executeConfirmedAction(ctx, parsed.data.tool as never, parsed.data.input);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: friendlyError(e) }, { status: 400 });
  }
}
