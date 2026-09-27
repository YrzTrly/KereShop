import Link from 'next/link';
import { Customer, Order } from '@/lib/models.js';
import { requireShop } from '@/lib/shop-context.js';
import { money, shortDate, timeAgo, waLink, daysSince } from '@/lib/format.js';
import { StatusBadge, ChannelBadge, StatCard } from '@/components/ui.js';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CustomerProfilePage({ params }) {
  const shop = await requireShop();
  const customer = await Customer.findById(params.id).catch(() => null);
  if (!customer || customer.shop.toString() !== shop._id.toString()) notFound();
  const orders = await Order.find({ customer: customer._id }).sort({ createdAt: -1 });
  const last = customer.lastOrderAt ? new Date(customer.lastOrderAt) : null;
  const lapsed = last && daysSince(last) >= 30;

  const waMessage = `Hi ${customer.name}! 👋 Just checking in — new pieces just landed at ${shop.name}. Want to see this week's picks?`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/customers"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel text-[13px] text-muted hover:text-ink"
          >
            ←
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">{customer.name}</h1>
            <p className="text-[13px] text-muted">
              {customer.phone}
              {customer.email ? ` · ${customer.email}` : ''} · via {customer.source}
            </p>
          </div>
        </div>
        <a
          href={waLink(customer.phone, waMessage)}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-whatsapp px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:opacity-90"
        >
          💬 Send WhatsApp message
        </a>
      </div>

      {lapsed && (
        <div className="flex items-start gap-2.5 rounded-xl border border-bad/30 bg-bad-bg px-4 py-3">
          <span className="text-[15px]">⏰</span>
          <div>
            <p className="text-[13px] font-semibold text-bad">Follow-up needed — {daysSince(last)} days since last order</p>
            <p className="text-[12px] text-muted">Re-engage with a WhatsApp nudge; this customer hasn't ordered in 30+ days.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="💰" label="Total spent" value={money(customer.totalSpent, shop.currency)} tone="brand" />
        <StatCard icon="🧾" label="Orders" value={String(customer.orderCount)} sub={`last ${timeAgo(customer.lastOrderAt)}`} />
        <StatCard icon="🕓" label="Last interaction" value={timeAgo(customer.lastInteractionAt)} sub={customer.lastInteractionAt ? shortDate(customer.lastInteractionAt) : '—'} />
        <StatCard icon="📍" label="Source" value={customer.source} sub="acquisition channel" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-panel p-4">
          <h2 className="text-[13px] font-semibold text-ink">Preferences</h2>
          {customer.preferences?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {customer.preferences.map((p) => (
                <span key={p} className="rounded-full bg-line-soft px-2.5 py-1 text-[11px] font-medium text-ink">
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-faint">No preferences captured yet.</p>
          )}
          {customer.notes && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Notes</p>
              <p className="mt-1 text-[13px] text-ink">{customer.notes}</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-line bg-panel lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13px] font-semibold text-ink">Order history</h2>
            <span className="text-[11px] text-faint">{orders.length} orders</span>
          </div>
          <div className="divide-y divide-line">
            {orders.slice(0, 8).map((o) => (
              <div key={o._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                  </p>
                  <p className="text-[11px] text-faint">
                    {shortDate(o.createdAt)} · {timeAgo(o.createdAt)}
                    {o.location ? ` · ${o.location}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-semibold text-ink">{money(o.total, shop.currency)}</span>
                  <StatusBadge status={o.status} />
                  <ChannelBadge channel={o.channel} />
                </div>
              </div>
            ))}
            {orders.length === 0 && (
              <p className="px-4 py-6 text-center text-[13px] text-faint">No orders yet — send a welcome message to get started.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}