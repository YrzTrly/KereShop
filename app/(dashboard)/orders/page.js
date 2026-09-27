import { Customer, Order } from '@/lib/models.js';
import { requireShop } from '@/lib/shop-context.js';
import { money } from '@/lib/format.js';
import OrdersList from '@/components/OrdersList.js';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const shop = await requireShop();
  const orders = await Order.find({ shop: shop._id })
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
      />
    </div>
  );
}