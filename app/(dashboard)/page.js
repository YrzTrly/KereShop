import Link from 'next/link';
import { requireShop } from '@/lib/shop-context.js';
import { Customer, Order } from '@/lib/models.js';
import { money, shortDate, timeAgo, daysSince, waLink } from '@/lib/format.js';
import { StatCard, StatusBadge, PageHeader } from '@/components/ui.js';
import { getDailyMetrics } from '@/lib/daily-metrics.js';

export const dynamic = 'force-dynamic';

const DAY = 86400000;

export default async function DashboardPage() {
  const shop = await requireShop();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY);

  const [todayAgg, totalCustomers, followUps, recentOrders, daily] = await Promise.all([
    Order.aggregate([
      { $match: { shop: shop._id, createdAt: { $gte: startOfToday }, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
    Customer.countDocuments({ shop: shop._id }),
    Customer.find({ shop: shop._id, lastOrderAt: { $ne: null, $lt: thirtyDaysAgo } })
      .sort({ lastOrderAt: 1 })
      .limit(8),
    Order.find({ shop: shop._id })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('customer', 'name phone'),
    getDailyMetrics(shop._id, 14),
  ]);

  const maxDaily = Math.max(...daily.map((d) => d.revenue), 1);

  const todayRevenue = todayAgg[0]?.revenue || 0;
  const todayOrders = todayAgg[0]?.count || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${shop.ownerName?.trim() || 'there'}`}
        subtitle={`Here's what's happening at ${shop.name} today.`}
        action={
          <Link
            href={`/${shop.slug}`}
            target="_blank"
            className="rounded-lg border border-line bg-panel px-3 py-2 text-[13px] font-semibold text-ink transition-colors hover:bg-line-soft"
          >
            View storefront ↗
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today's Revenue" value={money(todayRevenue, shop.currency)} accent />
        <StatCard label="Today's Orders" value={String(todayOrders)} />
        <StatCard label="Total Customers" value={String(totalCustomers)} />
        <StatCard label="Follow-ups Needed" value={String(followUps.length)} alert={followUps.length > 0} />
      </div>

      {/* Daily sales — last 14 days */}
      <div className="rounded-xl border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-bold text-ink">Daily Sales · Last 14 Days</h2>
          <p className="text-[11px] text-muted">
            {money(daily.reduce((s, d) => s + d.revenue, 0), shop.currency)} total · {daily.reduce((s, d) => s + d.orders, 0)} orders · {daily.reduce((s, d) => s + d.items, 0)} items
          </p>
        </div>
        <div className="flex h-36 items-end gap-1 px-4 pb-2 pt-4">
          {daily.map((d) => (
            <div
              key={d.date}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${d.date} · ${money(d.revenue, shop.currency)} · ${d.orders} order(s) · ${d.items} item(s)`}
            >
              <div
                className="w-full rounded-t bg-brand/70 transition-colors group-hover:bg-brand"
                style={{ height: `${d.revenue > 0 ? Math.max((d.revenue / maxDaily) * 100, 6) : 2}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-1 px-4 pb-3">
          {daily.map((d) => (
            <div key={d.date} className="flex-1 text-center text-[9px] text-faint">
              {d.date.slice(5)}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent orders */}
        <div className="lg:col-span-2 rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-bold text-ink">Recent Orders</h2>
            <Link href="/orders" className="text-[12px] font-semibold text-brand hover:underline">
              View all
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-faint">
                  <th className="px-4 py-2 font-semibold">Customer</th>
                  <th className="px-4 py-2 font-semibold">Items</th>
                  <th className="px-4 py-2 font-semibold">Total</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted">
                      No orders yet. Add one to get started.
                    </td>
                  </tr>
                )}
                {recentOrders.map((o) => (
                  <tr key={o._id} className="border-t border-line">
                    <td className="px-4 py-3 font-semibold text-ink">{o.customer?.name || '—'}</td>
                    <td className="px-4 py-3 text-muted">{o.items.reduce((n, i) => n + i.qty, 0)} item(s)</td>
                    <td className="px-4 py-3 font-semibold text-ink">{money(o.total, shop.currency)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-4 py-3 text-muted">{timeAgo(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Follow-ups panel */}
        <div className="rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-bold text-ink">Follow-ups Needed</h2>
            <Link href="/customers" className="text-[12px] font-semibold text-brand hover:underline">
              All
            </Link>
          </div>
          <div className="divide-y divide-line">
            {followUps.length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] text-muted">
                No customers are up for a follow-up. 🎉
              </p>
            )}
            {followUps.map((c) => (
              <div key={c._id} className="flex items-center justify-between gap-2 px-4 py-3">
                <Link href={`/customers/${c._id}`} className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink hover:text-brand">{c.name}</p>
                  <p className="text-[11px] text-faint">
                    Last order {daysSince(c.lastOrderAt)}d ago · {money(c.totalSpent, shop.currency)}
                  </p>
                </Link>
                <a
                  href={waLink(c.phone, `Hi ${c.name.split(' ')[0]}! It's ${shop.name} — we'd love to reconnect. Anything you're looking for this season?`)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg bg-wa px-2.5 py-1.5 text-[11px] font-bold text-white transition-opacity hover:opacity-90"
                >
                  Message
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}