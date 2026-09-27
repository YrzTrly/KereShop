'use client';

import { useEffect, useState } from 'react';

const TUTORIAL_KEY = 'kereshop_tutorial_seen_v1';

const STEPS = [
  {
    icon: '🏪',
    title: 'This is your live storefront',
    body: 'Every shop gets a public link like /kere. Open My Shop to preview it, then share it on Instagram, WhatsApp or Twitter — customers browse your catalog and place orders straight from it.',
  },
  {
    icon: '🎙',
    title: 'Take orders by voice',
    body: 'When a customer sends a WhatsApp voice note, open Voice Order, paste the conversation and Kere Shop turns it into a clean, structured order you can accept or reject.',
  },
  {
    icon: '📦',
    title: 'Orders & customers in one place',
    body: 'Every order lands in Orders with its status, and every buyer shows up in Customers with their full purchase history — no more juggling phone notes.',
  },
  {
    icon: '⚙️',
    title: 'Make it yours in Settings',
    body: 'Set your shop name, WhatsApp number, Instagram and product catalog in Settings. Everything saves instantly and appears on your public storefront.',
  },
];

export default function FirstRunSplash() {
  const [phase, setPhase] = useState('hidden'); // hidden | loading | tour
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(TUTORIAL_KEY)) return;
    } catch {
      return;
    }
    setPhase('loading');
    const timer = setTimeout(() => setPhase('tour'), 1400);
    return () => clearTimeout(timer);
  }, []);

  const finish = () => {
    try {
      localStorage.setItem(TUTORIAL_KEY, String(Date.now()));
    } catch {
      // localStorage unavailable — tour simply won't persist
    }
    setPhase('hidden');
  };

  if (phase === 'hidden') return null;

  if (phase === 'loading') {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-bg">
        <style>{`
          @keyframes kere-loadbar { from { width: 8%; } to { width: 100%; } }
        `}</style>
        <div className="flex w-[300px] flex-col items-center">
          <span className="grid h-14 w-14 animate-pulse place-items-center rounded-2xl bg-brand text-2xl font-bold text-ink">
            K
          </span>
          <p className="mt-4 text-lg font-bold tracking-tight text-ink">KERE SHOP</p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-faint">
            Your Small Mobile Shop
          </p>
          <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-brand"
              style={{ animation: 'kere-loadbar 1.3s ease-out forwards' }}
            />
          </div>
          <p className="mt-3 text-[12px] text-muted">Setting up your shop…</p>
        </div>
      </div>
    );
  }

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-ink/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-soft text-2xl">
          {s.icon}
        </span>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">
          Quick tour · {step + 1} of {STEPS.length}
        </p>
        <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">{s.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{s.body}</p>

        <div className="mt-5 flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-5 bg-brand' : 'w-1.5 bg-line'
              }`}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={finish}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted hover:text-ink"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {step > 0 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="rounded-lg border border-line bg-panel px-4 py-2 text-[13px] font-semibold text-ink hover:bg-line-soft"
              >
                Back
              </button>
            ) : null}
            <button
              onClick={() => (last ? finish() : setStep(step + 1))}
              className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
            >
              {last ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}