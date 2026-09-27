const STYLES = {
  pending: 'bg-brand-soft text-inkbrand',
  confirmed: 'bg-ok-bg text-ok',
  delivered: 'bg-line-soft text-ink',
  cancelled: 'bg-bad-bg text-bad',
};

const DOT = {
  pending: 'bg-brand',
  confirmed: 'bg-ok',
  delivered: 'bg-faint',
  cancelled: 'bg-bad',
};

export function StatusBadge({ status }) {
  const s = status || 'pending';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
        STYLES[s] || STYLES.pending
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[s] || DOT.pending}`} />
      {s}
    </span>
  );
}

const CHANNEL_ICONS = {
  whatsapp: '💬',
  voice: '🎙',
  storefront: '🛍️',
  instagram: '📸',
  manual: '✍️',
};

export function ChannelBadge({ channel }) {
  const c = channel || 'manual';
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted">
      <span>{CHANNEL_ICONS[c] || '✍️'}</span>
      <span className="capitalize">{c}</span>
    </span>
  );
}

export function StatCard({ icon, label, value, sub, tone = 'default', accent, alert }) {
  const effective = alert ? 'alert' : accent ? 'brand' : tone;
  const toneCls =
    effective === 'brand' ? 'bg-brand-soft text-inkbrand' : effective === 'alert' ? 'bg-bad-bg text-bad' : 'bg-line-soft text-ink';
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${alert ? 'border-bad/30 bg-panel' : 'border-line bg-panel'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-muted">{label}</p>
          <p className="mt-1.5 truncate text-xl font-bold tracking-tight text-ink sm:text-2xl">{value}</p>
          {sub && <p className="mt-1 text-[11px] text-faint">{sub}</p>}
        </div>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[16px] ${toneCls}`}>{icon}</span>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}