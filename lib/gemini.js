// Gemini generateContent with automatic model fallback + transient retry.
// Google deprecates model names over time (e.g. gemini-2.5-flash-lite now
// 404s for new users and points at gemini-3.5-flash-lite), so we try the
// configured model first and fall back through known-good aliases.
// 5xx "high demand" responses are transient (Google's own message says the
// spike is usually temporary), so each model gets a short retry before we
// move on to the next candidate.
const FALLBACK_CHAIN = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'];
const TRANSIENT_STATUS = new Set([500, 502, 503]);
const MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 2500;

/**
 * Call Gemini generateContent, falling back across models on 404/5xx.
 * @param {string} apiBase  e.g. https://generativelanguage.googleapis.com
 * @param {string} apiKey   GEMINI_API_KEY
 * @param {string} model    primary model (e.g. from GEMINI_MODEL)
 * @param {object} payload  generateContent request body
 * @returns {{model: string, body: object}}
 */
export async function geminiGenerateContent(apiBase, apiKey, model, payload) {
  const chain = [...new Set([model, ...FALLBACK_CHAIN].filter(Boolean))];
  const errors = [];

  for (const m of chain) {
    let stopChain = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const url = new URL(`${apiBase.replace(/\/$/, '')}/v1beta/models/${m}:generateContent`);
      url.searchParams.set('key', apiKey);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        errors.push(`${m}: ${e.message}`);
        stopChain = true;
        break;
      }
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { model: m, body };
      const msg = body?.error?.message || `HTTP ${res.status}`;
      // "High demand" spikes are temporary — retry this model once with
      // backoff before falling through to the next candidate.
      if (TRANSIENT_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * attempt));
        continue;
      }
      errors.push(`${m}: ${msg}`);
      // 401/400/403 (bad key, bad payload) can't be fixed by switching models.
      stopChain = res.status >= 400 && res.status < 500 && res.status !== 404;
      break;
    }
    if (stopChain) break;
  }
  throw new Error(`Gemini call failed (${errors.join(' | ')})`);
}