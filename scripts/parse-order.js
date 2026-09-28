#!/usr/bin/env node
/**
 * Replay a transcript file through the order parser.
 * Usage: node scripts/parse-order.js <transcript.txt>
 *
 * Mirrors the voice-order pipeline: parseOrderText -> matchProduct against
 * the shop catalog (when MONGODB_URI is reachable) -> priced items + total.
 */
import { readFile } from 'node:fs/promises';
import { parseOrderText, matchProduct } from '../lib/parse-order.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/parse-order.js <transcript.txt>');
  process.exit(1);
}

const text = await readFile(file, 'utf8');
const parsed = await parseOrderText(text);

// Load the active catalog when a DB is available, so the replay matches
// exactly what POST /api/voice-order does (never trust the AI for pricing).
let products = [];
if (process.env.MONGODB_URI) {
  try {
    const { default: mongoose } = await import('mongoose');
    const { Product, Shop } = await import('../lib/models.js');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    const shop = await Shop.findOne();
    if (shop) {
      products = await Product.find({ shop: shop._id, active: true });
    }
    await mongoose.disconnect();
  } catch (e) {
    products = [];
  }
}

const items = parsed.items.map((it) => {
  const match = matchProduct(it.name, products);
  return {
    name: it.name,
    qty: it.qty,
    catalogMatch: match ? match.name : null,
    unitPrice: match ? match.price : 0,
  };
});

const out = {
  source: file,
  parsedBy: parsed.parsedBy,
  name: parsed.name,
  phone: parsed.phone,
  items,
  location: parsed.location,
  total: items.reduce((s, it) => s + it.unitPrice * it.qty, 0),
};
console.log(JSON.stringify(out, null, 2));