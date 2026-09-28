/**
 * Workflow definition format. Stored as JSON on the `workflows` row, edited by the
 * visual builder, executed by src/server/services/automation.ts.
 */

export type TriggerType =
  | 'lead.created' | 'contact.created' | 'customer.created' | 'form.submitted'
  | 'deal.created' | 'deal.stage_changed' | 'deal.won' | 'deal.lost'
  | 'quote.created' | 'quote.sent' | 'quote.accepted' | 'quote.rejected'
  | 'invoice.created' | 'invoice.sent' | 'invoice.overdue' | 'invoice.paid'
  | 'payment.received' | 'payment.failed'
  | 'appointment.booked' | 'appointment.cancelled'
  | 'tag.added' | 'tag.removed'
  | 'message.received' | 'job.status_changed' | 'task.completed'
  | 'manual' | 'schedule';

export type TriggerConfig = {
  source?: string;
  tag?: string;
  pipelineId?: string;
  stageId?: string;
  stageName?: string;
  formId?: string;
  channel?: string;
  jobStatus?: string;
  /** schedule trigger */
  every?: 'day' | 'weekday' | 'week';
  at?: string; // HH:MM in business timezone
  weekday?: number; // 1 = Monday ... 7 = Sunday
};

export type Trigger = { type: TriggerType; config?: TriggerConfig };

export type ConditionOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'has_tag' | 'not_has_tag' | 'is_set' | 'not_set';

export type Condition = { field: string; op: ConditionOp; value?: string | number | boolean };

type Base<T extends string, C> = { id: string; type: T; config: C };

export type Step =
  | Base<'wait', { amount: number; unit: 'minutes' | 'hours' | 'days' }>
  | Base<'send_email', { subject: string; body: string }>
  | Base<'send_sms', { body: string }>
  | Base<'create_task', { title: string; dueInDays?: number; priority?: 'low' | 'normal' | 'high' | 'urgent' }>
  | Base<'add_tag', { tag: string }>
  | Base<'remove_tag', { tag: string }>
  | Base<'update_field', { field: string; value: string }>
  | Base<'move_deal', { stageName: string }>
  | Base<'create_invoice', { description: string; amountCents: number; taxCode?: string; send?: boolean }>
  | Base<'create_quote', { description: string; amountCents: number; taxCode?: string; send?: boolean }>
  | Base<'create_appointment', { title: string; inDays: number; hour: number; durationMinutes?: number }>
  | Base<'notify', { title: string; body?: string }>
  | Base<'webhook', { url: string }>
  | Base<'http_request', { url: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: string; headers?: Record<string, string> }>
  | (Base<'condition', { match: 'all' | 'any'; conditions: Condition[] }> & { yes: Step[]; no: Step[] })
  | Base<'stop', Record<string, never>>;

export type StepType = Step['type'];

export type WorkflowDefinition = {
  trigger: Trigger;
  steps: Step[];
  settings: { stopOnReply?: boolean; allowReentry?: boolean };
};

/* ------------------------------------------------------------------ */
/* Catalogue for the builder UI                                        */
/* ------------------------------------------------------------------ */

export const TRIGGERS: { type: TriggerType; label: string; group: string; configFields?: (keyof TriggerConfig)[] }[] = [
  { type: 'lead.created', label: 'New lead', group: 'Contacts', configFields: ['source'] },
  { type: 'contact.created', label: 'Contact created', group: 'Contacts', configFields: ['source'] },
  { type: 'customer.created', label: 'Became a customer', group: 'Contacts' },
  { type: 'form.submitted', label: 'Form submitted', group: 'Contacts', configFields: ['formId'] },
  { type: 'tag.added', label: 'Tag added', group: 'Contacts', configFields: ['tag'] },
  { type: 'tag.removed', label: 'Tag removed', group: 'Contacts', configFields: ['tag'] },
  { type: 'message.received', label: 'Customer replied / messaged', group: 'Contacts', configFields: ['channel'] },
  { type: 'deal.created', label: 'Deal created', group: 'Sales' },
  { type: 'deal.stage_changed', label: 'Deal stage changed', group: 'Sales', configFields: ['stageName'] },
  { type: 'deal.won', label: 'Deal won', group: 'Sales' },
  { type: 'deal.lost', label: 'Deal lost', group: 'Sales' },
  { type: 'quote.created', label: 'Quote created', group: 'Sales' },
  { type: 'quote.sent', label: 'Quote sent', group: 'Sales' },
  { type: 'quote.accepted', label: 'Quote accepted', group: 'Sales' },
  { type: 'quote.rejected', label: 'Quote declined', group: 'Sales' },
  { type: 'invoice.created', label: 'Invoice created', group: 'Money' },
  { type: 'invoice.sent', label: 'Invoice sent', group: 'Money' },
  { type: 'invoice.overdue', label: 'Invoice overdue', group: 'Money' },
  { type: 'invoice.paid', label: 'Invoice paid', group: 'Money' },
  { type: 'payment.received', label: 'Payment received', group: 'Money' },
  { type: 'payment.failed', label: 'Payment failed', group: 'Money' },
  { type: 'appointment.booked', label: 'Appointment booked', group: 'Calendar' },
  { type: 'appointment.cancelled', label: 'Appointment cancelled', group: 'Calendar' },
  { type: 'job.status_changed', label: 'Job status changed', group: 'Work', configFields: ['jobStatus'] },
  { type: 'task.completed', label: 'Task completed', group: 'Work' },
  { type: 'manual', label: 'Started manually', group: 'Other' },
  { type: 'schedule', label: 'On a schedule (date/time)', group: 'Other', configFields: ['every', 'at', 'weekday'] },
];

