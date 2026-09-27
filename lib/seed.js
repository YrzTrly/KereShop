import { db } from './mongo.js';
import { Shop, Product, Customer, Order } from './models.js';

const DAY = 86400000;
const daysAgo = (n, hours = 0) => new Date(Date.now() - n * DAY - hours * 3600000);

function productImage(emoji, from, to) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><text x="300" y="330" font-size="170" text-anchor="middle">${emoji}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const CATALOG = [
  { name: 'Ankara Wrap Dress', price: 25000, emoji: '👗', colors: ['#7c2d92', '#f5b301'], tags: ['ankara', 'dress'], description: 'Full-length wrap dress in bold ankara print. Fits S–XL.' },
  { name: 'Gele Headwrap', price: 3500, emoji: '🧕', colors: ['#c2410c', '#fda4af'], tags: ['headwrap'], description: 'Hand-geled soft gele, festive colours.' },
  { name: 'Aso Oke Shirt', price: 18000, emoji: '👕', colors: ['#15803d', '#a3e635'], tags: ['aso-oke', 'shirt'], description: 'Stitched aso oke shirt, ready to wear.' },
  { name: 'Lace Gown', price: 35000, emoji: '💃', colors: ['#1e3a8a', '#93c5fd'], tags: ['lace', 'gown'], description: 'Premium lace gown, beaded neckline.' },
  { name: 'Ankara Skirt Set', price: 22000, emoji: '🥻', colors: ['#be123c', '#fecdd3'], tags: ['ankara', 'skirt'], description: 'Two-piece ankara skirt and blouse set.' },
  { name: 'Beaded Top', price: 12500, emoji: '✨', colors: ['#4c1d95', '#c4b5fd'], tags: ['beaded'], description: 'Delicate beaded party top.' },
  { name: 'Embroidered Kaftan', price: 45000, emoji: '👘', colors: ['#0f766e', '#5eead4'], tags: ['kaftan', 'embroidered'], description: 'Flowing embroidered kaftan, occasions wear.' },
  { name: 'Ipele Headtie', price: 4000, emoji: '🎀', colors: ['#a21caf', '#f0abfc'], tags: ['headtie'], description: 'Soft ipele headtie in seasonal colours.' },
];

/** Customers: recent + lapsed (30+ days) so the follow-up widget has data. */
const CUSTOMERS = [
  { name: 'Chidinma Okafor', phone: '2348031112233', source: 'whatsapp', prefs: ['Ankara dresses', 'Fits L', 'Lekki delivery'] },
  { name: 'Amara Eze', phone: '2348124456789', source: 'storefront', prefs: ['Lace gowns', 'Budget under ₦40k'] },
  { name: 'Tobi Balogun', phone: '2349051234567', source: 'instagram', prefs: ['Aso oke', 'Custom stitching'] },
  { name: 'Amina Yusuf', phone: '2348167778899', source: 'whatsapp', prefs: ['Beaded tops', 'Victoria Island'] },
  { name: 'Blessing Obi', phone: '2348098887766', source: 'voice', prefs: ['Skirt sets', 'Ikeja'] },
  { name: 'Funke Adeyemi', phone: '2348052223344', source: 'whatsapp', prefs: ['Kaftans', 'Abuja'] },
  { name: 'Ngozi Udeh', phone: '2348135556677', source: 'storefront', prefs: ['Ankara', 'Enugu'] },
  { name: 'Kemi Johnson', phone: '2348079990011', source: 'instagram', prefs: ['Headwraps', 'Lagos'] },
];

/** [customerIndex, daysAgo, hoursOffset, items [productIdx, qty], status, channel] */
const ORDERS = [
  [0, 0, 2, [[0, 1], [1, 2]], 'pending', 'whatsapp'],
  [4, 0, 5, [[4, 1]], 'confirmed', 'voice'],
  [1, 3, 4, [[3, 1]], 'delivered', 'storefront'],
  [2, 6, 1, [[2, 2]], 'delivered', 'instagram'],
  [3, 9, 3, [[5, 1], [7, 1]], 'delivered', 'whatsapp'],
  [0, 16, 2, [[0, 1], [5, 1]], 'delivered', 'whatsapp'],
  [1, 21, 6, [[3, 1], [1, 1]], 'delivered', 'storefront'],
  [2, 28, 2, [[2, 1]], 'delivered', 'instagram'],
  [5, 45, 3, [[6, 1]], 'delivered', 'whatsapp'],
  [6, 38, 5, [[0, 1]], 'delivered', 'storefront'],
  [7, 62, 4, [[7, 2], [1, 1]], 'delivered', 'instagram'],
  [0, 33, 1, [[4, 1]], 'cancelled', 'whatsapp'],
];

/**
 * Seeds the demo shop (Kere Fashion) with products, customers and orders.
 * Idempotent: does nothing when the kere-fashion shop already exists.
 */
export async function seedDemoData() {
  await db();

  const existing = await Shop.findOne({ slug: 'kere-fashion' });
  if (existing) return { created: false, shop: existing };

  const shop = await Shop.create({
    name: 'Kere Fashion',
    slug: 'kere-fashion',
    category: 'Fashion & Ankara',
    bio: 'Ready-to-wear ankara, lace & aso oke. Lagos-based, we deliver nationwide. DM to order — voice notes welcome! 🎙️',
    whatsapp: '2348012345678',
    instagram: '@kerefashion',
    currency: 'NGN',
    avatar: '🛍️',
  });

  const products = await Product.create(
    CATALOG.map((p) => ({
      shop: shop._id,
      name: p.name,
      price: p.price,
      image: productImage(p.emoji, p.colors[0], p.colors[1]),
      description: p.description,
      tags: p.tags,
      active: true,
    }))
  );

  const customers = await Customer.create(
    CUSTOMERS.map((c) => ({
      shop: shop._id,
      name: c.name,
      phone: c.phone,
      source: c.source,
      preferences: c.prefs,
    }))
  );

  const orderDocs = ORDERS.map(([ci, d, h, items, status, channel]) => ({
    shop: shop._id,
    customer: customers[ci]._id,
    items: items.map(([pi, qty]) => ({
      name: products[pi].name,
      qty,
      price: products[pi].price,
    })),
    total: items.reduce((s, [pi, qty]) => s + products[pi].price * qty, 0),
    status,
    channel,
    location: ci % 2 === 0 ? 'Lekki, Lagos' : 'Victoria Island, Lagos',
    createdAt: daysAgo(d, h),
    updatedAt: daysAgo(d, h),
  }));
  await Order.create(orderDocs);

  // Recompute customer metrics from the orders just written.
  for (const c of customers) {
    const orders = orderDocs.filter((o) => o.customer.equals(c._id) && o.status !== 'cancelled');
    c.totalSpent = orders.reduce((s, o) => s + o.total, 0);
    c.orderCount = orders.length;
    c.lastOrderAt = orders.length ? new Date(Math.max(...orders.map((o) => o.createdAt.getTime()))) : null;
    c.lastInteractionAt = c.lastOrderAt;
    await c.save();
  }

  return { created: true, shop, products: products.length, customers: customers.length, orders: orderDocs.length };
}