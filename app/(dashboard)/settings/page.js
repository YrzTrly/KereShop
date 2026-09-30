'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui.js';
import ImageUpload from '@/components/ImageUpload.js';
import { money } from '@/lib/format.js';

const TUTORIAL_KEY = 'kereshop_tutorial_seen_v1';

const CATEGORIES = [
  'Fashion & Ankara',
  'Beads & Jewelry',
  'Shoes & Bags',
  'Food & Groceries',
  'Beauty & Hair',
  'Electronics',
  'Services',
  'Other',
];

const CURRENCIES = ['NGN', 'KES', 'GHS', 'USD', 'GBP'];

const inputCls =
  'w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-[13px] text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft';

const emptyProduct = { name: '', price: '', image: '', description: '' };

const rowKey = (p) => p.id || `new-${p.uid}`;

export default function SettingsPage() {
  const [shop, setShop] = useState(null);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ name: '', category: '', bio: '', whatsapp: '', instagram: '', currency: 'NGN', avatar: '' });
  const [catalog, setCatalog] = useState([]);
  const [savingShop, setSavingShop] = useState(false);
  const [savingProducts, setSavingProducts] = useState(false);
  const [msg, setMsg] = useState({ kind: 'idle', text: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/shop');
      if (!res.ok) {
        setError('No shop found yet. Complete onboarding first.');
        return;
      }
      const data = await res.json();
      setShop(data.shop);
      setProducts(data.products);
      setForm({
        name: data.shop.name,
        category: data.shop.category,
        bio: data.shop.bio,
        whatsapp: data.shop.whatsapp,
        instagram: data.shop.instagram,
        currency: data.shop.currency || 'NGN',
        avatar: data.shop.avatar || '',
      });
      setCatalog(data.products.map((p) => ({ ...p })));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const setProduct = (i, key) => (e) =>
    setCatalog((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: e.target.value } : r)));

  const addRow = () =>
    setCatalog((rows) => [{ ...emptyProduct, uid: Math.random().toString(36).slice(2), isNew: true, editing: true }, ...rows]);

  const removeRow = (i) => setCatalog((rows) => rows.filter((_, j) => j !== i));

  const startEdit = (i) =>
    setCatalog((rows) =>
      rows.map((r, j) =>
        j === i
          ? { ...r, editing: true, snapshot: { name: r.name, price: r.price, image: r.image, description: r.description } }
          : r
      )
    );

  const cancelEdit = (i) =>
    setCatalog((rows) =>
      rows.map((r, j) => {
        if (j !== i || r.isNew) return r;
        const { snapshot, editing, ...rest } = r;
        return { ...rest, ...snapshot, editing: false };
      })
    );

  const setPendingImage = (i, file) =>
    setCatalog((rows) => rows.map((r, j) => (j === i ? { ...r, pendingImage: file || null } : r)));

  const saveShop = async (e) => {
    e.preventDefault();
    setSavingShop(true);
    setMsg({ kind: 'idle', text: '' });
    setError('');
    try {
      const res = await fetch('/api/shop', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save shop details');
      setShop(data.shop);
      setMsg({ kind: 'ok', text: 'Shop details saved.' });
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingShop(false);
    }
  };

  const saveProducts = async (e) => {
    e.preventDefault();
    setSavingProducts(true);
    setMsg({ kind: 'idle', text: '' });
    setError('');
    try {
      const hasPendingImage = catalog.some((p) => p.pendingImage);
      let res;
      if (hasPendingImage) {
        const form = new FormData();
        form.append(
          'products',
          JSON.stringify(
            catalog.map((p) => ({
              name: p.name,
              price: p.price,
              image: p.pendingImage ? '' : p.image,
              description: p.description,
            }))
          )
        );
        catalog.forEach((p, i) => {
          if (p.pendingImage) form.append(`image-${i}`, p.pendingImage);
        });
        res = await fetch('/api/shop', { method: 'PATCH', body: form });
      } else {
        res = await fetch('/api/shop', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            products: catalog.map((p) => ({
              name: p.name,
              price: p.price,
              image: p.image,
              description: p.description,
            })),
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save products');
      setProducts(data.products);
      setCatalog((rows) => rows.map((r) => ({ ...r, pendingImage: null })));
      setMsg({ kind: 'ok', text: 'Product catalog saved.' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingProducts(false);
    }
  };

  const replayTutorial = () => {
    localStorage.removeItem(TUTORIAL_KEY);
    window.location.reload();
  };

  if (!shop) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="Shop details, links and catalog" />
        {error ? (
          <p className="mt-4 rounded-lg border border-bad/30 bg-bad-bg p-3 text-[13px] text-bad">{error}</p>
        ) : (
          <p className="mt-4 text-[13px] text-muted">Loading settings…</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Shop details, links and catalog"
        action={
          <button
            onClick={replayTutorial}
            className="rounded-lg border border-line bg-panel px-4 py-2 text-[13px] font-semibold text-ink hover:bg-line-soft"
          >
            ↻ Replay tutorial
          </button>
        }
      />

      {msg.kind === 'ok' ? (
        <p className="mt-4 rounded-lg border border-line bg-brand-soft p-3 text-[13px] text-inkbrand">{msg.text}</p>
      ) : null}

      {/* Shop details */}
      <form onSubmit={saveShop} className="mt-5 rounded-xl border border-line bg-panel p-4">
        <p className="text-[13px] font-bold text-ink">Shop details</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr]">
          <div className="space-y-2">
            <ImageUpload
              value={form.avatar}
              onChange={(url) => setForm((f) => ({ ...f, avatar: url }))}
            />
            <input
              className={inputCls}
              placeholder="Or paste an image URL (optional)"
              value={form.avatar}
              onChange={setField('avatar')}
            />
          </div>
          <div>
            <span className="mb-1.5 block text-[12px] font-semibold text-ink">Shop image / logo</span>
            <p className="text-[12px] leading-relaxed text-faint">
              Shown in the sidebar, on your public storefront, and in WhatsApp
              order messages. Upload a square image or paste a direct image URL.
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-ink">Shop name</span>
            <input className={inputCls} value={form.name} onChange={setField('name')} required />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-ink">Category</span>
            <select
              className={inputCls}
              value={CATEGORIES.includes(form.category) ? form.category : 'Other'}
              onChange={setField('category')}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {(!CATEGORIES.includes(form.category) || form.category === 'Other') && (
              <input
                className={`${inputCls} mt-2`}
                value={form.category === 'Other' ? '' : form.category}
                onChange={setField('category')}
                placeholder="Type your own category"
              />
            )}
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-[12px] font-semibold text-ink">Bio</span>
            <textarea
              className={`${inputCls} min-h-[72px] resize-y`}
              value={form.bio}
              onChange={setField('bio')}
              placeholder="Tell customers what you sell and how to reach you"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-ink">WhatsApp</span>
            <input
              className={inputCls}
              value={form.whatsapp}
              onChange={setField('whatsapp')}
              placeholder="+234 800 000 0000"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-ink">Instagram</span>
            <input
              className={inputCls}
              value={form.instagram}
              onChange={setField('instagram')}
              placeholder="@yourhandle"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-semibold text-ink">Currency</span>
            <select className={inputCls} value={form.currency} onChange={setField('currency')}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="submit"
            disabled={savingShop}
            className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {savingShop ? 'Saving…' : 'Save shop details'}
          </button>
        </div>
      </form>

      {/* Product catalog */}
      <form onSubmit={saveProducts} className="mt-5 rounded-xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-bold text-ink">Product catalog</p>
            <p className="mt-0.5 text-[11px] text-faint">
              These products appear on your public storefront.
            </p>
          </div>
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-line-soft"
          >
            + Add product
          </button>
        </div>

        {catalog.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line bg-line-soft p-4 text-center text-[12px] text-muted">
            No products yet. Add your first product above.
          </p>
        ) : (
          <div className="mt-3 grid gap-3">
            {catalog.map((p, i) => (
              <div key={rowKey(p)} className="rounded-lg border border-line bg-panel p-3">
                {p.isNew || p.editing ? (
                  <div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                      <input
                        className={inputCls}
                        placeholder="Product name"
                        value={p.name}
                        onChange={setProduct(i, 'name')}
                        required
                      />
                      <input
                        className={inputCls}
                        placeholder="Price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={p.price}
                        onChange={setProduct(i, 'price')}
                        required
                      />
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="space-y-2">
                        <ImageUpload
                          value={p.image}
                          onChange={(url) =>
                            setCatalog((rows) => rows.map((r, j) => (j === i ? { ...r, image: url } : r)))
                          }
                          onFile={(file) => setPendingImage(i, file)}
                        />
                        <input
                          className={inputCls}
                          placeholder="Or paste an image URL (optional)"
                          value={p.image}
                          onChange={setProduct(i, 'image')}
                        />
                      </div>
                      <input
                        className={inputCls}
                        placeholder="Short description (optional)"
                        value={p.description}
                        onChange={setProduct(i, 'description')}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      {!p.isNew ? (
                        <button
                          type="button"
                          onClick={() => cancelEdit(i)}
                          className="text-[12px] font-semibold text-muted hover:underline"
                        >
                          Cancel
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-[12px] font-semibold text-bad hover:underline"
                      >
                        {p.isNew ? 'Remove' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-line-soft">
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt={p.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-xl">🛍️</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-ink">{p.name}</p>
                      <p className="text-[12px] font-semibold text-inkbrand">
                        {money(p.price, shop.currency)}
                      </p>
                      {p.description ? (
                        <p className="mt-0.5 truncate text-[11px] text-muted">{p.description}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={() => startEdit(i)}
                        className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-line-soft"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-[12px] font-semibold text-bad hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="submit"
            disabled={savingProducts}
            className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {savingProducts ? 'Saving…' : 'Save catalog'}
          </button>
        </div>
      </form>

      {error ? (
        <p className="mt-4 rounded-lg border border-bad/30 bg-bad-bg p-3 text-[13px] text-bad">{error}</p>
      ) : null}

      <p className="mt-4 text-[11px] text-faint">
        New here? Your onboarding tutorial plays automatically on first visit — or{' '}
        <Link href="/onboarding" className="font-semibold text-brand hover:underline">
          start onboarding
        </Link>{' '}
        any time.
      </p>
    </div>
  );
}