export const ACTIONS: { type: StepType; label: string; group: string; needsContact?: boolean }[] = [
  { type: 'wait', label: 'Wait', group: 'Flow' },
  { type: 'condition', label: 'If / else', group: 'Flow' },
  { type: 'stop', label: 'Stop workflow', group: 'Flow' },
  { type: 'send_email', label: 'Send email', group: 'Communicate', needsContact: true },
  { type: 'send_sms', label: 'Send SMS', group: 'Communicate', needsContact: true },
  { type: 'notify', label: 'Notify me', group: 'Communicate' },
  { type: 'create_task', label: 'Create task', group: 'Do' },
  { type: 'add_tag', label: 'Add tag', group: 'Contact', needsContact: true },
  { type: 'remove_tag', label: 'Remove tag', group: 'Contact', needsContact: true },
  { type: 'update_field', label: 'Update field', group: 'Contact', needsContact: true },
  { type: 'move_deal', label: 'Move deal', group: 'Sales' },
  { type: 'create_quote', label: 'Create quote', group: 'Sales', needsContact: true },
  { type: 'create_invoice', label: 'Create invoice', group: 'Money', needsContact: true },
  { type: 'create_appointment', label: 'Create appointment', group: 'Calendar' },
  { type: 'webhook', label: 'Send webhook', group: 'Advanced' },
  { type: 'http_request', label: 'HTTP request', group: 'Advanced' },
];

export const CONDITION_FIELDS: { field: string; label: string; kind: 'text' | 'number' | 'tag' }[] = [
  { field: 'contact.tags', label: 'Contact tags', kind: 'tag' },
  { field: 'contact.source', label: 'Lead source', kind: 'text' },
  { field: 'contact.status', label: 'Contact status', kind: 'text' },
  { field: 'contact.email', label: 'Contact email', kind: 'text' },
  { field: 'contact.phone', label: 'Contact phone', kind: 'text' },
  { field: 'invoice.total', label: 'Invoice amount ($)', kind: 'number' },
  { field: 'invoice.status', label: 'Invoice status (live)', kind: 'text' },
  { field: 'deal.value', label: 'Deal value ($)', kind: 'number' },
  { field: 'appointment.status', label: 'Appointment status', kind: 'text' },
  { field: 'quote.status', label: 'Quote status (live)', kind: 'text' },
  { field: 'event.amount', label: 'Event amount ($)', kind: 'number' },
  { field: 'contact.replied', label: 'Contact has replied since start', kind: 'text' },
];

export function newStepId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function describeStep(step: Step): string {
  switch (step.type) {
    case 'wait': return `Wait ${step.config.amount} ${step.config.unit}`;
    case 'send_email': return `Email: ${step.config.subject || '(no subject)'}`;
    case 'send_sms': return `SMS: ${step.config.body.slice(0, 40)}`;
    case 'create_task': return `Task: ${step.config.title}`;
    case 'add_tag': return `Add tag "${step.config.tag}"`;
    case 'remove_tag': return `Remove tag "${step.config.tag}"`;
    case 'update_field': return `Set ${step.config.field} = ${step.config.value}`;
    case 'move_deal': return `Move deal to ${step.config.stageName}`;
    case 'create_invoice': return `Create invoice: ${step.config.description}`;
    case 'create_quote': return `Create quote: ${step.config.description}`;
    case 'create_appointment': return `Book: ${step.config.title}`;
    case 'notify': return `Notify: ${step.config.title}`;
    case 'webhook': return `Webhook → ${step.config.url}`;
    case 'http_request': return `${step.config.method} ${step.config.url}`;
    case 'condition': return `If ${step.config.conditions.map(describeCondition).join(step.config.match === 'all' ? ' and ' : ' or ')}`;
    case 'stop': return 'Stop';
  }
}

const OP_WORDS: Record<ConditionOp, string> = {
  eq: 'is', neq: 'is not', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: 'contains', has_tag: 'has tag', not_has_tag: "doesn't have tag", is_set: 'is set', not_set: 'is empty',
};

export function describeCondition(c: Condition): string {
  const field = CONDITION_FIELDS.find((f) => f.field === c.field)?.label ?? c.field.replace(/^custom\./, '');
  if (c.field === 'contact.replied') return c.value === 'yes' ? 'contact replied' : 'no reply yet';
  return `${field.toLowerCase()} ${OP_WORDS[c.op]}${c.op === 'is_set' || c.op === 'not_set' ? '' : ` "${c.value ?? ''}"`}`;
}
