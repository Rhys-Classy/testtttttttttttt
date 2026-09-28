import { Bell, Building2, History, KeyRound, Layers, ListPlus, Plug, ShieldCheck, User, Users } from 'lucide-react';
import type { Permission } from '@/lib/permissions';

/** Settings screens and who may open them. `owner` = account owner only. */
export const SETTINGS_LINKS: { href: string; label: string; body: string; icon: typeof Bell; need: Permission | 'owner' | 'any' }[] = [
  { href: '/settings/business', label: 'Business details', body: 'Name, ABN, address, GST, invoice numbering, terms, branding', icon: Building2, need: 'settings.manage' },
  { href: '/settings/modules', label: 'Modules', body: 'Switch features on or off for this business', icon: Layers, need: 'settings.manage' },
  { href: '/settings/fields', label: 'Custom fields', body: 'Extra details you track, e.g. kitchen type, timber, service type', icon: ListPlus, need: 'settings.manage' },
  { href: '/settings/integrations', label: 'Integrations', body: 'Stripe, email, SMS, calendars and the AI assistant', icon: Plug, need: 'integrations.manage' },
  { href: '/settings/api', label: 'API keys', body: 'Connect Zapier, your website and other tools', icon: KeyRound, need: 'integrations.manage' },
  { href: '/settings/team', label: 'Team', body: 'Who can open which business, and with what role', icon: Users, need: 'team.manage' },
  { href: '/settings/roles', label: 'Roles', body: 'What Admin, Manager, Staff, Accountant and custom roles can do', icon: ShieldCheck, need: 'owner' },
  { href: '/settings/audit', label: 'Audit log', body: 'Who changed what, and when', icon: History, need: 'audit.view' },
  { href: '/settings/businesses', label: 'Businesses', body: 'Add a new business or archive one', icon: Building2, need: 'owner' },
  { href: '/settings/notifications', label: 'Notifications', body: 'Choose what deserves your attention', icon: Bell, need: 'any' },
  { href: '/settings/account', label: 'My account', body: 'Password, two-step verification, devices, theme', icon: User, need: 'any' },
];
