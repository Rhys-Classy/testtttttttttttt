'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { forms, landingPages, workflows } from '@/db/schema';
import type { FormField, FormSettings, LandingSection, Segment } from '@/db/schema';
import type { Step, Trigger } from '@/lib/automation/types';
import { inBusiness, requireContext } from '@/server/context';
import { previewSegment, saveCampaign, saveForm, saveLandingPage, scheduleCampaign } from '@/server/services/marketing';
import { saveWorkflow, setWorkflowStatus, startManualRun } from '@/server/services/automation';
import { ValidationError } from '@/server/services/_common';
import { attempt } from './_util';

const SegmentSchema = z.object({ match: z.enum(['all', 'any']), rules: z.array(z.record(z.string(), z.unknown())).max(20) });

export async function segmentPreviewAction(subAccountId: string, segment: Segment, channel: 'email' | 'sms') {
  const ctx = await requireContext();
  return attempt(() => inBusiness(ctx, subAccountId, 'marketing.view', (tx, s) => previewSegment(tx, s, SegmentSchema.parse(segment) as Segment, channel)));
}

export async function saveCampaignAction(input: { id?: string; subAccountId: string; name: string; channel: 'email' | 'sms'; subject?: string; body: string; segment: Segment; sendAt?: string | null; intent: 'save' | 'schedule' | 'send' }) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, input.subAccountId, 'marketing.edit', async (tx, s) => {
    const c = await saveCampaign(tx, s, { id: input.id, name: input.name, channel: input.channel, subject: input.subject, body: input.body, segment: SegmentSchema.parse(input.segment) as Segment });
    if (input.intent !== 'save') await scheduleCampaign(tx, s, c.id, input.intent === 'schedule' && input.sendAt ? new Date(input.sendAt) : new Date());
    return { id: c.id };
  }, { visible: [['campaigns', input.id]] }), input.intent === 'send' ? 'Sending now' : input.intent === 'schedule' ? 'Scheduled' : 'Saved');
  revalidatePath('/campaigns');
  return res;
}

const StepSchema: z.ZodType<Step> = z.lazy(() => z.object({
  id: z.string(), type: z.string(), config: z.record(z.string(), z.unknown()),
  yes: z.array(StepSchema).optional(), no: z.array(StepSchema).optional(),
}).passthrough()) as unknown as z.ZodType<Step>;

export async function saveWorkflowAction(input: { id?: string; subAccountId: string; name: string; description?: string; trigger: Trigger; steps: Step[]; settings: { stopOnReply?: boolean; allowReentry?: boolean }; activate?: boolean }) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, input.subAccountId, 'automations.edit', async (tx, s) => {
    const steps = z.array(StepSchema).max(100).parse(input.steps);
    const wf = await saveWorkflow(tx, s, { id: input.id, name: input.name, description: input.description, trigger: input.trigger, steps, settings: input.settings });
    if (input.activate !== undefined) await setWorkflowStatus(tx, s, wf.id, input.activate ? 'active' : 'paused');
    return { id: wf.id };
  }, { visible: [['workflows', input.id]] }), 'Automation saved');
  revalidatePath('/automations');
  return res;
}

export async function workflowStatusAction(subAccountId: string, id: string, status: 'active' | 'paused') {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, 'automations.edit', (tx, s) => setWorkflowStatus(tx, s, id, status), { visible: [['workflows', id]] }).then(() => undefined), status === 'active' ? 'Automation on' : 'Automation paused');
  revalidatePath('/automations');
  return res;
}

export async function runWorkflowForContactAction(subAccountId: string, workflowId: string, contactId: string) {
  const ctx = await requireContext();
  return attempt(() => inBusiness(ctx, subAccountId, 'automations.edit', (tx, s) => startManualRun(tx, s, workflowId, contactId), { visible: [['workflows', workflowId], ['contacts', contactId]] }).then(() => undefined), 'Started');
}

export async function deleteWorkflowAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  await inBusiness(ctx, subAccountId, 'automations.edit', (tx, s) => tx.delete(workflows).where(and(eq(workflows.subAccountId, s.subAccountId), eq(workflows.id, id))), { visible: [['workflows', id]] });
  revalidatePath('/automations');
  redirect('/automations');
}

export async function saveFormAction(input: { id?: string; subAccountId: string; name: string; fields: FormField[]; settings: FormSettings; status: 'draft' | 'published' }) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, input.subAccountId, 'marketing.edit', async (tx, s) => {
    if (input.fields.length > 40) throw new ValidationError('Too many fields.');
    const f = await saveForm(tx, s, input);
    return { id: f.id, publicId: f.publicId };
  }, { visible: [['forms', input.id]] }), 'Form saved');
  revalidatePath('/forms');
  return res;
}

export async function deleteFormAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  await inBusiness(ctx, subAccountId, 'marketing.edit', (tx, s) => tx.delete(forms).where(and(eq(forms.subAccountId, s.subAccountId), eq(forms.id, id))), { visible: [['forms', id]] });
  revalidatePath('/forms');
  redirect('/forms');
}

export async function savePageAction(input: { id?: string; subAccountId: string; name: string; title: string; sections: LandingSection[]; style: Record<string, string>; published: boolean }) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, input.subAccountId, 'marketing.edit', async (tx, s) => {
    if (input.sections.length > 40) throw new ValidationError('Too many sections.');
    const p = await saveLandingPage(tx, s, input);
    return { id: p.id, publicId: p.publicId };
  }, { visible: [['landing_pages', input.id]] }), 'Page saved');
  revalidatePath('/pages');
  return res;
}

export async function deletePageAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  await inBusiness(ctx, subAccountId, 'marketing.edit', (tx, s) => tx.delete(landingPages).where(and(eq(landingPages.subAccountId, s.subAccountId), eq(landingPages.id, id))), { visible: [['landing_pages', id]] });
  revalidatePath('/pages');
  redirect('/pages');
}
