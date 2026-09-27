import { Order } from './models.js';

const DAY = 86400000;

/**
 * Aggregate a shop's orders per calendar day (UTC) for the last `days` days.
 * Returns rows oldest-first: { date: 'YYYY-MM-DD', revenue, orders, items }.
 * Days with no orders are zero-filled so the chart is continuous.
 *
 * Item totals are summed in JS from the fetched orders: $sum over array paths
 * ($items.qty) is unreliable on some in-memory MongoDB builds used for local
 * demo mode, and a small shop's daily order volume is trivially cheap to
 * fetch.
 */
export async function getDailyMetrics(shopId, days = 14) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setTime(start.getTime() - (days - 1) * DAY);

  const orders = await Order.find({
    shop: shopId,
    createdAt: { $gte: start },
    status: { $ne: 'cancelled' },
  }).select({ total: 1, items: 1, createdAt: 1 });

  const byDate = new Map();
  for (const o of orders) {
    const key = o.createdAt.toISOString().slice(0, 10);
    let row = byDate.get(key);
    if (!row) {
      row = { date: key, revenue: 0, orders: 0, items: 0 };
      byDate.set(key, row);
    }
    row.revenue += o.total || 0;
    row.orders += 1;
    for (const item of o.items || []) {
      row.items += item.qty || 0;
    }
  }

  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY);
    const key = d.toISOString().slice(0, 10);
    const row = byDate.get(key);
    out.push({
      date: key,
      revenue: row?.revenue || 0,
      orders: row?.orders || 0,
      items: row?.items || 0,
    });
  }
  return out;
}