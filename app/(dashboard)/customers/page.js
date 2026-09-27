import { Customer } from '@/lib/models.js';
import { requireShop } from '@/lib/shop-context.js';
import { money } from '@/lib/format.js';
import CustomersList from '@/components/CustomersList.js';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }) {
  const shop = await requireShop();
  const sp = (await searchParams) || {};

  // Optional date-range filter on the customer's last order date.
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from || '') ? new Date(`${sp.from}T00:00:00.000Z`) : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to || '') ? new Date(`${sp.to}T23:59:59.999Z`) : null;
  const lastOrderFilter = {};
  if (from) lastOrderFilter.$gte = from;
  if (to) lastOrderFilter.$lte = to;

  const customers = await Customer.find({ shop: shop._id, ...(Object.keys(lastOrderFilter).length ? { lastOrderAt: lastOrderFilter } : {}) }).sort({ lastOrderAt: -1, createdAt: -1 });
  const lapsed = customers.filter((c) => {
    if (!c.lastOrderAt) return false;
    return (Date.now() - new Date(c.lastOrderAt).getTime()) / 86400000 >= 30;
  }).length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Customers</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            {customers.length} customers · {lapsed} need a follow-up
          </p>
        </div>
      </div>
      <CustomersList
        customers={customers.map((c) => ({
          id: c._id.toString(),
          name: c.name,
          phone: c.phone,
          totalSpent: money(c.totalSpent, shop.currency),
          orderCount: c.orderCount,
          lastOrderAt: c.lastOrderAt ? new Date(c.lastOrderAt).toISOString() : null,
          lastInteractionAt: c.lastInteractionAt ? new Date(c.lastInteractionAt).toISOString() : null,
          source: c.source,
          preferences: c.preferences || [],
          lapsed: (Date.now() - new Date(c.lastOrderAt || 0).getTime()) / 86400000 >= 30 && !!c.lastOrderAt,
        }))}
        initialFrom={sp.from || ''}
        initialTo={sp.to || ''}
      />
    </div>
  );
}