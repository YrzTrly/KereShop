import { redirect } from 'next/navigation';
import { getActiveShop } from '@/lib/shop-context.js';
import Sidebar from '@/components/Sidebar.js';
import FirstRunSplash from '@/components/FirstRunSplash.js';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }) {
  const shop = await getActiveShop();
  if (!shop) redirect('/onboarding');
  return (
    <div className="min-h-screen bg-bg">
      <Sidebar shop={shop ? { name: shop.name, slug: shop.slug, avatar: shop.avatar } : null} />
      <FirstRunSplash />
      <main className="min-h-screen lg:pl-64">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}