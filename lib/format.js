const SYMBOLS = { NGN: '₦', KES: 'KSh ', USD: '$', GHS: 'GH₵', GBP: '£', EUR: '€' };

export function money(n, code = 'NGN') {
  const sym = SYMBOLS[code] ?? (code ? code + ' ' : '');
  const num = Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
  return sym + num;
}

export function shortDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeAgo(d) {
  if (!d) return 'never';
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 31) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function daysSince(d) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

export function normalizePhone(s) {
  if (!s) return '';
  let p = String(s).replace(/[^0-9]/g, '');
  if (p.startsWith('0')) p = '234' + p.slice(1);
  return p;
}

export function waLink(number, text) {
  const base = `https://wa.me/${normalizePhone(number)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export function igLink(handle) {
  if (!handle) return '';
  const h = String(handle).replace(/^@/, '');
  return `https://instagram.com/${h}`;
}

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'shop';
}