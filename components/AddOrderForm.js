'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { money } from '@/lib/format.js';

const emptyItem = { product: '', qty: 1, price: '' };

export default function AddOrderForm({ products = [], currency = 'NGN' }) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ ...emptyItem }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = items.reduce(
    (s, it) => s + (parseInt(it.qty, 10) || 0) * (parseFloat(it.price) || 0),
    0
  );

  function setItem(i, field, value) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, { ...emptyItem }]);
  }

  function removeItem(i) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function fillFromProduct(productName) {
    const p = products.find((x) => x.name === productName);
    if (p) {
      setItems((prev) => {
        const i = prev.findIndex((it) => it.product === p.name);
        if (i >= 0) return prev.map((it, idx) => (idx === i ? { ...it, price: p.price } : it));
        return [...prev, { product: p.name, qty: 1, price: p.price }];
      });
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const clean = items
      .filter((it) => it.product.trim())
      .map((it) => ({
        name: it.product.trim(),
        qty: Math.max(1, parseInt(it.qty, 10) || 1),
        price: Math.max(0, parseFloat(it.price) || 0),
      }));
    if (!customerName.trim()) return setError('Customer name is required.');
    if (clean.length === 0) return setError('Add at least one item.');

    setSaving(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: { name: customerName.trim(), phone: phone.trim(), notes: notes.trim() },
          items: clean,
          location: location.trim(),
          channel: 'manual',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save order');
      router.push('/orders');
      router.refresh();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/orders"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-panel text-[13px] text-muted hover:text-ink"
          >
            ←
          </Link>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-ink">Add Order</h1>
          <p className="text-[13px] text-muted">Log a manual order and update customer metrics.</p>
        </div>
        <Link
          href="/voice-order"
          className="rounded-lg border border-line bg-panel px-4 py-2 text-[13px] font-semibold text-ink hover:bg-line-soft"
        >
          🎙 Use Voice Order instead
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold text-ink">Customer</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Name *</span>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Mama Tobi"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Phone (WhatsApp)</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0803 123 4567"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Items</h2>
            <button
              type="button"
              onClick={addItem}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-line-soft"
            >
              + Add item
            </button>
          </div>
          <div className="mt-3 space-y-2.5">
            {items.map((it, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={it.product}
                  onChange={(e) => {
                    const name = e.target.value;
                    if (name) fillFromProduct(name);
                    else setItem(i, 'product', '');
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                >
                  <option value="">— pick product —</option>
                  {products.map((p) => (
                    <option key={p._id} value={p.name}>
                      {p.name} · {money(p.price, currency)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={it.qty}
                  onChange={(e) => setItem(i, 'qty', e.target.value)}
                  className="w-16 rounded-lg border border-line bg-white px-2 py-2 text-sm text-ink outline-none focus:border-brand"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={it.price}
                  onChange={(e) => setItem(i, 'price', e.target.value)}
                  className="w-28 rounded-lg border border-line bg-white px-2 py-2 text-sm text-ink outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  aria-label="Remove item"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line text-muted hover:text-bad"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end border-t border-line pt-3">
            <span className="text-sm font-semibold text-ink">
              Total: {money(total, currency)}
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold text-ink">Delivery</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Location</span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Lekki, Lagos"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Notes</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Prefer red, deliver after 4pm"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
              />
            </label>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-bad/30 bg-bad-bg px-4 py-2.5 text-sm text-bad">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-inkbrand shadow-sm hover:bg-brand-hover disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save order'}
          </button>
          <Link href="/orders" className="text-[13px] font-medium text-muted hover:text-ink">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}