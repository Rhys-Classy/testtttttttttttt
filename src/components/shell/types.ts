export type ShellBusiness = { id: string; name: string; shortName: string | null; color: string; enabledModules: string[] };
export type NavItem = { key: string; label: string; href: string; icon: string; group: string };
export type ShellData = {
  user: { name: string; email: string };
  accountName: string;
  businesses: ShellBusiness[];
  currentId: string | null;
  nav: NavItem[];
  unread: number;
  isOwner: boolean;
  canAdminister: boolean;
  /** Which quick-add / command actions the user's role allows somewhere in view. */
  can: Record<'contacts' | 'leads' | 'deals' | 'tasks' | 'appointments' | 'quotes' | 'invoices' | 'payments' | 'notes' | 'jobs' | 'ai', boolean>;
  tzOffsetMinutes: number;
};
