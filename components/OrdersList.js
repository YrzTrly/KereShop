'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { timeAgo } from '@/lib/format.js';
import { StatusBadge, ChannelBadge } from '@/components/ui.js';

export default function OrdersList({ orders, initialFrom = '', initialTo = '' }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return orders;
    return orders.filter((o) => {
      const cust = o.customer?.name?.toLowerCase() || '';
      const phone = o.customer?.phone || '';
      const itemText = (o.items || []).map((i) => i.name).join(' ').toLowerCase();
      return (
        cust.includes(n) ||
        phone.includes(n.replace(/\D/g, '')) ||
        itemText.includes(n) ||
        (o.location || '').toLowerCase().includes(n)
      );
    });
  }, [q, orders]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            From
            <input type="date" name="from" defaultValue={initialFrom} className="mt-0.5 block rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30" />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            To
            <input type="date" name="to" defaultValue={initialTo} className="mt-0.5 block rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30" />
          </label>
          <button type="submit" className="rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold text-ink transition hover:bg-line-soft">
            Filter
          </button>
        </form>
        {(initialFrom || initialTo) && (
          <Link href="/orders" className="rounded-lg px-2 py-2 text-[12px] font-semibold text-brand hover:underline">
            Clear filter
          </Link>
        )}
      </div>

      <div className="relative max-w-sm">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-inksoft" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customer, item or location…"
          className="w-full rounded-lg border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line bg-panel text-left text-[11px] uppercase tracking-wide text-inksoft">
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Placed</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-inksoft">
                  No orders match “{q}”.
                </td>
              </tr>
            )}
            {filtered.map((o) => (
              <tr key={o.id} className="border-b border-line/60 last:border-0 transition hover:bg-bg/60">
                <td className="px-4 py-3">
                  <div className="font-semibold text-ink">{o.customer?.name || 'Unknown'}</div>
                  {o.customer?.phone && <div className="text-xs text-inksoft">{o.customer.phone}</div>}
                  {o.location && <div className="mt-0.5 text-xs text-inksoft">📍 {o.location}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-[220px]">
                    {o.items.map((it, i) => (
                      <div key={i} className="truncate text-[13px] text-ink">
                        {it.name} <span className="text-inksoft">× {it.qty}</span>
                      </div>
                    ))}
                  </div>
                  {o.transcript && (
                    <div className="mt-1 max-w-[220px] truncate text-[11px] italic text-inksoft" title={o.transcript}>
                      “{o.transcript}”
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{o.total}</td>
                <td className="px-4 py-3"><ChannelBadge channel={o.channel} /></td>
                <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                <td className="whitespace-nowrap px-4 py-3 text-inksoft">{timeAgo(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}