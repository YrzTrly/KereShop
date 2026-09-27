import { NextResponse } from 'next/server';
import { requireShop } from '@/lib/shop-context.js';
import { Product } from '@/lib/models.js';
import { createOrder } from '@/lib/order-service.js';
import { matchProduct } from '@/lib/parse-order.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/orders — create an order (manual form, storefront checkout, voice capture).
 * Body: { name, phone, items: [{name, qty, price?}], location?, notes?, status?, channel?, transcript?, total? }
 * The manual form also sends the customer nested: { customer: { name, phone, notes } } —
 * both shapes are accepted, with the nested customer winning when present.
 * Prices are resolved from the shop catalog when possible — the AI/form never gets
 * to decide what a listed product is worth.
 */
export async function POST(req) {
  try {
    const shop = await requireShop();
    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
    }

    const products = await Product.find({ shop: shop._id, active: true }).lean();

    const resolvedItems = items.map((it) => {
      const name = String(it.name || '').trim();
      const qty = Math.max(1, Number(it.qty) || 1);
      const match = matchProduct(name, products);
      const price = match ? match.price : Math.max(0, Number(it.price) || 0);
      return { name: match ? match.name : name, qty, price };
    });

    const { order } = await createOrder({
      shop,
      name: body.customer?.name || body.name,
      phone: body.customer?.phone || body.phone,
      items: resolvedItems,
      status: body.status || 'pending',
      channel: body.channel || 'manual',
      location: body.location,
      notes: body.customer?.notes || body.notes,
      transcript: body.transcript,
      total: body.total,
    });

    return NextResponse.json({ ok: true, orderId: order._id.toString() }, { status: 201 });
  } catch (err) {
    const status = err.status || 500;
    return NextResponse.json({ error: err.message || 'Failed to create order' }, { status });
  }
}