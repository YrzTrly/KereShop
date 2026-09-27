import { Customer, Order } from './models.js';
import { normalizePhone } from './format.js';

/**
 * Create (or fetch) a customer for a shop and record an order against them,
 * keeping totalSpent / orderCount / lastOrderAt / lastInteractionAt in sync.
 */
export async function createOrder({ shop, name, phone, items, status = 'pending', channel = 'manual', location = '', notes = '', transcript = '', total: totalOverride }) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('At least one item is required');
    err.status = 400;
    throw err;
  }
  const cleanName = String(name || '').trim() || 'Walk-in customer';
  const cleanPhone = normalizePhone(phone || '');
  if (!cleanPhone) {
    const err = new Error('A phone number is required');
    err.status = 400;
    throw err;
  }

  let customer = await Customer.findOne({ shop: shop._id, phone: cleanPhone });
  if (!customer) {
    customer = await Customer.create({
      shop: shop._id,
      name: cleanName,
      phone: cleanPhone,
      source: channel === 'voice' ? 'voice' : channel === 'manual' ? 'manual' : channel,
      lastInteractionAt: new Date(),
    });
  } else if (cleanName && cleanName !== 'Walk-in customer' && !customer.name) {
    customer.name = cleanName;
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const knownPrefs = new Set(customer.preferences.map(norm));
  for (const it of items) {
    const tag = norm(it.name);
    if (tag && !knownPrefs.has(tag)) {
      customer.preferences.push(it.name);
      knownPrefs.add(tag);
    }
  }

  const lineItems = items.map((it) => ({
    name: String(it.name || '').trim(),
    qty: Math.max(1, Number(it.qty) || 1),
    price: Math.max(0, Number(it.price) || 0),
  }));
  const computedTotal = lineItems.reduce((sum, it) => sum + it.qty * it.price, 0);
  const total = totalOverride != null ? Math.max(0, Number(totalOverride) || 0) : computedTotal;

  const order = await Order.create({
    shop: shop._id,
    customer: customer._id,
    items: lineItems,
    total,
    status,
    channel,
    location: String(location || '').trim(),
    notes: String(notes || '').trim(),
    transcript: String(transcript || '').trim(),
  });

  customer.totalSpent += total;
  customer.orderCount += 1;
  customer.lastOrderAt = new Date();
  customer.lastInteractionAt = new Date();
  await customer.save();

  return { order, customer };
}