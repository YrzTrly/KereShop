import { Product } from '@/lib/models.js';
import { requireShop } from '@/lib/shop-context.js';
import AddOrderForm from '@/components/AddOrderForm.js';

export const dynamic = 'force-dynamic';

/**
 * Server component: loads the shop + catalog, then renders the client form.
 * (A client page can't receive custom props — this used to crash with
 * "Cannot read properties of undefined (reading 'map')" on /orders/new.)
 */
export default async function AddOrderPage() {
  const shop = await requireShop();
  const products = await Product.find({ shop: shop._id, active: true })
    .sort({ name: 1 })
    .lean();

  return (
    <AddOrderForm
      products={products.map((p) => ({ _id: p._id.toString(), name: p.name, price: p.price }))}
      currency={shop.currency || 'NGN'}
    />
  );
}