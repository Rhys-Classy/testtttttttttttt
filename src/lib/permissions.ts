/**
 * Permission catalog. Roles are lists of these keys; the database enforces
 * them (row level security + app.has_permission), the UI only hides what a
 * user can't use.
 *
 * Keep keys stable: they are stored in roles.permissions and api_keys.permissions.
 */
export const PERMISSION_GROUPS = [
  { key: 'customers', label: 'Customers', perms: {
    'contacts.view': 'See customers, companies, notes and history',
    'contacts.edit': 'Add and edit customers, notes and tags',
    'contacts.delete': 'Delete customers',
  } },
  { key: 'sales', label: 'Sales', perms: {
    'sales.view': 'See leads, deals and pipelines',
    'sales.edit': 'Add and move leads and deals',
  } },
  { key: 'quotes', label: 'Quotes', perms: {
    'quotes.view': 'See quotes',
    'quotes.edit': 'Create, edit, send and accept quotes',
  } },
  { key: 'invoices', label: 'Invoices', perms: {
    'invoices.view': 'See invoices',
    'invoices.edit': 'Create, edit, send and cancel invoices',
  } },
  { key: 'payments', label: 'Payments', perms: {
    'payments.view': 'See payments',
    'payments.record': 'Record manual payments',
    'payments.refund': 'Issue refunds',
  } },
  { key: 'products', label: 'Products & orders', perms: {
    'products.view': 'See products and services',
    'products.edit': 'Edit products and prices',
    'orders.view': 'See orders',
    'orders.edit': 'Create and update orders',
  } },
  { key: 'work', label: 'Jobs, tasks & calendar', perms: {
    'jobs.view': 'See jobs',
    'jobs.edit': 'Create and update jobs',
    'tasks.view': 'See tasks',
    'tasks.edit': 'Create, complete and snooze tasks',
    'calendar.view': 'See the calendar',
    'calendar.edit': 'Book and change appointments',
    'staff.view': 'See staff and workers',
    'staff.edit': 'Add and edit staff and workers',
    'documents.view': 'Open files and photos',
    'documents.edit': 'Upload files and photos',
  } },
  { key: 'comms', label: 'Inbox & marketing', perms: {
    'inbox.view': 'Read conversations',
    'inbox.send': 'Send email/SMS and manage conversations',
    'marketing.view': 'See campaigns, forms and landing pages',
    'marketing.edit': 'Build and send campaigns, forms and pages',
    'automations.view': 'See automations and their runs',
    'automations.edit': 'Build, switch on and off automations',
  } },
  { key: 'insight', label: 'Reports & AI', perms: {
    'reports.view': 'See sales, lead and customer reports',
    'reports.financial': 'See revenue and money reports',
    'ai.use': 'Use the AI assistant',
  } },
  { key: 'admin', label: 'Administration', perms: {
    'settings.manage': 'Change business details, modules and fields',
    'integrations.manage': 'Connect Stripe, email, SMS and API keys',
    'team.manage': 'Invite people and set their access',
    'audit.view': 'See the audit log',
  } },
] as const;

type Group = (typeof PERMISSION_GROUPS)[number];
export type Permission = { [G in Group as G['key']]: keyof G['perms'] }[Group['key']];

export const PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => Object.keys(g.perms) as Permission[]);
export const PERMISSION_LABELS: Record<Permission, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => Object.entries(g.perms)),
) as Record<Permission, string>;

export function isPermission(v: unknown): v is Permission {
  return typeof v === 'string' && (PERMISSIONS as string[]).includes(v);
}

const VIEW_PERMS = PERMISSIONS.filter((p) => p.endsWith('.view'));
const without = (...drop: Permission[]) => PERMISSIONS.filter((p) => !drop.includes(p));

export type DataScope = 'all' | 'assigned';
export type SystemRoleKey = 'admin' | 'manager' | 'staff' | 'accountant' | 'viewer';

/**
 * Starting roles for every master account. Owners can change their permissions
 * (Settings → Team → Roles) and add their own. The database installs the same
 * set for new accounts (app.install_default_roles); a test keeps them in sync.
 */
export const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; description: string; dataScope: DataScope; permissions: Permission[] }> = {
  admin: {
    name: 'Admin',
    description: 'Runs the business: everything including settings, integrations and team.',
    dataScope: 'all',
    permissions: without(),
  },
  manager: {
    name: 'Manager',
    description: 'Customers, sales, quotes, jobs, tasks, inbox, marketing and reports. No invoices, payments or settings.',
    dataScope: 'all',
    permissions: [
      'contacts.view', 'contacts.edit', 'sales.view', 'sales.edit', 'quotes.view', 'quotes.edit',
      'products.view', 'orders.view', 'orders.edit', 'jobs.view', 'jobs.edit', 'tasks.view', 'tasks.edit',
      'calendar.view', 'calendar.edit', 'staff.view', 'staff.edit', 'documents.view', 'documents.edit',
      'inbox.view', 'inbox.send', 'marketing.view', 'marketing.edit', 'automations.view',
      'reports.view', 'ai.use',
    ],
  },
  staff: {
    name: 'Staff',
    description: 'Only the customers, jobs, tasks and appointments assigned to them.',
    dataScope: 'assigned',
    permissions: [
      'contacts.view', 'jobs.view', 'jobs.edit', 'tasks.view', 'tasks.edit', 'calendar.view', 'calendar.edit',
      'staff.view', 'documents.view', 'documents.edit', 'inbox.view', 'inbox.send',
    ],
  },
  accountant: {
    name: 'Accountant',
    description: 'Invoices, payments, refunds and financial reports. Read-only customers and quotes.',
    dataScope: 'all',
    permissions: [
      'contacts.view', 'quotes.view', 'invoices.view', 'invoices.edit', 'payments.view', 'payments.record', 'payments.refund',
      'products.view', 'products.edit', 'orders.view', 'reports.view', 'reports.financial', 'audit.view',
    ],
  },
  viewer: {
    name: 'Viewer',
    description: 'Can look at everything, change nothing.',
    dataScope: 'all',
    permissions: [...VIEW_PERMS, 'reports.financial'],
  },
};

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES) as SystemRoleKey[];

/** A grant resolved for one business: owner = '*'. */
export type Grant = { permissions: '*' | ReadonlySet<string>; assignedOnly: boolean; roleName: string };

export function grantAllows(g: Grant | undefined, perm: Permission) {
  return !!g && (g.permissions === '*' || g.permissions.has(perm));
}
