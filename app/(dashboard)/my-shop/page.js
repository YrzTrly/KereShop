import Link from 'next/link';
import { requireShop } from '@/lib/shop-context.js';
import { Product } from '@/lib/models.js';
import { money } from '@/lib/format.js';
import { PageHeader, ChannelBadge } from '@/components/ui.js';

export const dynamic = 'force-dynamic';

export default async function MyShopPage() {
  const shop = await requireShop();
  const products = await Product.find({ shop: shop._id, active: true }).sort({ createdAt: 1 });

  return (
    <div>
      <PageHeader
        title="My Shop"
        subtitle="This is what your customers see when they open your storefront link."
        action={
          <Link
            href={`/${shop.slug}`}
            target="_blank"
            className="rounded-lg bg-brand px-4 py-2.5 text-[13px] font-bold text-ink transition-opacity hover:opacity-90"
          >
            🌐 Open live storefront
          </Link>
        }
      />

      {/* Store link */}
      <div className="mt-5 rounded-xl border border-brand/30 bg-brand-soft p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-inkbrand">Your public link</p>
        <p className="mt-1 truncate font-mono text-[13px] font-semibold text-ink">
          {typeof window === 'undefined' ? '/link' : window.location.origin}/
          {shop.slug}
        </p>
        <p className="mt-1 text-[12px] text-muted">
          Share this link on Instagram bio, status, and WhatsApp broadcasts. Buyers land here and tap through to
          WhatsApp checkout.
        </p>
      </div>

      {/* Storefront preview */}
      <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <p className="text-[12px] font-semibold text-muted">Live preview</p>
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-bad/50" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-ok/50" />
          </div>
        </div>
        <iframe
          src={`/${shop.slug}`}
          title={`${shop.name} storefront preview`}
          className="h-[640px] w-full bg-white"
        />
      </div>

      {/* Catalog summary */}
      <div className="mt-5 rounded-xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-bold text-ink">Catalog</p>
          <Link href="/settings" className="text-[12px] font-semibold text-brand hover:underline">
            Edit products →
          </Link>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {products.map((p) => (
            <div key={p._id} className="flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-line-soft text-[16px]">
                  {p.image ? '🛍️' : shop.avatar}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{p.name}</p>
                  <p className="text-[11px] text-faint">
                    {money(p.price, shop.currency)}
                    {p.tags?.length ? ` · ${p.tags.join(', ')}` : ''}
                  </p>
                </div>
              </div>
              <ChannelBadge channel="storefront" />
            </div>
          ))}
          {products.length === 0 && (
            <p className="col-span-2 py-4 text-center text-[12px] text-muted">
              No products yet — add your first product in <Link href="/settings" className="font-semibold text-brand hover:underline">Settings</Link>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}