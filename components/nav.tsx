'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const pathname = usePathname();

  const tabs = [
    { href: '/', label: 'Overview' },
    { href: '/queue', label: 'Queue' },
    { href: '/triage', label: 'Inbox' },
    { href: '/paste', label: 'Paste' },
    { href: '/network', label: 'Network' },
    { href: '/search', label: 'Search' },
    { href: '/goals', label: 'Goals' },
    { href: '/style', label: 'Style' },
  ];

  return (
    <header className="border-b border-[var(--rule)] bg-[var(--paper)] sticky top-0 z-10">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between px-7 py-3.5">
        <div className="flex items-baseline gap-3.5">
          <Link href="/" className="serif text-[26px] italic font-medium tracking-tight">
            Reach
          </Link>
          <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-3)]">
            · networks, mapped
          </span>
        </div>
        <nav className="flex items-center gap-1 flex-wrap">
          {tabs.map(t => (
            <Link
              key={t.href}
              href={t.href}
              className={`px-2.5 py-1.5 rounded-full text-[11px] mono uppercase tracking-[0.1em] transition-colors ${
                pathname === t.href
                  ? 'bg-[var(--ink)] text-[var(--paper)]'
                  : 'text-[var(--ink-2)] hover:bg-[var(--paper-2)]'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
