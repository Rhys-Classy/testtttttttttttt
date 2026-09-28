export type ShellBusiness = { id: string; name: string; shortName: string | null; color: string; enabledModules: string[] };
export type NavItem = { key: string; label: string; href: string; icon: string; group: string };
export type ShellData = {
  user: { name: string; email: string };
  accountName: string;
  businesses: ShellBusiness[];
  currentId: string | null;
  nav: NavItem[];
  unread: number;
  isAccountAdmin: boolean;
  tzOffsetMinutes: number;
};
