import { notFound, redirect } from 'next/navigation';
import { db } from './mongo.js';
import { Shop } from './models.js';
import { seedDemoData } from './seed.js';

/** Fetch a shop by its public slug (404 if missing). */
export async function getShopBySlug(slug) {
  await db();
  return Shop.findOne({ slug: String(slug).toLowerCase() });
}

/** The first shop in the DB — the app is single-tenant for the demo. */
export async function getActiveShop() {
  await db();
  let shop = await Shop.findOne().sort({ createdAt: 1 });
  if (!shop) {
    // First run: auto-seed the demo shop so the app works with zero setup.
    await seedDemoData();
    shop = await Shop.findOne().sort({ createdAt: 1 });
  }
  return shop;
}

/** For app (admin) pages: redirect to onboarding when no shop exists yet. */
export async function requireShop() {
  const shop = await getActiveShop();
  if (!shop) redirect('/onboarding');
  return shop;
}