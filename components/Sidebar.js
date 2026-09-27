'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NAV, isActive } from './nav';

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-3 py-3">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-[15px] font-bold text-ink">
        K
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-tight text-ink">KERE SHOP</span>
        <span className="block text-[10px] font-medium uppercase tracking-wider text-faint">
          Your Small Mobile Shop
        </span>
      </span>
    </Link>
  );
}

function NavList({ pathname, onNavigate }) {
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
              active
                ? 'bg-navactive text-ink'
                : 'text-muted hover:bg-line-soft hover:text-ink'
            }`}
          >
            <span className="w-5 text-center text-[15px] leading-none">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Ctas({ onNavigate }) {
  return (
    <div className="flex flex-col gap-2 px-3">
      <Link
        href="/orders/new"
        onClick={onNavigate}
        className="flex items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-[13px] font-bold text-ink transition-colors hover:bg-brand-hover"
      >
        <span className="text-[15px] leading-none">＋</span> Add Order
      </Link>
      <Link
        href="/voice-order"
        onClick={onNavigate}
        className="flex items-center justify-center gap-2 rounded-lg bg-ink px-3 py-2.5 text-[13px] font-bold text-white transition-colors hover:opacity-90"
      >
        <span className="text-[15px] leading-none">🎙</span> Voice Order
      </Link>
    </div>
  );
}

function Footer({ shop, onNavigate }) {
  return (
    <div className="mt-auto px-3 pb-3">
      <Link
        href="/settings"
        onClick={onNavigate}
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-line-soft hover:text-ink"
      >
        <span className="w-5 text-center text-[15px] leading-none">⚙️</span> Settings
      </Link>
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-line-soft px-3 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-panel text-[13px] shadow-sm">
          {shop?.avatar || '🛍️'}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[12px] font-semibold text-ink">{shop?.name || 'My Shop'}</p>
          <p className="truncate text-[10px] text-faint">/{shop?.slug || 'your-slug'}</p>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ shop }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-panel px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-[13px] font-bold text-ink">
            K
          </span>
          <span className="text-[14px] font-bold tracking-tight text-ink">KERE SHOP</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={close} />
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col bg-panel shadow-xl">
            <div className="flex items-center justify-between border-b border-line">
              <Brand />
              <button
                onClick={close}
                aria-label="Close menu"
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-line-soft"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 flex-1">
              <Ctas onNavigate={close} />
              <div className="mt-4">
                <NavList pathname={pathname} onNavigate={close} />
              </div>
            </div>
            <Footer shop={shop} onNavigate={close} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-panel lg:flex">
        <Brand />
        <div className="mt-2">
          <Ctas />
        </div>
        <div className="mt-4 flex-1 overflow-y-auto">
          <NavList pathname={pathname} />
        </div>
        <Footer shop={shop} />
      </aside>
    </>
  );
}