'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { timeAgo } from '@/lib/format.js';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function OrdersList({ orders, initialFrom = '', initialTo = '', initialStatus = '' }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initialStatus);
  const [rows, setRows] = useState(orders);
  const [busyId, setBusyId] = useState('');

  // If the parent ever hands us new orders (refetch), follow them until the user edits a row.
  useEffect(() => {
    if (orders && orders !== rows) setRows(orders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const filtered = useMemo(() => {
    let list = rows;
    if (status) list = list.filter((o) => o.status === status);
    const n = q.trim().toLowerCase();
    if (!n) return list;
    return list.filter((o) => {
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
  }, [q, rows, status]);

  async function updateStatus(orderId, newStatus) {
    const prev = rows.find((o) => o.id === orderId)?.status;
    // Optimistic update, roll back on failure.
    setRows((rs) => rs.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
    setBusyId(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`Status update failed (${res.status})`);
    } catch {
      if (prev) setRows((rs) => rs.map((o) => (o.id === orderId ? { ...o, status: prev } : o)));
      alert('Could not update order status. Please try again.');
    } finally {
      setBusyId('');
    }
  }

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
          <label className="text-[11px] font-semibold uppercase tracking-wide text-faint">
            Status
            <select
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-0.5 block rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-semibold text-ink transition hover:bg-line-soft">
            Filter
          </button>
        </form>
        {(initialFrom || initialTo || initialStatus) && (
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
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-line bg-panel text-left text-[11px] uppercase tracking-wide text-inksoft">
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Placed</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-inksoft">
                  No orders match your filters.
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
                <td className="px-4 py-3">
                  <select
                    value={o.status}
                    disabled={busyId === o.id}
                    onChange={(e) => updateStatus(o.id, e.target.value)}
                    className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] font-semibold text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:cursor-wait disabled:opacity-60"
                    aria-label={`Status for order ${o.customer?.name || o.id}`}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-inksoft">{timeAgo(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}