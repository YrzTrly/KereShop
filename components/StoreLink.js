'use client';

import { useEffect, useRef, useState } from 'react';

export default function StoreLink({ slug }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setUrl(`${window.location.origin}/${slug}`);
    return () => clearTimeout(timer.current);
  }, [slug]);

  async function copy() {
    if (!url) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // navigator.clipboard only exists in secure contexts (https/localhost);
      // fall back to a hidden textarea so copy still works over plain http.
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <a
        href={url || `/${slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-ink underline-offset-2 hover:underline"
      >
        {url || `/${slug}`}
      </a>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-lg border border-brand/40 bg-panel px-3 py-1.5 text-[12px] font-bold text-brand transition-colors hover:bg-brand hover:text-ink"
      >
        {copied ? '✓ Copied' : '📋 Copy link'}
      </button>
    </div>
  );
}