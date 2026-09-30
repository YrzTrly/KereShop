'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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

const CURRENCIES = [
  { code: 'NGN', label: '₦ Nigerian Naira' },
  { code: 'KES', label: 'KSh Kenyan Shilling' },
  { code: 'GHS', label: 'GH₵ Ghanaian Cedi' },
  { code: 'USD', label: '$ US Dollar' },
  { code: 'GBP', label: '£ British Pound' },
];

const AVATARS = ['🛍️', '👗', '💍', '👟', '🍲', '💄', '📱', '✂️'];

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-[13px] text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    category: '',
    customCategory: '',
    whatsapp: '',
    instagram: '',
    bio: '',
    currency: 'NGN',
    avatar: '🛍️',
    products: [{ name: '', price: '' }],
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setProduct = (i, key, value) =>
    setForm((f) => {
      const products = f.products.map((p, idx) => (idx === i ? { ...p, [key]: value } : p));
      return { ...f, products };
    });
  const addProduct = () => setForm((f) => ({ ...f, products: [...f.products, { name: '', price: '' }] }));
  const removeProduct = (i) =>
    setForm((f) => ({ ...f, products: f.products.filter((_, idx) => idx !== i) }));

  const validStep1 =
    form.name.trim().length > 1 &&
    (form.category === 'Other' ? form.customCategory.trim().length > 0 : form.category !== '');

  async function submit() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          category: form.category === 'Other' ? form.customCategory.trim() : form.category,
          whatsapp: form.whatsapp.trim(),
          instagram: form.instagram.trim().replace(/^@/, '@'),
          products: form.products.map((p) => ({
            name: p.name.trim(),
            price: Number(p.price) || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create your shop');
      router.push('/');
      router.refresh();
    } catch (e) {
      setError(e.message || 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-10">
        {/* Brand */}
        <div className="mb-8 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand text-xl font-bold text-ink">
            K
          </span>
          <div>
            <p className="text-lg font-bold tracking-tight text-ink">KERE SHOP</p>
            <p className="text-[11px] font-medium uppercase tracking-wider text-faint">
              Your Small Mobile Shop
            </p>
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {step === 1 ? 'Set up your shop' : 'Add your first products'}
        </h1>
        <p className="mt-1 text-[13px] text-muted">
          {step === 1
            ? 'Tell us about your business — your public storefront is generated from this.'
            : 'You can add more products later from My Shop.'}
        </p>

        {/* Step indicator */}
        <div className="mt-5 flex gap-1.5">
          {[1, 2].map((s) => (
            <span
              key={s}
              className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-brand' : 'bg-line-soft'}`}
            />
          ))}
        </div>

        <div className="mt-6 space-y-4">
          {step === 1 ? (
            <>
              <Field label="Business name">
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Kere Fashion"
                />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Category">
                  <select
                    className={inputCls}
                    value={form.category}
                    onChange={(e) => set('category', e.target.value)}
                  >
                    <option value="">Select a category</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {form.category === 'Other' && (
                    <input
                      className={`${inputCls} mt-2`}
                      value={form.customCategory}
                      onChange={(e) => set('customCategory', e.target.value)}
                      placeholder="e.g. Phone Accessories"
                    />
                  )}
                </Field>
                <Field label="Currency">
                  <select
                    className={inputCls}
                    value={form.currency}
                    onChange={(e) => set('currency', e.target.value)}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="WhatsApp number / link" hint="e.g. 0803 123 4567 or a wa.me link — buyers use this to order">
                <input
                  className={inputCls}
                  value={form.whatsapp}
                  onChange={(e) => set('whatsapp', e.target.value)}
                  placeholder="0803 123 4567"
                />
              </Field>
              <Field label="Instagram handle" hint="e.g. @kerefashion">
                <input
                  className={inputCls}
                  value={form.instagram}
                  onChange={(e) => set('instagram', e.target.value)}
                  placeholder="@kerefashion"
                />
              </Field>
              <Field label="Short bio">
                <textarea
                  className={`${inputCls} resize-none`}
                  rows={3}
                  value={form.bio}
                  onChange={(e) => set('bio', e.target.value)}
                  placeholder="Handmade Ankara sets, delivered across Lagos. Quality you can feel, prices that fit."
                />
              </Field>
              <Field label="Avatar">
                <div className="flex flex-wrap gap-2">
                  {AVATARS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => set('avatar', a)}
                      className={`grid h-10 w-10 place-items-center rounded-lg border text-lg transition-colors ${
                        form.avatar === a ? 'border-brand bg-brand-soft' : 'border-line bg-panel hover:bg-line-soft'
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          ) : (
            <>
              {form.products.map((p, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label={`Product ${i + 1} name`}>
                      <input
                        className={inputCls}
                        value={p.name}
                        onChange={(e) => setProduct(i, 'name', e.target.value)}
                        placeholder="Ankara Set"
                      />
                    </Field>
                  </div>
                  <div className="w-32">
                    <Field label="Price">
                      <input
                        className={inputCls}
                        type="number"
                        min="0"
                        value={p.price}
                        onChange={(e) => setProduct(i, 'price', e.target.value)}
                        placeholder="18000"
                      />
                    </Field>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeProduct(i)}
                    disabled={form.products.length === 1}
                    aria-label="Remove product"
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-muted hover:bg-bad-bg hover:text-bad disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addProduct}
                className="text-[13px] font-semibold text-inkbrand hover:underline"
              >
                ＋ Add another product
              </button>
            </>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 text-[12px] font-medium text-bad">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep(1)}
            className={`text-[13px] font-semibold text-muted hover:text-ink ${
              step === 1 ? 'invisible' : ''
            }`}
          >
            ← Back
          </button>
          {step === 1 ? (
            <button
              type="button"
              onClick={() => validStep1 && setStep(2)}
              disabled={!validStep1}
              className="rounded-lg bg-ink px-5 py-2.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="rounded-lg bg-brand px-5 py-2.5 text-[13px] font-bold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Creating your shop…' : 'Launch my shop →'}
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-faint">
          Tip: try the demo data instead — any answer works, you can change everything in Settings.
        </p>
      </div>
    </div>
  );
}