import * as chrono from 'chrono-node';
import { parseMoney } from '@/lib/money';

/**
 * Natural-language command parser for the Ctrl/Cmd+K command centre. Pure and
 * deterministic (no AI needed): it recognises the common "do this" shapes and
 * hands anything that reads like a question to the assistant.
 */

export type ParsedCommand =
  | { intent: 'create_invoice' | 'create_quote'; who: string; amountCents: number; gst: 'plus' | 'inc' | 'default'; description?: string }
  | { intent: 'create_task'; title: string; due?: string; allDay: boolean; who?: string }
  | { intent: 'book_appointment'; who?: string; title: string; start: string; durationMinutes: number }
  | { intent: 'create_contact' | 'create_lead'; name: string; email?: string; phone?: string; source?: string }
  | { intent: 'navigate'; href: string; label: string }
  | { intent: 'switch_business'; query: string }
  | { intent: 'ask'; question: string }
  | { intent: 'search'; query: string };

export type ParseOptions = { now?: Date; tzOffsetMinutes?: number };

const SOURCES = ['facebook', 'instagram', 'google', 'website', 'referral', 'phone', 'sms', 'manual', 'other'];

const LISTS: { re: RegExp; href: (m: RegExpMatchArray) => string; label: (m: RegExpMatchArray) => string }[] = [
  { re: /^(?:show|list|view)(?: me)? (?:all )?(?:the )?overdue invoices?$/, href: () => '/invoices?status=overdue', label: () => 'Overdue invoices' },
  { re: /^(?:show|list|view)(?: me)? (?:all )?(?:the )?(?:unpaid|outstanding) invoices?$/, href: () => '/invoices?status=outstanding', label: () => 'Outstanding invoices' },
  { re: /^(?:show|list|view)(?: me)? (?:all )?(?:the )?(draft|paid|sent) invoices?$/, href: (m) => `/invoices?status=${m[1]}`, label: (m) => `${cap(m[1])} invoices` },
  { re: /^(?:show|list|view)(?: me)? (?:all )?(?:the )?invoices?$/, href: () => '/invoices', label: () => 'Invoices' },
  { re: /^(?:show|list|view)(?: me)? (?:all )?(?:the )?(?:new )?leads? (?:from|via|source) (\w+)$/, href: (m) => `/leads?source=${m[1]}`, label: (m) => `Leads from ${cap(m[1])}` },
  { re: /^(?:show|list|view)(?: me)? (?:all )?(?:the )?(new |open )?leads?$/, href: (m) => (m[1]?.trim() === 'new' ? '/leads?status=new' : '/leads'), label: () => 'Leads' },
  { re: /^(?:show|list|view)(?: me)? (?:all )?(?:the )?(?:open |pending )?quotes?$/, href: () => '/quotes', label: () => 'Quotes' },
  { re: /^(?:show|list|view)(?: me)? (?:all )?(?:the )?(?:failed )?payments?$/, href: (m) => (m[0].includes('failed') ? '/payments?status=failed' : '/payments'), label: () => 'Payments' },
  { re: /^(?:show|list|view)(?: me)? (?:my |all |the )*(?:tasks?|to-?dos?)(?: for)?(?: today)?$/, href: () => '/tasks', label: () => 'My Day' },
  { re: /^(?:show|list|view)(?: me)? (?:my |the )?(?:calendar|schedule|appointments?)(?: for)?( today| tomorrow| this week)?$/, href: () => '/calendar', label: () => 'Calendar' },
  { re: /^(?:show|list|view)(?: me)? (?:my |the )?(?:jobs?)$/, href: () => '/jobs', label: () => 'Jobs' },
  { re: /^(?:show|list|view)(?: me)? (?:my |the )?(?:pipeline|deals?)$/, href: () => '/pipeline', label: () => 'Pipeline' },
  { re: /^(?:show|list|view)(?: me)? (?:my |the )?(?:inbox|messages?|conversations?)$/, href: () => '/inbox', label: () => 'Inbox' },
  { re: /^(?:show|what)(?: me)?(?: is)? (?:everything )?(?:that )?needs? (?:my )?attention(?: today)?\??$/, href: () => '/', label: () => 'Needs attention' },
  { re: /^(?:go to|open) (home|dashboard)$/, href: () => '/', label: () => 'Home' },
];

