'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { daysSince, money, timeAgo } from '@/lib/format.js';

const LAPSED_DAYS = 30;

function statusFor(customer) {
  const d = daysSince(customer.lastOrderAt);
  if (d == null) return { label: 'New', cls: 'bg-line-soft text-ink' };
  if (d >= LAPSED_DAYS) return { label: `Follow up · ${d}d`, cls: 'bg-bad-bg text-bad' };
  if (d >= 7) return { label: 'Slowing', cls: 'bg-brand-soft text-inkbrand' };
  return { label: 'Active', cls: 'bg-ok-bg text-ok' };
}

export default function CustomersList({ customers, currency }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(n) ||
        c.phone.includes(n.replace(/\D/g, '')) ||
        (c.preferences || []).some((p) => p.toLowerCase().includes(n))
    );
  }, [q, customers]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-inksoft" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone or preference…"
          className="w-full rounded-lg border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-inksoft">
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Orders</th>
              <th className="px-4 py-3">Total spent</th>
              <th className="px-4 py-3">Last order</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-inksoft">
                  No customers match “{q}”.
                </td>
              </tr>
            )}
            {filtered.map((c) => {
              const st = statusFor(c);
              return (
                <tr key={c.id} className="border-b border-line/60 last:border-0 transition hover:bg-bg/60">
                  <td className="px-4 py-3">
                    <Link href={`/customers/${c.id}`} className="font-semibold text-ink transition hover:text-inkbrand">
                      {c.name}
                    </Link>
                    {c.preferences?.length > 0 && (
                      <div className="mt-0.5 truncate text-xs text-inksoft">{c.preferences.slice(0, 3).join(' · ')}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-inksoft">{c.phone}</td>
                  <td className="px-4 py-3">{c.orderCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">{money(c.totalSpent, currency)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-inksoft">{timeAgo(c.lastOrderAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}