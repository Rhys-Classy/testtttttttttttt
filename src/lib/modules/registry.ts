import type { Permission } from '@/lib/permissions';

/**
 * Feature modules. Each business switches on the modules it needs; navigation,
 * quick-add and dashboards are built from this list, never from business names.
 */

export type ModuleKey =
  | 'crm' | 'leads' | 'sales' | 'quotes' | 'jobs' | 'invoices' | 'payments' | 'products' | 'orders'
  | 'calendar' | 'tasks' | 'inbox' | 'campaigns' | 'automations' | 'forms' | 'landing_pages'
  | 'documents' | 'staff' | 'reports';

export type ModuleGroup = 'daily' | 'customers' | 'sales' | 'money' | 'work' | 'marketing' | 'insights';

export type ModuleDef = {
  key: ModuleKey;
  label: string;
  description: string;
  href: string;
  icon: string;
  group: ModuleGroup;
  /** Always on, cannot be disabled. */
  core?: boolean;
  /** Needed to see the module at all. */
  permission: Permission;
};

export const MODULES: ModuleDef[] = [
  { key: 'tasks', label: 'Tasks', description: 'My Day, to-dos, reminders', href: '/tasks', icon: 'CheckCircle2', group: 'daily', core: true, permission: 'tasks.view' },
  { key: 'calendar', label: 'Calendar', description: 'Appointments, jobs and events', href: '/calendar', icon: 'CalendarDays', group: 'daily', permission: 'calendar.view' },
  { key: 'inbox', label: 'Inbox', description: 'Email, SMS, calls and social messages', href: '/inbox', icon: 'Inbox', group: 'daily', permission: 'inbox.view' },
  { key: 'crm', label: 'Contacts', description: 'People and companies', href: '/contacts', icon: 'Users', group: 'customers', core: true, permission: 'contacts.view' },
  { key: 'leads', label: 'Leads', description: 'New enquiries to follow up', href: '/leads', icon: 'Sparkles', group: 'customers', permission: 'sales.view' },
  { key: 'sales', label: 'Pipeline', description: 'Deals moving through stages', href: '/pipeline', icon: 'KanbanSquare', group: 'sales', permission: 'sales.view' },
  { key: 'quotes', label: 'Quotes', description: 'Estimates customers can accept online', href: '/quotes', icon: 'FileText', group: 'sales', permission: 'quotes.view' },
  { key: 'jobs', label: 'Jobs', description: 'Booked work from quote to completion', href: '/jobs', icon: 'Hammer', group: 'work', permission: 'jobs.view' },
  { key: 'staff', label: 'Staff', description: 'Team members and support workers', href: '/staff', icon: 'UserCog', group: 'work', permission: 'staff.view' },
  { key: 'orders', label: 'Orders', description: 'Product orders', href: '/orders', icon: 'ShoppingBag', group: 'sales', permission: 'orders.view' },
  { key: 'invoices', label: 'Invoices', description: 'Bill customers and get paid', href: '/invoices', icon: 'Receipt', group: 'money', permission: 'invoices.view' },
  { key: 'payments', label: 'Payments', description: 'Money in, refunds, failures', href: '/payments', icon: 'Wallet', group: 'money', permission: 'payments.view' },
  { key: 'products', label: 'Products', description: 'Products and services catalogue', href: '/products', icon: 'Package', group: 'money', permission: 'products.view' },
  { key: 'campaigns', label: 'Campaigns', description: 'Email and SMS marketing', href: '/campaigns', icon: 'Megaphone', group: 'marketing', permission: 'marketing.view' },
  { key: 'automations', label: 'Automations', description: 'Workflows that run on their own', href: '/automations', icon: 'Workflow', group: 'marketing', permission: 'automations.view' },
  { key: 'forms', label: 'Forms', description: 'Enquiry forms with public links', href: '/forms', icon: 'ClipboardList', group: 'marketing', permission: 'marketing.view' },
  { key: 'landing_pages', label: 'Landing pages', description: 'Simple web pages', href: '/pages', icon: 'LayoutTemplate', group: 'marketing', permission: 'marketing.view' },
  { key: 'documents', label: 'Documents', description: 'Files and photos', href: '/documents', icon: 'FolderOpen', group: 'work', permission: 'documents.view' },
  { key: 'reports', label: 'Reports', description: 'Sales, revenue and marketing numbers', href: '/reports', icon: 'BarChart3', group: 'insights', permission: 'reports.view' },
];

export const GROUP_LABELS: Record<ModuleGroup, string> = {
  daily: 'Daily',
  customers: 'Customers',
  sales: 'Sales',
  money: 'Money',
  work: 'Work',
  marketing: 'Marketing',
  insights: 'Insights',
};

export const MODULE_KEYS = MODULES.map((m) => m.key);

/** Sensible starting sets. Used by "Add business" and the seed, never to special-case a business. */
export const MODULE_PRESETS: Record<string, { label: string; modules: ModuleKey[] }> = {
  trades: {
    label: 'Trades / renovation',
    modules: ['crm', 'leads', 'sales', 'quotes', 'jobs', 'invoices', 'payments', 'calendar', 'tasks', 'inbox', 'automations', 'documents', 'products', 'forms', 'reports'],
  },
  retail: {
    label: 'Retail / e-commerce',
    modules: ['crm', 'products', 'orders', 'campaigns', 'invoices', 'payments', 'inbox', 'automations', 'tasks', 'reports'],
  },
  agency: {
    label: 'Agency / services',
    modules: ['crm', 'leads', 'sales', 'campaigns', 'automations', 'forms', 'landing_pages', 'inbox', 'tasks', 'calendar', 'invoices', 'payments', 'quotes', 'reports'],
  },
  care: {
    label: 'Care / support services',
    modules: ['crm', 'staff', 'calendar', 'tasks', 'documents', 'invoices', 'payments', 'inbox', 'automations', 'forms', 'reports'],
  },
  custom_manufacturing: {
    label: 'Custom manufacturing',
    modules: ['crm', 'leads', 'sales', 'quotes', 'jobs', 'products', 'invoices', 'payments', 'calendar', 'tasks', 'documents', 'forms', 'inbox', 'reports'],
  },
  everything: { label: 'Everything', modules: MODULE_KEYS },
};

export function enabledModules(keys: readonly string[] | null | undefined): ModuleDef[] {
  const set = new Set(keys ?? []);
  return MODULES.filter((m) => m.core || set.has(m.key));
}

export function isModuleEnabled(keys: readonly string[] | null | undefined, key: ModuleKey): boolean {
  const def = MODULES.find((m) => m.key === key);
  return !!def && (def.core === true || (keys ?? []).includes(key));
}