const MODULE_WORDS: Record<string, string> = {
  contacts: '/contacts', customers: '/contacts', clients: '/contacts', leads: '/leads', pipeline: '/pipeline', deals: '/pipeline',
  quotes: '/quotes', invoices: '/invoices', payments: '/payments', tasks: '/tasks', calendar: '/calendar', jobs: '/jobs',
  inbox: '/inbox', campaigns: '/campaigns', automations: '/automations', forms: '/forms', reports: '/reports',
  products: '/products', documents: '/documents', settings: '/settings', integrations: '/settings/integrations', staff: '/staff', orders: '/orders',
};

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function chronoRef(opts: ParseOptions) {
  return { instant: opts.now ?? new Date(), timezone: opts.tzOffsetMinutes ?? 600 };
}

/** Find a date phrase, return it plus the text with the phrase removed. */
function extractDate(text: string, opts: ParseOptions) {
  const results = chrono.en.GB.parse(text, chronoRef(opts), { forwardDate: true });
  const r = results[0];
  if (!r) return { rest: text.trim(), date: undefined as Date | undefined, hasTime: false };
  const rest = (text.slice(0, r.index) + text.slice(r.index + r.text.length)).replace(/\s+(on|at|by|for|due)\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
  return { rest, date: r.start.date(), hasTime: r.start.isCertain('hour') };
}

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /(\+?\d[\d\s-]{7,}\d)/;

export function parseCommand(input: string, opts: ParseOptions = {}): ParsedCommand {
  const raw = input.trim().replace(/\s+/g, ' ');
  const text = raw.toLowerCase().replace(/[.!]+$/, '');
  if (!text) return { intent: 'search', query: '' };

  // Invoices / quotes: "create invoice for John for $2,500 plus GST [for kitchen doors]"
  const money = raw.match(/^(?:please )?(?:create|make|new|raise|send|draft|do)?\s*(?:an? |the )?(invoice|quote|estimate)\s+(?:(?:for|to)\s+)?(.+?)\s+(?:for\s+)?(\$?\s?[\d,]+(?:\.\d+)?k?)\s*(\+\s*gst|plus gst|ex(?:cl?(?:uding)?)?\.? gst|inc(?:l?(?:uding)?)?\.? gst|including gst|gst inclusive|gst exclusive)?(?:\s+(?:for|re:?)\s+(.+))?$/i);
  if (money) {
    const amountCents = parseMoney(money[3].replace(/\s/g, ''));
    if (amountCents !== null) {
      const g = (money[4] ?? '').toLowerCase();
      const gst = /inc|inclusive/.test(g) ? 'inc' : g ? 'plus' : 'default';
      return { intent: /invoice/i.test(money[1]) ? 'create_invoice' : 'create_quote', who: money[2].trim(), amountCents, gst, description: money[5]?.trim() };
    }
  }

  // Tasks: "create task to call Steve tomorrow", "remind me to ... friday"
  const task = raw.match(/^(?:please )?(?:(?:create|add|new|make)\s+(?:a\s+)?(?:task|todo|to-do|reminder)(?:\s+to)?|remind me to|todo:?|task:?)\s+(.+)$/i);
  if (task) {
    const { rest, date, hasTime } = extractDate(task[1], opts);
    const who = rest.match(/^(?:call|ring|phone|email|text|sms|follow up(?: with)?|chase|message|meet)\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?)/)?.[1];
    return { intent: 'create_task', title: cap(rest), due: date?.toISOString(), allDay: !hasTime, who };
  }

  // Appointments: "book meeting with John Friday at 2pm"
  const book = raw.match(/^(?:please )?(?:book|schedule|set up|arrange)\s+(?:a\s+|an\s+)?(meeting|appointment|call|measure(?:\s*(?:and|&)\s*quote)?|site visit|consult(?:ation)?|visit)?\s*(?:with\s+)?(.+)$/i);
  if (book) {
    const kind = (book[1] ?? 'meeting').toLowerCase();
    const { rest, date } = extractDate(book[2], opts);
    if (date) {
      const who = rest.replace(/^with\s+/i, '').replace(/\s+(for|about)\s+.*$/i, '').trim() || undefined;
      const duration = /call/.test(kind) ? 30 : /measure|visit|site/.test(kind) ? 60 : 60;
      return { intent: 'book_appointment', who, title: `${cap(kind)}${who ? ` with ${who}` : ''}`, start: date.toISOString(), durationMinutes: duration };
    }
  }

  // Contacts / leads: "add lead Sarah Jones 0412 345 678 from facebook"
  const person = raw.match(/^(?:add|create|new)\s+(?:a\s+)?(lead|contact|customer|client)\s+(.+)$/i);
  if (person) {
    let rest = person[2];
    const email = rest.match(EMAIL_RE)?.[0];
    if (email) rest = rest.replace(email, '');
    const phone = rest.match(PHONE_RE)?.[1];
    if (phone) rest = rest.replace(phone, '');
    const src = rest.match(/\b(?:from|via|source:?)\s+(\w+)/i);
    if (src) rest = rest.replace(src[0], '');
    const source = src && SOURCES.includes(src[1].toLowerCase()) ? src[1].toLowerCase() : undefined;
    return { intent: person[1].toLowerCase() === 'lead' ? 'create_lead' : 'create_contact', name: rest.replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim(), email, phone: phone?.trim(), source };
  }

  for (const l of LISTS) {
    const m = text.match(l.re);
    if (m) return { intent: 'navigate', href: l.href(m), label: l.label(m) };
  }

  // "open invoices", "go to calendar", "open Classy Kitchen Facelifts"
  const open = raw.match(/^(?:open|go to|goto|switch to|jump to|show)\s+(.+)$/i);
  if (open) {
    const target = open[1].toLowerCase().trim();
    if (MODULE_WORDS[target]) return { intent: 'navigate', href: MODULE_WORDS[target], label: cap(target) };
    if (/^(all|all businesses|everything|everywhere)$/.test(target)) return { intent: 'switch_business', query: 'all' };
    if (/^(open|go to|goto|switch to|jump to)/i.test(raw)) return { intent: 'switch_business', query: open[1].trim() };
  }

  const find = raw.match(/^(?:find|search(?: for)?|look ?up|where is|who is)\s+(.+)$/i);
  if (find) return { intent: 'search', query: find[1].replace(/\?$/, '').trim() };

  if (/\?$/.test(text) || /^(what|who|which|how|when|why|should|can|could|is|are|do|does|give|summari[sz]e|tell)\b/.test(text)) {
    return { intent: 'ask', question: raw };
  }
  return { intent: 'search', query: raw };
}

