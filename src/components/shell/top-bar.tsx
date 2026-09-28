'use client';

import Link from 'next/link';
import { Bell, Bot, Search } from 'lucide-react';
import { BusinessSwitcher } from './business-switcher';
import { openAssistant, openCommandPalette } from './command-palette';
import type { ShellData } from './types';

export function TopBar({ data }: { data: ShellData }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 md:px-8">
        <div className="min-w-0 flex-1 md:hidden">
          <BusinessSwitcher businesses={data.businesses} currentId={data.currentId} compact />
        </div>
        <button onClick={() => openCommandPalette()}
          className="hidden h-11 flex-1 items-center gap-3 rounded-xl border border-border bg-surface px-4 text-left text-sm text-muted hover:bg-surface-2 md:flex">
          <Search className="size-4" />
          <span className="flex-1">Search or type a command… “invoice John $2,500 plus GST”</span>
          <kbd className="rounded-md border border-border px-1.5 py-0.5 text-xs">⌘K</kbd>
        </button>
        <button onClick={() => openCommandPalette()} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 md:hidden" aria-label="Search">
          <Search className="size-5" />
        </button>
        <button onClick={() => openAssistant()} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2" aria-label="Assistant" title="Assistant">
          <Bot className="size-5" />
        </button>
        <Link href="/notifications" className="relative flex size-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2" aria-label={`Notifications${data.unread ? ` (${data.unread} unread)` : ''}`}>
          <Bell className="size-5" />
          {data.unread ? <span className="absolute right-2 top-2 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-on-solid">{data.unread > 9 ? '9+' : data.unread}</span> : null}
        </Link>
      </div>
    </header>
  );
}
