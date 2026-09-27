import { Customer, Order } from '@/lib/models.js';
import { requireShop } from '@/lib/shop-context.js';
import { money } from '@/lib/format.js';
import OrdersList from '@/components/OrdersList.js';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({ searchParams }) {
  const shop = await requireShop();
  const sp = (await searchParams) || {};

  // Optional date-range filter (from/to as YYYY-MM-DD from the filter form).
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from || '') ? new Date(`${sp.from}T00:00:00.000Z`) : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to || '') ? new Date(`${sp.to}T23:59:59.999Z`) : null;
  const createdFilter = {};
  if (from) createdFilter.$gte = from;
  if (to) createdFilter.$lte = to;

  const orders = await Order.find({ shop: shop._id, ...(Object.keys(createdFilter).length ? { createdAt: createdFilter } : {}) })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate('customer', 'name phone');

  const total = orders.reduce((s, o) => s + (o.status !== 'cancelled' ? o.total : 0), 0);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Orders</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            {orders.length} orders · {money(total, shop.currency)} booked
          </p>
        </div>
        <Link
          href="/orders/new"
          className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-branddark"
        >
          + Add Order
        </Link>
      </div>
      <OrdersList
        orders={orders.map((o) => ({
          id: o._id.toString(),
          customer: o.customer ? { name: o.customer.name, phone: o.customer.phone } : null,
          items: o.items,
          total: money(o.total, shop.currency),
          status: o.status,
          channel: o.channel,
          location: o.location,
          transcript: o.transcript,
          createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : null,
        }))}
        initialFrom={sp.from || ''}
        initialTo={sp.to || ''}
      />
    </div>
  );
}