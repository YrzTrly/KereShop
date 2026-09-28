import { NextResponse } from 'next/server';
import { Order } from '@/lib/models.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['pending', 'confirmed', 'delivered', 'cancelled'];

/**
 * PATCH /api/orders/[id] — update an order's status from the dashboard dropdown.
 * Body: { status: 'pending' | 'confirmed' | 'delivered' | 'cancelled' }
 */
export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const status = String(body.status || '');
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Use one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    const order = await Order.findById(id);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    order.status = status;
    await order.save();
    return NextResponse.json({ ok: true, id: order._id.toString(), status: order.status });
  } catch (err) {
    const status = err.status || 500;
    return NextResponse.json({ error: err.message || 'Failed to update order' }, { status });
  }
}