export const NAV = [
  { href: '/', label: 'Overview', icon: '📊' },
  { href: '/customers', label: 'Customers', icon: '👥' },
  { href: '/orders', label: 'Orders', icon: '📦' },
  { href: '/my-shop', label: 'My Shop', icon: '🏪' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export function isActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}