/** Plain-English echo of what will happen, for the palette preview. */
export function describeCommand(c: ParsedCommand, formatMoneyFn: (cents: number) => string, formatWhen: (iso: string) => string): string {
  switch (c.intent) {
    case 'create_invoice':
    case 'create_quote':
      return `Draft ${c.intent === 'create_invoice' ? 'invoice' : 'quote'} for ${c.who}: ${formatMoneyFn(c.amountCents)}${c.gst === 'plus' ? ' + GST' : c.gst === 'inc' ? ' inc GST' : ''}${c.description ? ` — ${c.description}` : ''}`;
    case 'create_task': return `Task: ${c.title}${c.due ? ` · ${formatWhen(c.due)}` : ''}`;
    case 'book_appointment': return `Book: ${c.title} · ${formatWhen(c.start)}`;
    case 'create_contact': return `New contact: ${c.name}${c.phone ? ` · ${c.phone}` : ''}${c.email ? ` · ${c.email}` : ''}`;
    case 'create_lead': return `New lead: ${c.name}${c.source ? ` from ${c.source}` : ''}`;
    case 'navigate': return `Open ${c.label}`;
    case 'switch_business': return c.query === 'all' ? 'Switch to All Businesses' : `Switch to ${c.query}`;
    case 'ask': return `Ask the assistant: "${c.question}"`;
    case 'search': return c.query ? `Search for "${c.query}"` : '';
  }
}
