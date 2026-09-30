import { db } from '@/lib/mongo.js';
import { Shop, Product } from '@/lib/models.js';
import { isMultipart, parseMultipartForm, ImageUploadError } from '@/lib/imageUpload.js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensureUploadDir } from '@/lib/uploads.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'my-shop';
}

/**
 * Parse `products` as a JSON array (multipart forms send it as a string) and
 * replace each entry's `image` with the local `/api/files/<name>` URL of the
 * matching `image-<index>` file part. Pasted/uploaded URL strings pass
 * through unchanged, so existing products keep working.
 *
 * @returns {{ products: Array<object> } | { error: string, status: number }}
 */
async function resolveCatalogProducts(rawProducts, files) {
  let products;
  try {
    products = JSON.parse(rawProducts);
  } catch {
    return { error: 'Invalid "products" payload — expected a JSON array', status: 400 };
  }
  if (!Array.isArray(products)) {
    return { error: 'Invalid "products" payload — expected a JSON array', status: 400 };
  }

  const imagesByIndex = new Map();
  const singleImage = files?.find((f) => f.fieldname === 'image') || null;
  if (files?.length) {
    for (const file of files) {
      const match = /^image-(\d+)$/.exec(file.fieldname);
      if (match) imagesByIndex.set(Number(match[1]), file);
    }
  }

  const resolved = [];
  for (const [index, product] of products.entries()) {
    if (!product || typeof product !== 'object' || !String(product.name || '').trim()) continue;
    const entry = {
      name: String(product.name).trim(),
      price: Number(product.price) || 0,
      image: String(product.image || ''),
      description: String(product.description || ''),
      tags: Array.isArray(product.tags) ? product.tags : [],
    };
    const file = imagesByIndex.get(index) || (index === 0 ? singleImage : null);
    if (file) {
      const localUrl = await saveImageLocally(file.buffer, file.mimetype);
      if (!localUrl) {
        return { error: 'Unsupported image type — use PNG, JPG, WebP, GIF or AVIF.', status: 400 };
      }
      entry.image = localUrl;
    }
    resolved.push(entry);
  }
  return { products: resolved };
}

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
};

/**
 * Save an uploaded image buffer to the local upload directory (data/uploads
 * by default, /tmp fallback on serverless — see lib/uploads.js) and return
 * its public `/api/files/<name>` URL. Returns null for unsupported MIME
 * types so the caller can reject with a clear error.
 */
async function saveImageLocally(buffer, mimetype) {
  const ext = EXT_BY_MIME[mimetype];
  if (!ext) return null;
  const uploadDir = await ensureUploadDir();
  const name = `${randomBytes(16).toString('hex')}${ext}`;
  await writeFile(path.join(uploadDir, name), buffer);
  return `/api/files/${name}`;
}

function catalogError(res) {
  return Response.json({ error: res.error }, { status: res.status });
}

/**
 * Normalize a raw product list (the JSON-body shape) to the stored document
 * shape. Entries without a name are dropped, same as before.
 */
function normalizeProducts(list) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p === 'object' && String(p.name || '').trim())
    .map((p) => ({
      name: String(p.name).trim(),
      price: Number(p.price) || 0,
      image: String(p.image || ''),
      description: String(p.description || ''),
      tags: Array.isArray(p.tags) ? p.tags : [],
    }));
}

/**
 * Parse the request body for the product endpoints. Both JSON (existing
 * behavior) and multipart/form-data (settings page with image file parts)
 * are accepted.
 *
 * Multipart form layout:
 *  - text fields: name, category, bio, whatsapp, instagram, currency, avatar
 *  - text field `products`: the catalog as a JSON array string
 *  - file parts `image` (single product) or `image-<index>` (catalog)
 *
 * @returns {{ fields: Record<string, string>, files: Array<object> } | { error: string, status: number }}
 */
async function parseShopBody(req) {
  if (isMultipart(req)) {
    try {
      const { fields, files } = await parseMultipartForm(req, { imageField: 'image' });
      return { fields, files };
    } catch (err) {
      if (err instanceof ImageUploadError) {
        return { error: err.message, status: err.message.includes('too large') ? 413 : 400 };
      }
      return { error: 'Could not parse the upload form', status: 400 };
    }
  }
  const fields = await req.json().catch(() => null);
  if (!fields || typeof fields !== 'object') {
    return { error: 'Invalid request body', status: 400 };
  }
  return { fields, files: [] };
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
    ownerName: shop.ownerName,
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
  const body = await parseShopBody(req);
  if (body.error) return catalogError(body);
  const { fields, files } = body;
  const name = String(fields.name || '').trim();
  if (!name) return Response.json({ error: 'Business name is required' }, { status: 400 });
  const category = String(fields.category || '').trim();
  if (!category) return Response.json({ error: 'Category is required' }, { status: 400 });

  const slug = await uniqueSlug(slugify(name));
  const shop = await Shop.create({
    name,
    slug,
    ownerName: String(fields.ownerName || '').trim(),
    category,
    bio: String(fields.bio || ''),
    whatsapp: String(fields.whatsapp || ''),
    instagram: String(fields.instagram || ''),
    currency: String(fields.currency || 'NGN'),
    avatar: String(fields.avatar || '🛍️'),
  });

  let products;
  if (typeof fields.products === 'string') {
    const res = await resolveCatalogProducts(fields.products, files);
    if (res.error) return catalogError(res);
    products = res.products;
  } else {
    products = normalizeProducts(fields.products);
  }
  if (products.length) {
    await Product.insertMany(products.map((p) => ({ shop: shop._id, ...p })));
  }

  return Response.json({ shop: serializeShop(shop) }, { status: 201 });
}

/** PATCH — update shop info and/or products (settings page). */
export async function PATCH(req) {
  await db();
  const shop = await Shop.findOne().sort({ createdAt: 1 });
  if (!shop) return Response.json({ error: 'No shop yet' }, { status: 404 });

  const body = await parseShopBody(req);
  if (body.error) return catalogError(body);
  const { fields, files } = body;

  const EDITABLE = ['name', 'ownerName', 'category', 'bio', 'whatsapp', 'instagram', 'currency', 'avatar'];
  for (const key of EDITABLE) {
    if (fields[key] !== undefined && fields[key] !== '') shop[key] = String(fields[key]);
  }
  if (fields.name !== undefined && !String(fields.name).trim()) {
    return Response.json({ error: 'Business name cannot be empty' }, { status: 400 });
  }
  if (fields.name !== undefined) {
    const nextSlug = slugify(fields.name);
    if (nextSlug !== shop.slug) {
      shop.slug = await uniqueSlug(nextSlug + (nextSlug === shop.slug ? '' : '-new'));
    }
  }
  await shop.save();

  let nextProducts = null;
  if (typeof fields.products === 'string') {
    const res = await resolveCatalogProducts(fields.products, files);
    if (res.error) return catalogError(res);
    nextProducts = res.products;
  } else if (Array.isArray(fields.products)) {
    nextProducts = normalizeProducts(fields.products);
  }
  if (nextProducts !== null) {
    // Replace the active catalog: keep it simple and predictable for the demo.
    await Product.deleteMany({ shop: shop._id });
    await Product.insertMany(nextProducts.map((p) => ({ shop: shop._id, ...p })));
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