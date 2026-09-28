import { sql } from 'drizzle-orm';
import { isUuid, withAnonymous, withSystem } from '@/db/context';
import { env } from '@/lib/env';
import { verifyTwilioSignature } from '@/lib/integrations/sms';
import { getBusinessCredentials } from '@/server/services/integrations';
import { recordInbound } from '@/server/services/comms';

const twiml = (status = 200) => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { status, headers: { 'content-type': 'text/xml' } });

/** Inbound SMS for one business's Twilio number. Signature verified with that business's auth token. */
export async function POST(req: Request, { params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  if (!isUuid(integrationId)) return twiml(404);
  const subAccountId = await withAnonymous(async (tx) =>
    (await tx.execute<{ id: string | null }>(sql`select app.resolve_integration(${integrationId}::uuid) as id`)).rows[0]?.id ?? null);
  if (!subAccountId) return twiml(404);
  const form = await req.formData();
  const fields = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const scope = { subAccountId, userId: null, actor: 'system' as const };
  const ok = await withSystem(subAccountId, async (tx) => {
    const creds = await getBusinessCredentials<{ authToken: string }>(tx, scope, ['twilio']);
    if (!creds || creds.integration.id !== integrationId) return false;
    const url = `${env().APP_URL}/api/webhooks/twilio/${integrationId}`;
    if (!(await verifyTwilioSignature(creds.secrets.authToken, url, fields, req.headers.get('x-twilio-signature')))) return false;
    await recordInbound(tx, scope, { channel: 'sms', from: fields.From, to: fields.To, body: fields.Body ?? '', provider: 'twilio', providerMessageId: fields.MessageSid });
    return true;
  });
  return ok ? twiml() : twiml(403);
}
