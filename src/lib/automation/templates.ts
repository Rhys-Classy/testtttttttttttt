import type { WorkflowDefinition } from './types';

/** Ready-made automations. One click to install, then tweak. Nothing here is business-specific. */
export const WORKFLOW_TEMPLATES: ({ key: string; name: string; description: string } & WorkflowDefinition)[] = [
  {
    key: 'speed-to-lead', name: 'New lead: reply in 1 minute',
    description: 'Instant SMS to every new lead, email next day if they have not replied, and a call task for you.',
    trigger: { type: 'lead.created' }, settings: { stopOnReply: true, allowReentry: false },
    steps: [
      { id: 'a1', type: 'wait', config: { amount: 1, unit: 'minutes' } },
      { id: 'a2', type: 'send_sms', config: { body: 'Hi {{contact.first_name|there}}, thanks for your enquiry with {{business.name}}! What is the best time for a quick call?' } },
      { id: 'a3', type: 'create_task', config: { title: 'Call new lead {{contact.name}}', dueInDays: 0, priority: 'high' } },
      { id: 'a4', type: 'wait', config: { amount: 1, unit: 'days' } },
      { id: 'a5', type: 'condition', config: { match: 'all', conditions: [{ field: 'contact.replied', op: 'eq', value: 'no' }] },
        yes: [{ id: 'a6', type: 'send_email', config: { subject: 'Following up on your enquiry', body: 'Hi {{contact.first_name|there}},\n\nJust following up on your enquiry. Reply here or call us on {{business.phone}}.\n\n{{business.name}}' } }], no: [] },
    ],
  },
  {
    key: 'website-planner', name: 'Website form → tag, notify, task',
    description: 'When a website form is submitted: tag the contact, alert you and create a call-back task.',
    trigger: { type: 'form.submitted' }, settings: { stopOnReply: false, allowReentry: true },
    steps: [
      { id: 'b1', type: 'add_tag', config: { tag: 'website-enquiry' } },
      { id: 'b2', type: 'notify', config: { title: 'New website enquiry: {{contact.name}}' } },
      { id: 'b3', type: 'create_task', config: { title: 'Call back {{contact.name}} (website form)', dueInDays: 0, priority: 'high' } },
    ],
  },
  {
    key: 'appointment-confirm', name: 'Appointment booked → confirm',
    description: 'Confirmation SMS as soon as an appointment is booked. (A reminder 24h before is sent automatically.)',
    trigger: { type: 'appointment.booked' }, settings: { stopOnReply: false, allowReentry: true },
    steps: [{ id: 'c1', type: 'send_sms', config: { body: 'Hi {{contact.first_name|there}}, you are booked in with {{business.name}}: {{appointment.when}}. Reply to change it.' } }],
  },
  {
    key: 'quote-follow-up', name: 'Quote follow-up (3 days)',
    description: 'If a quote is still not accepted after 3 days, send a friendly nudge and create a call task.',
    trigger: { type: 'quote.sent' }, settings: { stopOnReply: true, allowReentry: true },
    steps: [
      { id: 'd1', type: 'wait', config: { amount: 3, unit: 'days' } },
      { id: 'd2', type: 'condition', config: { match: 'any', conditions: [{ field: 'quote.status', op: 'eq', value: 'sent' }, { field: 'quote.status', op: 'eq', value: 'viewed' }] },
        yes: [
          { id: 'd3', type: 'send_sms', config: { body: 'Hi {{contact.first_name|there}}, just checking you received your quote {{quote.number}} from {{business.name}}. Any questions? {{quote.link}}' } },
          { id: 'd4', type: 'create_task', config: { title: 'Call {{contact.name}} about quote {{quote.number}}', priority: 'high' } },
        ], no: [] },
    ],
  },
  {
    key: 'overdue-chaser', name: 'Overdue invoice chaser',
    description: 'SMS when an invoice goes overdue; if still unpaid 5 days later, a call task for you.',
    trigger: { type: 'invoice.overdue' }, settings: { stopOnReply: false, allowReentry: true },
    steps: [
      { id: 'e1', type: 'send_sms', config: { body: 'Hi {{contact.first_name|there}}, a reminder that invoice {{invoice.number}} ({{invoice.balance}}) is overdue. Pay online: {{invoice.link}}' } },
      { id: 'e2', type: 'wait', config: { amount: 5, unit: 'days' } },
      { id: 'e3', type: 'condition', config: { match: 'all', conditions: [{ field: 'invoice.status', op: 'neq', value: 'paid' }] },
        yes: [{ id: 'e4', type: 'create_task', config: { title: 'Call {{contact.name}} about overdue {{invoice.number}}', priority: 'urgent' } }], no: [] },
    ],
  },
  {
    key: 'review-request', name: 'Job done → review request',
    description: 'A day after a job is completed, ask for a Google review. Replies land in your inbox.',
    trigger: { type: 'job.status_changed', config: { jobStatus: 'completed' } }, settings: { stopOnReply: true, allowReentry: true },
    steps: [
      { id: 'f1', type: 'wait', config: { amount: 1, unit: 'days' } },
      { id: 'f2', type: 'send_sms', config: { body: 'Hi {{contact.first_name|there}}, thanks for choosing {{business.name}}! How did we go? A quick Google review helps a lot: {{business.website}}' } },
      { id: 'f3', type: 'wait', config: { amount: 3, unit: 'days' } },
      { id: 'f4', type: 'condition', config: { match: 'all', conditions: [{ field: 'contact.replied', op: 'eq', value: 'yes' }] },
        yes: [{ id: 'f5', type: 'notify', config: { title: '{{contact.name}} replied to the review request — check it isn’t a complaint' } }], no: [] },
    ],
  },
  {
    key: 'paid-thanks', name: 'Invoice paid → thank you',
    description: 'Thank the customer and tag them as paid.',
    trigger: { type: 'invoice.paid' }, settings: { stopOnReply: false, allowReentry: true },
    steps: [
      { id: 'g1', type: 'send_email', config: { subject: 'Thank you — payment received', body: 'Hi {{contact.first_name|there}},\n\nThanks, we have received payment for invoice {{invoice.number}} ({{invoice.total}}).\n\n{{business.name}}' } },
      { id: 'g2', type: 'add_tag', config: { tag: 'paid-customer' } },
    ],
  },
  {
    key: 'daily-digest', name: 'Weekday 7:30am nudge',
    description: 'Every weekday morning, a notification to check your day.',
    trigger: { type: 'schedule', config: { every: 'weekday', at: '07:30' } }, settings: {},
    steps: [{ id: 'h1', type: 'notify', config: { title: 'Good morning — open Home to see what needs you today' } }],
  },
];
