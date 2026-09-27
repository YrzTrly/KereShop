import { db } from '@/lib/mongo.js';
import { Shop, Product } from '@/lib/models.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'my-shop';
}

async function uniqueSlug(base) {
  let slug = base;
  let i = 2;
  while (await Shop.findOne({ slug })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

function serializeShop(shop) {
  return {
    id: shop._id.toString(),
    name: shop.name,
    slug: shop.slug,
    category: shop.category,
    bio: shop.bio,
    whatsapp: shop.whatsapp,
    instagram: shop.instagram,
    currency: shop.currency,
    avatar: shop.avatar,
  };
}

/** GET — active shop + its active products. */
export async function GET() {
  await db();
  const shop = await Shop.findOne().sort({ createdAt: 1 });
  if (!shop) return Response.json({ error: 'No shop yet' }, { status: 404 });
  const products = await Product.find({ shop: shop._id, active: true }).sort({ createdAt: 1 });
  return Response.json({
    shop: serializeShop(shop),
    products: products.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      price: p.price,
      image: p.image,
      description: p.description,
      tags: p.tags,
    })),
  });
}

/** POST — create a shop (onboarding). Accepts { name, category, bio, whatsapp, instagram, avatar, currency, products: [...] }. */
export async function POST(req) {
  await db();
  if (await Shop.countDocuments() > 0) {
    return Response.json({ error: 'A shop already exists for this demo workspace' }, { status: 409 });
  }
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return Response.json({ error: 'Business name is required' }, { status: 400 });

  const slug = await uniqueSlug(slugify(name));
  const shop = await Shop.create({
    name,
    slug,
    category: String(body.category || 'Fashion & Ankara'),
    bio: String(body.bio || ''),
    whatsapp: String(body.whatsapp || ''),
    instagram: String(body.instagram || ''),
    currency: String(body.currency || 'NGN'),
    avatar: String(body.avatar || '🛍️'),
  });

  const products = Array.isArray(body.products) ? body.products : [];
  if (products.length) {
    await Product.insertMany(
      products
        .filter((p) => p && String(p.name || '').trim())
        .map((p) => ({
          shop: shop._id,
          name: String(p.name).trim(),
          price: Number(p.price) || 0,
          image: String(p.image || ''),
          description: String(p.description || ''),
          tags: Array.isArray(p.tags) ? p.tags : [],
        }))
    );
  }

  return Response.json({ shop: serializeShop(shop) }, { status: 201 });
}

/** PATCH — update shop info and/or products (settings page). */
export async function PATCH(req) {
  await db();
  const shop = await Shop.findOne().sort({ createdAt: 1 });
  if (!shop) return Response.json({ error: 'No shop yet' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const EDITABLE = ['name', 'category', 'bio', 'whatsapp', 'instagram', 'currency', 'avatar'];
  for (const key of EDITABLE) {
    if (body[key] !== undefined) shop[key] = String(body[key]);
  }
  if (body.name !== undefined && !String(body.name).trim()) {
    return Response.json({ error: 'Business name cannot be empty' }, { status: 400 });
  }
  if (body.name !== undefined) {
    const nextSlug = slugify(body.name);
    if (nextSlug !== shop.slug) {
      shop.slug = await uniqueSlug(nextSlug + (nextSlug === shop.slug ? '' : '-new'));
    }
  }
  await shop.save();

  if (Array.isArray(body.products)) {
    // Replace the active catalog: keep it simple and predictable for the demo.
    await Product.deleteMany({ shop: shop._id });
    await Product.insertMany(
      body.products
        .filter((p) => p && String(p.name || '').trim())
        .map((p) => ({
          shop: shop._id,
          name: String(p.name).trim(),
          price: Number(p.price) || 0,
          image: String(p.image || ''),
          description: String(p.description || ''),
          tags: Array.isArray(p.tags) ? p.tags : [],
        }))
    );
  }

  const products = await Product.find({ shop: shop._id, active: true }).sort({ createdAt: 1 });
  return Response.json({
    shop: serializeShop(shop),
    products: products.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      price: p.price,
      image: p.image,
      description: p.description,
      tags: p.tags,
    })),
  });
}