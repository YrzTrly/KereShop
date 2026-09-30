'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui.js';
import { money, waLink } from '@/lib/format.js';

function fmtTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

export default function VoiceOrderPage() {
  const router = useRouter();
  const [phase, setPhase] = useState('idle'); // idle | recording | processing | preview | done | error
  const [micError, setMicError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState(null);
  const [engine, setEngine] = useState('');
  const [currency, setCurrency] = useState('NGN');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createdOrder, setCreatedOrder] = useState(null);
  const [edit, setEdit] = useState(null); // editable draft of the preview, set while the user fills in missing details

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioUrlRef = useRef('');

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  function startRecording() {
    setMicError('');
    setError('');
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setMicError('Recording is not supported in this browser. Use the text box below instead.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;
          await sendAudio(blob);
        };
        recorder.start();
        setSeconds(0);
        setPhase('recording');
        timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      })
      .catch(() => {
        setMicError('Microphone unavailable — allow mic access or use the text box below.');
        setPhase('error');
      });
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }

  async function sendAudio(blob) {
    setPhase('processing');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'voice-order.webm');
      const res = await fetch('/api/voice-order', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not process the recording');
      setPreview(data.order);
      setEngine(data.engine || '');
      setCurrency(data.currency || 'NGN');
      setPhase('preview');
    } catch (e) {
      setError(e.message || 'Could not process the recording');
      setPhase('error');
    }
  }

  async function submitText() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setError('');
    setPhase('processing');
    try {
      const res = await fetch('/api/voice-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not parse the text');
      setPreview(data.order);
      setEngine(data.engine || 'text');
      setCurrency(data.currency || 'NGN');
      setPhase('preview');
    } catch (e) {
      setError(e.message || 'Could not parse the text');
      setPhase('error');
    } finally {
      setBusy(false);
    }
  }

  async function createOrder() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: preview.name || 'Walk-in customer',
        phone: preview.phone || '',
        items: preview.items.map((it) => ({
          name: it.catalogMatch || it.product,
          qty: it.quantity,
          price: it.unitPrice || 0,
        })),
        location: preview.location || '',
        notes: preview.notes || '',
        channel: 'voice',
        total,
      };
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create order');
      setCreatedOrder(data.orderId);
      setPhase('done');
      router.refresh();
    } catch (e) {
      setError(e.message || 'Failed to create order');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPreview(null);
    setEngine('');
    setError('');
    setCreatedOrder(null);
    setText('');
    setEdit(null);
    setPhase('idle');
  }

  function startEdit() {
    if (!preview) return;
    setEdit({
      name: preview.name || '',
      phone: preview.phone || '',
      location: preview.location || '',
      notes: preview.notes || '',
      items: (preview.items || []).map((it) => ({
        product: it.catalogMatch || it.product || '',
        quantity: Number(it.quantity) || 1,
        unitPrice: Number(it.unitPrice) || 0,
      })),
    });
    setError('');
  }

  function cancelEdit() {
    setEdit(null);
  }

  function saveEdit() {
    if (!edit || !preview) return;
    const items = edit.items.filter((it) => String(it.product).trim());
    if (!items.length) {
      setError('Keep at least one item with a product name.');
      return;
    }
    setPreview({
      ...preview,
      name: edit.name.trim(),
      phone: edit.phone.trim(),
      location: edit.location.trim(),
      notes: edit.notes.trim(),
      items,
    });
    setEdit(null);
    setError('');
  }

  function updateEditField(field, value) {
    setEdit((d) => (d ? { ...d, [field]: value } : d));
  }

  function updateEditItem(index, key, value) {
    setEdit((d) =>
      d ? { ...d, items: d.items.map((it, i) => (i === index ? { ...it, [key]: value } : it)) } : d
    );
  }

  function addEditItem() {
    setEdit((d) =>
      d ? { ...d, items: [...d.items, { product: '', quantity: 1, unitPrice: 0 }] } : d
    );
  }

  function removeEditItem(index) {
    setEdit((d) => (d ? { ...d, items: d.items.filter((_, i) => i !== index) } : d));
  }

  const activeDraft = edit || preview;
  const total = activeDraft
    ? (activeDraft.items || []).reduce(
        (s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0),
        0
      )
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Voice Order"
        subtitle="Record or paste a customer conversation — Kere Shop turns it into a clean order."
        action={
          phase === 'preview' || phase === 'done' ? (
            <button
              onClick={reset}
              className="rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-muted hover:bg-line-soft"
            >
              New capture
            </button>
          ) : null
        }
      />

      <div className="mx-auto max-w-2xl space-y-5">
        {/* Recorder card */}
        <div className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
          {phase === 'idle' || phase === 'recording' || phase === 'error' ? (
            <div className="flex flex-col items-center gap-5 py-4 text-center">
              <button
                onClick={phase === 'recording' ? stopRecording : startRecording}
                aria-label={phase === 'recording' ? 'Stop recording' : 'Record order'}
                className={`relative grid h-20 w-20 place-items-center rounded-full text-3xl transition ${
                  phase === 'recording' ? 'bg-bad text-white' : 'bg-ink text-white hover:opacity-90'
                }`}
              >
                {phase === 'recording' && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-bad/40" />
                )}
                {phase === 'recording' ? '⏹' : '🎙'}
              </button>
              <div>
                <p className="text-sm font-semibold text-ink">
                  {phase === 'recording'
                    ? `Listening… ${fmtTime(seconds)}`
                    : 'Tap to record the customer\u2019s order'}
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  {phase === 'recording'
                    ? 'Tap again when they finish.'
                    : 'Say things like: "Two red Ankara sets for Mama Tobi, fifteen thousand each, deliver to Ikeja."'}
                </p>
                <p className="mt-3 rounded-lg bg-line-soft/60 px-3 py-2 text-left text-[12px] text-muted">
                  <span className="font-semibold text-ink">Tip:</span> be descriptive about your order as
                  much as possible — include the customer&apos;s name and phone number.
                </p>
                {micError && <p className="mt-3 text-[12px] font-medium text-bad">{micError}</p>}
              </div>
            </div>
          ) : null}

          {phase === 'processing' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-ink" />
              <p className="text-sm font-semibold text-ink">Transcribing & extracting the order…</p>
              <p className="text-[12px] text-muted">Name, phone, items, quantities, delivery location.</p>
            </div>
          )}

          {phase === 'done' && createdOrder && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-ok-bg text-2xl">✅</span>
              <p className="text-base font-bold text-ink">Order created</p>
              <p className="text-[12px] text-muted">
                It is now on the Orders board and the customer record is up to date.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => router.push('/orders')}
                  className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
                >
                  View orders
                </button>
                <button
                  onClick={reset}
                  className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-muted hover:bg-line-soft"
                >
                  Capture another
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {(phase === 'error' && error) || (phase === 'preview' && error) ? (
          <div className="rounded-xl border border-bad/30 bg-bad-bg px-4 py-3 text-[13px] font-medium text-bad">
            {error}
          </div>
        ) : null}

        {/* Parsed preview */}
        {phase === 'preview' && preview ? (
          <div className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-ink">{edit ? 'Edit details' : 'Order captured'}</h2>
              <span className="rounded-full bg-line-soft px-2.5 py-1 text-[11px] font-semibold text-muted">
                {engine === 'demo' || engine === 'demo-fallback'
                  ? 'Demo transcript'
                  : engine.startsWith('gemini')
                  ? 'Gemini'
                  : 'Text parse'}
              </span>
            </div>

            {preview.parseError && (
              <p className="mt-3 rounded-lg bg-bad-bg px-3 py-2 text-[12px] font-medium text-bad">
                {preview.parseError}
              </p>
            )}

            {!edit ? (
              <>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-line-soft/60 px-3 py-2.5">
                <dt className="text-[11px] font-medium text-muted">Customer</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink">{preview.name || 'Not provided'}</dd>
              </div>
              <div className="rounded-lg bg-line-soft/60 px-3 py-2.5">
                <dt className="text-[11px] font-medium text-muted">Phone</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink">
                  {preview.phone ? (
                    <a
                      href={waLink(preview.phone, `Hi ${preview.name || ''}! Confirming your order…`)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-line underline-offset-2 hover:text-inkbrand"
                    >
                      {preview.phone}
                    </a>
                  ) : (
                    'Not provided'
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-4">
              <p className="text-[11px] font-medium text-muted">Items</p>
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                {preview.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{it.catalogMatch || it.product}</p>
                      {it.catalogMatch && it.catalogMatch !== it.product && (
                        <p className="text-[11px] text-faint">matched from: “{it.product}”</p>
                      )}
                      {it.priceMismatch && (
                        <p className="text-[11px] font-medium text-bad">
                          Customer stated a different price than the catalog
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-ink">
                        × {it.quantity} — {money((it.unitPrice || 0) * it.quantity, currency)}
                      </p>
                      <p className="text-[11px] text-faint">
                        {it.unitPrice ? `${money(it.unitPrice, currency)} each` : 'price from catalog'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-line-soft/60 px-3 py-2.5">
                <dt className="text-[11px] font-medium text-muted">Delivery location</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink">{preview.location || 'Not provided'}</dd>
              </div>
              <div className="rounded-lg bg-line-soft/60 px-3 py-2.5">
                <dt className="text-[11px] font-medium text-muted">Notes</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink">{preview.notes || '—'}</dd>
              </div>
            </dl>
              </>
            ) : (
              <div className="mt-4 space-y-4">
                <p className="rounded-lg bg-line-soft/60 px-3 py-2 text-[12px] text-muted">
                  <span className="font-semibold text-ink">Tip:</span> be as descriptive as possible —
                  include the customer&apos;s name and phone number, plus delivery details and any
                  special notes.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted">Customer name</span>
                    <input
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      placeholder="e.g. Mama Tobi"
                      className="mt-1 w-full rounded-lg bg-line-soft/60 px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium text-muted">Phone</span>
                    <input
                      value={edit.phone}
                      onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                      placeholder="e.g. 0803 123 4567"
                      className="mt-1 w-full rounded-lg bg-line-soft/60 px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[11px] font-medium text-muted">Delivery location</span>
                  <input
                    value={edit.location}
                    onChange={(e) => setEdit({ ...edit, location: e.target.value })}
                    placeholder="e.g. Ikeja, Lagos"
                    className="mt-1 w-full rounded-lg bg-line-soft/60 px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-muted">Notes</span>
                  <textarea
                    value={edit.notes}
                    onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                    rows={2}
                    placeholder="Colour, size, special instructions…"
                    className="mt-1 w-full resize-y rounded-lg bg-line-soft/60 px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                </label>
                <div>
                  <p className="text-[11px] font-medium text-muted">Items</p>
                  <div className="mt-2 space-y-2">
                    {edit.items.map((it, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[1fr_76px_100px_32px] items-center gap-2 rounded-lg border border-line px-3 py-2"
                      >
                        <input
                          value={it.product}
                          onChange={(e) => updateEditItem(i, { product: e.target.value })}
                          placeholder="Product"
                          className="w-full min-w-0 rounded bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
                        />
                        <input
                          type="number"
                          min="1"
                          value={it.quantity}
                          onChange={(e) => updateEditItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                          placeholder="Qty"
                          className="w-full rounded bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
                        />
                        <input
                          type="number"
                          min="0"
                          value={it.unitPrice}
                          onChange={(e) => updateEditItem(i, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                          placeholder="Price"
                          className="w-full rounded bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
                        />
                        <button
                          onClick={() => removeEditItem(i)}
                          aria-label={`Remove item ${i + 1}`}
                          className="text-sm text-muted hover:text-bad"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addEditItem}
                    className="mt-2 rounded-lg border border-dashed border-line px-3 py-1.5 text-[12px] font-medium text-muted hover:bg-line-soft"
                  >
                    + Add item
                  </button>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-sm text-muted">
                Total <span className="text-lg font-bold text-ink">{money(total, currency)}</span>
              </p>
              <div className="flex gap-2">
                {edit ? (
                  <>
                    <button
                      onClick={() => setEdit(null)}
                      disabled={busy}
                      className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-muted hover:bg-line-soft"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={busy}
                      className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Save changes
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={startEdit}
                      disabled={busy}
                      className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-muted hover:bg-line-soft"
                    >
                      Edit details
                    </button>
                    <button
                      onClick={reset}
                      className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-muted hover:bg-line-soft"
                    >
                      Discard
                    </button>
                    <button
                      onClick={createOrder}
                      disabled={busy}
                      className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {busy ? 'Creating…' : 'Create Order'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Text fallback */}
        {phase !== 'done' ? (
          <div className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
            <h2 className="text-sm font-bold text-ink">Or paste the conversation</h2>
            <p className="mt-1 text-[12px] text-muted">
              No mic? Paste a WhatsApp / DM transcript and we will extract the order from it.
            </p>
            <p className="mt-2 text-[11px] text-faint">
              Be as descriptive as possible — include the customer&apos;s name and phone number.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={'e.g. "Hello, I want 2 Ankara sets and 1 gele, it\u2019s for Chiamaka. My number is 0803 123 4567, deliver to Yaba."'}
              className="mt-3 w-full resize-y rounded-lg bg-line-soft/60 p-3 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={submitText}
                disabled={busy || !text.trim()}
                className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Parsing…' : 'Parse order'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}