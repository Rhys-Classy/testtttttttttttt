import {
  BarChart3, Bell, Bot, Building2, CalendarDays, CheckCircle2, ClipboardList, FileText, FolderOpen, Hammer, House, Inbox,
  KanbanSquare, LayoutTemplate, Megaphone, Package, Plug, Receipt, Settings, ShoppingBag, Sparkles, UserCog, Users, Wallet, Workflow,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  BarChart3, Bell, Bot, Building2, CalendarDays, CheckCircle2, ClipboardList, FileText, FolderOpen, Hammer, House, Inbox,
  KanbanSquare, LayoutTemplate, Megaphone, Package, Plug, Receipt, Settings, ShoppingBag, Sparkles, UserCog, Users, Wallet, Workflow,
};

/** Icons referenced by name (module registry is shared with client components). */
export function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? Sparkles;
  return <C className={className ?? 'size-5'} aria-hidden />;
}
