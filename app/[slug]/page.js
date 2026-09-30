import { notFound } from 'next/navigation';
import Image from 'next/image';
import { Shop, Product } from '@/lib/models.js';
import { db } from '@/lib/mongo.js';
import { money, waLink, igLink } from '@/lib/format.js';
import Avatar from '@/components/Avatar.js';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  await db();
  const shop = await Shop.findOne({ slug: String(slug).toLowerCase() });
  if (!shop) return { title: 'Shop not found — Kere Shop' };
  return { title: `${shop.name} — ${shop.category}`, description: shop.bio || `Shop with ${shop.name} on WhatsApp.` };
}

export default async function StorefrontPage({ params }) {
  const { slug } = await params;
  await db();
  const shop = await Shop.findOne({ slug: String(slug).toLowerCase() });
  if (!shop) notFound();

  const products = await Product.find({ shop: shop._id, active: true }).sort({ createdAt: 1 });

  const orderText = (p) =>
    `Hi ${shop.name}! 👋 I'd like to order from your shop:\n\n• ${p.name} — ${money(p.price, shop.currency)} x 1\n\nIs it available? How can I pay?`;

  return (
    <div className="min-h-screen bg-bg">
      {/* Hero */}
      <section className="relative overflow-hidden bg-ink">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              'radial-gradient(600px 300px at 85% -20%, #F5B301 0%, transparent 60%), radial-gradient(500px 260px at -10% 120%, #7c2d92 0%, transparent 60%)',
          }}
        />
        <div className="relative mx-auto w-full max-w-5xl px-4 pb-10 pt-10 sm:px-6 sm:pb-14 sm:pt-14">
          <div className="flex items-center gap-4">
            <Avatar value={shop.avatar} className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand text-3xl shadow-lg sm:h-20 sm:w-20 sm:text-4xl" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{shop.name}</h1>
              <span className="mt-1.5 inline-block rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand">
                {shop.category}
              </span>
            </div>
          </div>
          {shop.bio && <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/70">{shop.bio}</p>}
          <div className="mt-5 flex flex-wrap gap-2.5">
            {shop.whatsapp && (
              <a
                href={waLink(shop.whatsapp, `Hi ${shop.name}! I'm browsing your shop and have a question.`)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-[13px] font-bold text-[#073B1C] transition-transform hover:scale-[1.02]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.96L2 22l5.18-1.5A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.07.89.9-3-.2-.31a8.2 8.2 0 1 1 6.85 3.75Zm4.5-6.13c-.25-.12-1.46-.72-1.68-.8-.23-.08-.4-.12-.56.12-.17.25-.64.8-.79.97-.14.16-.29.18-.53.06a6.7 6.7 0 0 1-3.4-2.98c-.25-.43.25-.4.72-1.34.08-.16.04-.3-.02-.42-.06-.12-.56-1.34-.76-1.83-.2-.48-.4-.42-.56-.42h-.48c-.16 0-.42.06-.64.3-.22.25-.84.82-.84 2s.86 2.32.98 2.48a10.6 10.6 0 0 0 4.03 3.56c.56.24 1 .4 1.35.52.57.18 1.08.16 1.48.1.45-.07 1.46-.6 1.67-1.17.2-.57.2-1.06.14-1.17-.06-.1-.22-.16-.47-.28Z" />
                </svg>
                Chat on WhatsApp
              </a>
            )}
            {shop.instagram && (
              <a
                href={igLink(shop.instagram)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-xl bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] px-4 py-2.5 text-[13px] font-bold text-white transition-transform hover:scale-[1.02]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                  <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
                </svg>
                {shop.instagram.replace(/^@/, '@')} on Instagram
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Products */}
      <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-5 flex items-end justify-between">
          <h2 className="text-lg font-bold tracking-tight text-ink">Shop the collection</h2>
          <span className="text-[12px] font-medium text-faint">{products.length} items</span>
        </div>

        {products.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-panel p-10 text-center text-[13px] text-muted">
            New pieces are on the way — chat with us on WhatsApp to ask about availability.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <div key={p._id} className="group overflow-hidden rounded-2xl border border-line bg-panel transition-shadow hover:shadow-md">
                <div className="relative aspect-square overflow-hidden bg-line-soft">
                  {p.image ? (
                    <Image src={p.image} alt={p.name} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" className="object-cover transition-transform duration-300 group-hover:scale-105" />
                  ) : (
                    <div className="grid h-full place-items-center text-4xl">🛍️</div>
                  )}
                </div>
                <div className="p-3">
                  <h3 className="truncate text-[13px] font-semibold text-ink">{p.name}</h3>
                  <p className="mt-0.5 text-[13px] font-bold text-inkbrand">{money(p.price, shop.currency)}</p>
                  <a
                    href={waLink(shop.whatsapp, orderText(p))}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-[12px] font-bold text-ink transition-colors hover:bg-brand-hover"
                  >
                    Buy on WhatsApp
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-line py-6 text-center text-[11px] text-faint">
        {shop.name} · Powered by <span className="font-semibold text-muted">Kere Shop</span>
      </footer>
    </div>
  );
}